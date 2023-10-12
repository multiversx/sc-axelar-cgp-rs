multiversx_sc::imports!();

use crate::constants::{TokenId};
use crate::events;

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
            source_address: &ManagedBuffer,
        ) -> bool;

        #[view(getRemoteAddress)]
        fn get_remote_address(&self, destination_chain: &ManagedBuffer) -> ManagedBuffer;
    }
}

pub mod gas_service_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait GasServiceProxy {
        #[payable("EGLD")]
        #[endpoint(payNativeGasForContractCall)]
        fn pay_native_gas_for_contract_call(
            &self,
            destination_chain: &ManagedBuffer,
            destination_address: &ManagedBuffer,
            payload: &ManagedBuffer,
            refund_address: ManagedAddress,
        );
    }
}

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

        // Endpoint only available on MintBurn TokenManager
        #[payable("*")]
        #[endpoint(deployStandardizedToken)]
        fn deploy_standardized_token(
            &self,
            _distributor: ManagedAddress, // TODO: For what is this used on Ethereum?
            name: ManagedBuffer,
            symbol: ManagedBuffer,
            decimals: u8,
            mint_amount: BigUint,
            mint_to: ManagedAddress,
        );

        #[view(tokenIdentifier)]
        fn token_identifier(&self) -> EgldOrEsdtTokenIdentifier;

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

    use multiversx_sc::api::KECCAK256_RESULT_LEN;

    #[multiversx_sc::proxy]
    pub trait ExecutableContractProxy {
        // TODO: Contracts having these functions should check that the InterchainTokenService contract called them
        #[payable("*")]
        #[endpoint(executeWithInterchainToken)]
        fn execute_with_interchain_token(
            &self,
            source_chain: ManagedBuffer,
            source_address: ManagedBuffer,
            payload: ManagedBuffer,
            token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        ) -> BigUint;

        #[payable("*")]
        #[endpoint(expressExecuteWithInterchainToken)]
        fn express_execute_with_interchain_token(
            &self,
            source_chain: ManagedBuffer,
            source_address: ManagedBuffer,
            payload: ManagedBuffer,
            token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        ) -> BigUint;
    }
}

#[multiversx_sc::module]
pub trait ProxyModule: events::EventsModule + multiversx_sc_modules::pause::PauseModule {
    fn remote_address_validator_chain_name(&self) -> ManagedBuffer {
        self.remote_address_validator_proxy(self.remote_address_validator().get())
            .chain_name()
            .execute_on_dest_context()
    }

    fn remote_address_validator_get_remote_address(
        &self,
        destination_chain: &ManagedBuffer,
    ) -> ManagedBuffer {
        self.remote_address_validator_proxy(self.remote_address_validator().get())
            .get_remote_address(destination_chain)
            .execute_on_dest_context()
    }

    fn gas_service_pay_native_gas_for_contract_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        gas_value: &BigUint,
    ) {
        self.gas_service_proxy(self.gas_service().get())
            .pay_native_gas_for_contract_call(
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_egld_transfer(gas_value.clone())
            .execute_on_dest_context::<()>();
    }

    fn gateway_call_contract(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
    ) {
        self.gateway_proxy(self.gateway().get())
            .call_contract(destination_chain, destination_address, payload)
            .execute_on_dest_context::<()>();
    }

    fn gateway_is_command_executed(&self, command_id: &ManagedBuffer) -> bool {
        self.gateway_proxy(self.gateway().get())
            .is_command_executed(command_id)
            .execute_on_dest_context::<bool>()
    }

    fn token_manager_take_token(
        &self,
        token_id: &TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        sender: &ManagedAddress,
        amount: BigUint,
    ) {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .take_token(sender)
            .with_egld_or_single_esdt_transfer(EgldOrEsdtTokenPayment::new(
                token_identifier,
                0,
                amount,
            ))
            .execute_on_dest_context::<()>();
    }

    fn token_manager_set_flow_limit(&self, token_id: &TokenId<Self::Api>, flow_limit: &BigUint) {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .set_flow_limit(flow_limit)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_give_token(
        &self,
        token_id: &TokenId<Self::Api>,
        destination_address: &ManagedAddress,
        amount: &BigUint,
    ) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .give_token(destination_address, amount)
            .execute_on_dest_context()
    }

    fn token_manager_deploy_standardized_token(
        &self,
        token_id: &TokenId<Self::Api>,
        distributor: ManagedAddress,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        mint_amount: BigUint,
        mint_to: ManagedAddress,
    ) {
        // TODO: Need to add egld transfer here for ESDT issue fee
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .deploy_standardized_token(distributor, name, symbol, decimals, mint_amount, mint_to)
            .execute_on_dest_context::<()>();
    }

    #[view]
    fn get_flow_limit(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(&token_id))
            .get_flow_limit()
            .execute_on_dest_context()
    }

    #[view]
    fn get_flow_out_amount(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(&token_id))
            .get_flow_out_amount()
            .execute_on_dest_context()
    }

    #[view]
    fn get_flow_in_amount(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(&token_id))
            .get_flow_in_amount()
            .execute_on_dest_context()
    }

    #[view]
    fn get_token_identifier(&self, token_id: &TokenId<Self::Api>) -> EgldOrEsdtTokenIdentifier {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .token_identifier()
            .execute_on_dest_context()
    }

    #[view]
    fn get_valid_token_manager_address(&self, token_id: &TokenId<Self::Api>) -> ManagedAddress {
        let token_manager_address_mapper = self.token_manager_address(token_id);

        require!(
            !token_manager_address_mapper.is_empty(),
            "Token manager does not exist"
        );

        token_manager_address_mapper.get()
    }

    #[storage_mapper("gateway")]
    fn gateway(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("gas_service")]
    fn gas_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("remote_address_validator")]
    fn remote_address_validator(&self) -> SingleValueMapper<ManagedAddress>;

    #[view]
    #[storage_mapper("token_manager_address")]
    fn token_manager_address(
        &self,
        token_id: &TokenId<Self::Api>,
    ) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway_proxy::Proxy<Self::Api>;

    #[proxy]
    fn gas_service_proxy(&self, sc_address: ManagedAddress) -> gas_service_proxy::Proxy<Self::Api>;

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
