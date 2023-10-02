multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use crate::executable;
use crate::executable::gateway_proxy::ProxyTrait as GatewayProxyTrait;

pub mod remote_address_validator_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait RemoteAddressValidatorProxy {
        #[view(chainName)]
        fn chain_name(&self) -> ManagedBuffer;

        #[view(validateSender)]
        fn validate_sender(
            &self,
            source_chain: ManagedBuffer,
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
        #[view(tokenAddress)]
        fn token_address(&self) -> TokenIdentifier;

        #[view(getFlowLimit)]
        fn get_flow_limit(&self) -> BigUint;

        #[view(getFlowOutAmount)]
        fn get_flow_out_amount(&self) -> BigUint;

        #[view(getFlowInAmount)]
        fn get_flow_in_amount(&self) -> BigUint;
    }
}

mod gas_service_proxy {
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

#[multiversx_sc::module]
pub trait ProxyModule: executable::ExecutableModule {
    fn remote_address_validator_chain_name(&self) -> ManagedBuffer {
        self.remote_address_validator_proxy(self.remote_address_validator().get())
            .chain_name()
            .execute_on_dest_context()
    }

    fn remote_address_validator_validate_sender(
        &self,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
    ) -> bool {
        self.remote_address_validator_proxy(self.remote_address_validator().get())
            .validate_sender(source_chain, source_address)
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

    #[view]
    fn get_valid_token_manager_address(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
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
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> TokenIdentifier {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .token_address()
            .execute_on_dest_context()
    }

    #[view]
    fn get_flow_limit(&self, token_id: ManagedByteArray<KECCAK256_RESULT_LEN>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .get_flow_limit()
            .execute_on_dest_context()
    }

    #[view]
    fn get_flow_out_amount(&self, token_id: ManagedByteArray<KECCAK256_RESULT_LEN>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .get_flow_out_amount()
            .execute_on_dest_context()
    }

    #[view]
    fn get_flow_in_amount(&self, token_id: ManagedByteArray<KECCAK256_RESULT_LEN>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .get_flow_in_amount()
            .execute_on_dest_context()
    }

    #[storage_mapper("remote_address_validator")]
    fn remote_address_validator(&self) -> SingleValueMapper<ManagedAddress>;

    #[view]
    #[storage_mapper("token_manager_address")]
    fn token_manager_address(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("gas_service")]
    fn gas_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn remote_address_validator_proxy(
        &self,
        address: ManagedAddress,
    ) -> remote_address_validator_proxy::Proxy<Self::Api>;

    #[proxy]
    fn token_manager_proxy(&self, address: ManagedAddress)
        -> token_manager_proxy::Proxy<Self::Api>;

    #[proxy]
    fn gas_service_proxy(&self, sc_address: ManagedAddress) -> gas_service_proxy::Proxy<Self::Api>;
}
