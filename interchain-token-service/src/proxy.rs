multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

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

#[multiversx_sc::module]
pub trait ProxyModule {
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

    #[view]
    fn get_valid_token_manager_address(&self, token_id: ManagedByteArray<KECCAK256_RESULT_LEN>) -> ManagedAddress {
        let token_manager_address_mapper = self.token_manager_address(token_id);

        require!(!token_manager_address_mapper.is_empty(), "Token manager does not exist");

        token_manager_address_mapper.get()
    }

    #[view]
    fn get_token_address(&self, token_id: ManagedByteArray<KECCAK256_RESULT_LEN>) -> TokenIdentifier {
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
    fn token_manager_address(&self, token_id: ManagedByteArray<KECCAK256_RESULT_LEN>) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn remote_address_validator_proxy(
        &self,
        address: ManagedAddress,
    ) -> remote_address_validator_proxy::Proxy<Self::Api>;

    #[proxy]
    fn token_manager_proxy(
        &self,
        address: ManagedAddress,
    ) -> token_manager_proxy::Proxy<Self::Api>;
}
