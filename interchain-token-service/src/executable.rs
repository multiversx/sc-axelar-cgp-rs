multiversx_sc::imports!();

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
            source_chain: ManagedBuffer,
            source_address: ManagedBuffer,
        ) -> bool;

        #[view(getRemoteAddress)]
        fn get_remote_address(&self, destination_chain: &ManagedBuffer) -> ManagedBuffer;
    }
}

#[multiversx_sc::module]
pub trait ExecutableModule: multiversx_sc_modules::pause::PauseModule {
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
        self.require_not_paused();
        self.only_remote_service(source_chain, source_address);

        let selector = BigUint::top_decode(payload);
    }

    fn only_remote_service(&self, source_chain: ManagedBuffer, source_address: ManagedBuffer) {
        require!(
            self.remote_address_validator_validate_sender(source_chain, source_address),
            "Not remote service"
        );
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

    #[storage_mapper("gateway")]
    fn gateway(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("remote_address_validator")]
    fn remote_address_validator(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway_proxy::Proxy<Self::Api>;

    #[proxy]
    fn remote_address_validator_proxy(
        &self,
        address: ManagedAddress,
    ) -> remote_address_validator_proxy::Proxy<Self::Api>;
}
