multiversx_sc::imports!();

mod gateway_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait Gateway {
        #[endpoint(validateContractCall)]
        fn validate_contract_call(
            &self,
            command_id: &ManagedBuffer,
            source_chain: &ManagedBuffer,
            source_address: &ManagedBuffer,
            payload_hash: &ManagedBuffer,
        ) -> bool;
    }
}

#[multiversx_sc::module]
pub trait ExecutableModule {
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
        payload: ManagedBuffer,
    ) {
    }

    #[storage_mapper("gateway")]
    fn gateway(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway_proxy::Proxy<Self::Api>;
}
