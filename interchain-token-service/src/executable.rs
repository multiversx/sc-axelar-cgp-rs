multiversx_sc::imports!();

use crate::constants::{DeployTokenManagerPayload, SendTokenPayload, SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, SELECTOR_DEPLOY_TOKEN_MANAGER, SELECTOR_SEND_TOKEN, SELECTOR_SEND_TOKEN_WITH_DATA, TokenManagerType, DeployStandardizedTokenAndManagerPayload};
use crate::events;
use core::convert::TryFrom;
use multiversx_sc::api::KECCAK256_RESULT_LEN;
use multiversx_sc::codec::TopDecodeInput;

pub mod gateway_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait Gateway {
        #[endpoint(callContract)]
        fn call_contract(
            &self,
            destination_chain: &ManagedBuffer,
            destination_contract_address: &ManagedBuffer,
            payload: &ManagedBuffer,
        );

        #[endpoint(validateContractCall)]
        fn validate_contract_call(
            &self,
            command_id: &ManagedBuffer,
            source_chain: &ManagedBuffer,
            source_address: &ManagedBuffer,
            payload_hash: &ManagedBuffer,
        ) -> bool;

        #[view(isCommandExecuted)]
        fn is_command_executed(&self, command_id: &ManagedBuffer) -> bool;
    }
}

pub mod remote_address_validator_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait RemoteAddressValidatorProxy {
        #[view(chainName)]
        fn chain_name(&self) -> ManagedBuffer;

        #[view(validateSender)]
        fn validate_sender(
            &self,
            source_chain: &ManagedBuffer,
            source_address: ManagedBuffer,
        ) -> bool;

        #[view(getRemoteAddress)]
        fn get_remote_address(&self, destination_chain: &ManagedBuffer) -> ManagedBuffer;
    }
}

pub mod token_manager_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait TokenManagerProxy {
        #[payable("*")]
        #[endpoint(takeToken)]
        fn take_token(&self, sender: &ManagedAddress);

        #[endpoint(giveToken)]
        fn give_token(&self, destination_address: &ManagedAddress, amount: &BigUint) -> BigUint;

        #[endpoint(setFlowLimit)]
        fn set_flow_limit(&self, flow_limit: &BigUint);

        #[view(tokenAddress)]
        fn token_address(&self) -> EgldOrEsdtTokenIdentifier;

        #[view(getFlowLimit)]
        fn get_flow_limit(&self) -> BigUint;

        #[view(getFlowOutAmount)]
        fn get_flow_out_amount(&self) -> BigUint;

        #[view(getFlowInAmount)]
        fn get_flow_in_amount(&self) -> BigUint;
    }
}

pub mod executable_contract_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait ExecutableContractProxy {
        // TODO: A contract having this function should check that the InterchainTokenService contract called it
        #[payable("*")]
        #[endpoint(executeWithInterchainToken)]
        fn execute_with_interchain_token(
            &self,
            source_chain: ManagedBuffer,
            source_address: ManagedBuffer,
            payload: ManagedBuffer,
        ) -> BigUint;
    }
}

// TODO: This needs a refactoring, it shares a lot with proxy module and might be better to combine the two
#[multiversx_sc::module]
pub trait ExecutableModule:
    multiversx_sc_modules::pause::PauseModule + events::EventsModule
{
    fn executable_constructor(&self, gateway: ManagedAddress) {
        require!(!gateway.is_zero(), "Invalid address");

        self.gateway().set_if_empty(gateway);
    }

    #[endpoint]
    fn execute(
        &self,
        command_id: ManagedBuffer,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        let payload_hash = self.crypto().keccak256(&payload);

        let valid = self
            .gateway_proxy(self.gateway().get())
            .validate_contract_call(
                &command_id,
                &source_chain,
                &source_address,
                payload_hash.as_managed_buffer(),
            )
            .execute_on_dest_context::<bool>();

        require!(valid, "Not approved by gateway");

        self.execute_raw(source_chain, source_address, payload);
    }

    fn execute_raw(
        &self,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        payload_raw: ManagedBuffer,
    ) {
        self.require_not_paused();
        self.only_remote_service(&source_chain, source_address);

        let mut payload = payload_raw.clone().into_nested_buffer();

        // TODO: Is this decoding right? Also try to do this without cloning payload above
        let selector = BigUint::dep_decode(&mut payload).unwrap();

        match selector.to_u64().unwrap() as u32 {
            SELECTOR_SEND_TOKEN | SELECTOR_SEND_TOKEN_WITH_DATA => {
                self.process_send_token_payload(source_chain, payload_raw);
            }
            SELECTOR_DEPLOY_TOKEN_MANAGER => {
                self.process_deploy_token_manager_payload(payload_raw);
            }
            SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN => {
                self.process_deploy_standardized_token_and_manager_payload(payload_raw);
            }
            _ => {
                sc_panic!("Selector unknown");
            }
        }
    }

    fn process_send_token_payload(&self, source_chain: ManagedBuffer, payload: ManagedBuffer) {
        let send_token_payload = SendTokenPayload::<Self::Api>::top_decode(payload).unwrap();

        let destination_address =
            ManagedAddress::try_from(send_token_payload.destination_address).unwrap();

        // TODO: Here the command_id is also taken in case it exists as another argument to the transaction, which is not possible to do on MultiversX.
        // The functionality regarding `express_receive_token` was no implemented currently.

        if send_token_payload.selector == BigUint::from(SELECTOR_SEND_TOKEN_WITH_DATA) {
            // TODO: This is different on MultiversX because of arhitectural changes, check if it is ok like this
            // Here we give the tokens to this contract and then call the executable contract with the tokens
            let amount = self.token_manager_give_token(
                &send_token_payload.token_id,
                &self.blockchain().get_sc_address(),
                &send_token_payload.amount,
            );

            let token_address = self.get_token_address(&send_token_payload.token_id);

            self.emit_received_token_with_data_event(
                &send_token_payload.token_id,
                &source_chain,
                &destination_address,
                amount.clone(),
                send_token_payload.source_address.clone().unwrap(),
                send_token_payload.data.clone().unwrap(),
            );

            // TODO: This call can fail, which will leave the token in this contract, see how it can be fixed
            self.executable_contract_proxy(destination_address)
                .execute_with_interchain_token(
                    source_chain,
                    send_token_payload.source_address.unwrap(),
                    send_token_payload.data.unwrap(),
                )
                .with_egld_or_single_esdt_transfer((token_address, 0, amount))
                .async_call()
                .call_and_exit();
        } else {
            let amount = self.token_manager_give_token(
                &send_token_payload.token_id,
                &destination_address,
                &send_token_payload.amount,
            );

            self.token_received_event(
                send_token_payload.token_id,
                source_chain,
                destination_address,
                amount,
            );
        }
    }

    fn process_deploy_token_manager_payload(&self, payload: ManagedBuffer) {
        let deploy_token_manager_payload =
            DeployTokenManagerPayload::<Self::Api>::top_decode(payload).unwrap();

        self.deploy_token_manager(
            &deploy_token_manager_payload.token_id,
            deploy_token_manager_payload.token_manager_type,
            Some(deploy_token_manager_payload.params.token_address),
        );
    }

    fn process_deploy_standardized_token_and_manager_payload(&self, payload: ManagedBuffer) {
        let deploy_standardized_token_and_manager_payload =
            DeployStandardizedTokenAndManagerPayload::<Self::Api>::top_decode(payload).unwrap();

        // TODO: There is no way to get the token_address (ESDT id) before it is deployed

        // TODO: Should we call the token manager here to actually deploy the token?
    }

    fn only_remote_service(&self, source_chain: &ManagedBuffer, source_address: ManagedBuffer) {
        require!(
            self.remote_address_validator_validate_sender(source_chain, source_address),
            "Not remote service"
        );
    }

    fn remote_address_validator_validate_sender(
        &self,
        source_chain: &ManagedBuffer,
        source_address: ManagedBuffer,
    ) -> bool {
        self.remote_address_validator_proxy(self.remote_address_validator().get())
            .validate_sender(source_chain, source_address)
            .execute_on_dest_context()
    }

    fn token_manager_give_token(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_address: &ManagedAddress,
        amount: &BigUint,
    ) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .give_token(destination_address, amount)
            .execute_on_dest_context()
    }

    // TODO: This function takes as a last argument a more generic `params` object, check if our implementation is ok
    // or if we need to make it more generic
    fn deploy_token_manager(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        token_manager_type: TokenManagerType,
        token_address: Option<EgldOrEsdtTokenIdentifier>,
    ) -> ManagedAddress {
        // TODO: This is done using a TokenManagerDeployer contract and TokenManagerProxy contract in sol but was simplified here
        let impl_address = self.get_implementation(token_manager_type);

        let mut arguments = ManagedArgBuffer::new();

        arguments.push_arg(self.blockchain().get_sc_address());
        arguments.push_arg(token_id);
        // TODO: The sol contract also has a operator passed as params to TokenManager deploy, but that was not added here
        arguments.push_arg(token_address);

        // TODO: What does this return when it fails?
        let (address, _) = self.send_raw().deploy_from_source_contract(
            self.blockchain().get_gas_left(),
            &BigUint::zero(),
            &impl_address,
            CodeMetadata::DEFAULT,
            &arguments,
        );

        require!(!address.is_zero(), "Token manager deployment failed");

        self.token_manager_deployed_event(token_id, token_manager_type, arguments);

        address
    }

    #[view]
    fn get_valid_token_manager_address(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> ManagedAddress {
        let token_manager_address_mapper = self.token_manager_address(token_id);

        require!(
            !token_manager_address_mapper.is_empty(),
            "Token manager does not exist"
        );

        token_manager_address_mapper.get()
    }

    #[view]
    fn get_token_address(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> EgldOrEsdtTokenIdentifier {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .token_address()
            .execute_on_dest_context()
    }

    #[view]
    fn get_implementation(&self, token_manager_type: TokenManagerType) -> ManagedAddress {
        match token_manager_type {
            TokenManagerType::LockUnlock => self.implementation_lock_unlock().get(),
            TokenManagerType::MintBurn => self.implementation_mint_burn().get(),
        }
    }

    #[storage_mapper("gateway")]
    fn gateway(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("remote_address_validator")]
    fn remote_address_validator(&self) -> SingleValueMapper<ManagedAddress>;

    #[view]
    #[storage_mapper("token_manager_address")]
    fn token_manager_address(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("implementation_lock_unlock")]
    fn implementation_lock_unlock(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("implementation_mint_burn")]
    fn implementation_mint_burn(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway_proxy::Proxy<Self::Api>;

    #[proxy]
    fn remote_address_validator_proxy(
        &self,
        address: ManagedAddress,
    ) -> remote_address_validator_proxy::Proxy<Self::Api>;

    #[proxy]
    fn token_manager_proxy(&self, address: ManagedAddress)
        -> token_manager_proxy::Proxy<Self::Api>;

    #[proxy]
    fn executable_contract_proxy(
        &self,
        sc_address: ManagedAddress,
    ) -> executable_contract_proxy::Proxy<Self::Api>;
}
