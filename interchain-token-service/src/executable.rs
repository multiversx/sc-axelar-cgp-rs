multiversx_sc::imports!();

use crate::abi::AbiEncodeDecode;
use crate::constants::{
    DeployInterchainTokenPayload, DeployTokenManagerParams, DeployTokenManagerPayload,
    InterchainTransferPayload, TokenId, MESSAGE_TYPE_INTERCHAIN_TRANSFER,
};
use crate::{events, proxy, express_executor_tracker, address_tracker};
use core::convert::TryFrom;
use core::ops::Deref;
use multiversx_sc::api::KECCAK256_RESULT_LEN;
use token_manager::TokenManagerType;

#[multiversx_sc::module]
pub trait ExecutableModule:
    express_executor_tracker::ExpressExecutorTracker
    + multiversx_sc_modules::pause::PauseModule
    + events::EventsModule
    + proxy::ProxyModule
    + address_tracker::AddressTracker
{
    fn process_interchain_transfer_payload(
        &self,
        express_executor: &ManagedAddress,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        let send_token_payload = InterchainTransferPayload::<Self::Api>::abi_decode(payload);

        if !express_executor.is_zero() {
            self.token_manager_give_token(
                &send_token_payload.token_id,
                express_executor,
                &send_token_payload.amount,
            );

            return;
        }

        let destination_address =
            ManagedAddress::try_from(send_token_payload.destination_address).unwrap();

        if send_token_payload.message_type == MESSAGE_TYPE_INTERCHAIN_TRANSFER {
            let (_, amount) = self.token_manager_give_token(
                &send_token_payload.token_id,
                &destination_address,
                &send_token_payload.amount,
            );

            self.interchain_transfer_received_event(
                send_token_payload.token_id,
                source_chain,
                send_token_payload.source_address,
                destination_address,
                amount,
            );

            return;
        }

        // Here we give the tokens to this contract and then call the executable contract with the tokens
        // In case of async call error, the token_manager_take_token method is called to revert this
        let (token_identifier, amount) = self.token_manager_give_token(
            &send_token_payload.token_id,
            &self.blockchain().get_sc_address(),
            &send_token_payload.amount,
        );

        self.interchain_transfer_received_with_data_event(
            &send_token_payload.token_id,
            &source_chain,
            &send_token_payload.source_address,
            &destination_address,
            &amount,
        );

        self.executable_contract_execute_with_interchain_token(
            destination_address,
            source_chain,
            send_token_payload.source_address,
            send_token_payload.data.unwrap(),
            send_token_payload.token_id,
            token_identifier,
            amount,
            command_id,
        );
    }

    fn process_deploy_token_manager_payload(&self, payload: ManagedBuffer) {
        let deploy_token_manager_payload =
            DeployTokenManagerPayload::<Self::Api>::abi_decode(payload);

        let params =
            DeployTokenManagerParams::<Self::Api>::top_decode(deploy_token_manager_payload.params)
                .unwrap();

        self.deploy_token_manager_raw(
            &deploy_token_manager_payload.token_id,
            deploy_token_manager_payload.token_manager_type,
            params,
        );
    }

    fn process_deploy_interchain_token_payload(
        &self,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        payload_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
        payload: ManagedBuffer,
    ) {
        let data = DeployInterchainTokenPayload::<Self::Api>::abi_decode(payload);

        let distributor_raw = ManagedAddress::try_from(data.distributor);
        let distributor = if distributor_raw.is_err() {
            None
        } else {
            Some(distributor_raw.unwrap())
        };

        // On first transaction, deploy the token manager and on second transaction deploy ESDT through the token manager
        // This is because we can not deploy token manager and call it to deploy the token in the same transaction
        let token_manager_address_mapper = self.token_manager_address(&data.token_id);
        if token_manager_address_mapper.is_empty() {
            require!(
                self.call_value().egld_value().deref() == &BigUint::zero(),
                "Can not send EGLD payment if not issuing ESDT"
            );

            // Only check that the call is valid, since this needs to be called twice with the same parameters
            let valid = self.gateway_is_contract_call_approved(
                &command_id,
                &source_chain,
                &source_address,
                &payload_hash,
            );

            require!(valid, "Not approved by gateway");

            self.deploy_token_manager_raw(
                &data.token_id,
                TokenManagerType::MintBurn,
                DeployTokenManagerParams {
                    operator: distributor,
                    token_identifier: None,
                },
            );

            return;
        }

        // The second time this is called, the call will be validated
        let valid = self.gateway_validate_contract_call(
            &command_id,
            &source_chain,
            &source_address,
            &payload_hash,
        );

        require!(valid, "Not approved by gateway");

        self.token_manager_deploy_interchain_token(
            &data.token_id,
            distributor,
            data.name,
            data.symbol,
            data.decimals,
        );
    }

    fn deploy_token_manager_raw(
        &self,
        token_id: &TokenId<Self::Api>,
        token_manager_type: TokenManagerType,
        params: DeployTokenManagerParams<Self::Api>,
    ) -> ManagedAddress {
        let token_manager_address_mapper = self.token_manager_address(token_id);

        require!(
            token_manager_address_mapper.is_empty(),
            "Token manager already exists"
        );

        let impl_address = self.token_manager_implementation(token_manager_type);

        let mut arguments = ManagedArgBuffer::new();

        arguments.push_arg(self.blockchain().get_sc_address());
        arguments.push_arg(token_id);
        arguments.push_arg(params.operator.clone());
        arguments.push_arg(params.token_identifier.clone());

        let (address, _) = self.send_raw().deploy_from_source_contract(
            self.blockchain().get_gas_left(),
            &BigUint::zero(),
            &impl_address,
            CodeMetadata::UPGRADEABLE,
            &arguments,
        );

        require!(!address.is_zero(), "Token manager deployment failed");

        self.emit_token_manager_deployed_event(
            token_id,
            address.clone(),
            token_manager_type,
            params,
        );

        token_manager_address_mapper.set(address.clone());

        address
    }

    #[view(tokenManagerImplementation)]
    fn token_manager_implementation(&self, token_manager_type: TokenManagerType) -> ManagedAddress {
        // Only MintBurn and LockUnlock are supported, the others are kept for EVM compatibility
        match token_manager_type {
            TokenManagerType::MintBurn => self.implementation_mint_burn().get(),
            TokenManagerType::MintBurnFrom => self.implementation_mint_burn().get(),
            TokenManagerType::LockUnlock => self.implementation_lock_unlock().get(),
            TokenManagerType::LockUnlockFee => self.implementation_lock_unlock().get(),
        }
    }

    #[storage_mapper("implementation_mint_burn")]
    fn implementation_mint_burn(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("implementation_lock_unlock")]
    fn implementation_lock_unlock(&self) -> SingleValueMapper<ManagedAddress>;
}
