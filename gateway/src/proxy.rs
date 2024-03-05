multiversx_sc::imports!();

use multiversx_sc::api::{KECCAK256_RESULT_LEN};

pub mod auth_module_proxy {
    multiversx_sc::imports!();

    use multiversx_sc::api::{KECCAK256_RESULT_LEN};

    #[multiversx_sc::proxy]
    pub trait AuthModuleProxy {
        #[endpoint(validateProof)]
        fn validate_proof(
            &self,
            message_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
            proof: &ManagedBuffer,
        ) -> bool;

        #[only_owner]
        #[endpoint(transferOperatorship)]
        fn transfer_operatorship(&self, params: &ManagedBuffer);
    }
}

#[multiversx_sc::module]
pub trait ProxyModule {
    fn auth_validate_proof(
        &self,
        message_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        proof: &ManagedBuffer,
    ) -> bool {
        self.auth_module_proxy(self.auth_module().get())
            .validate_proof(message_hash, proof)
            .execute_on_dest_context()
    }

    fn auth_transfer_operatorship(&self, params: &ManagedBuffer) {
        self.auth_module_proxy(self.auth_module().get())
            .transfer_operatorship(params)
            .execute_on_dest_context::<()>();
    }

    #[view(authModule)]
    #[storage_mapper("auth_module")]
    fn auth_module(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn auth_module_proxy(&self, address: ManagedAddress) -> auth_module_proxy::Proxy<Self::Api>;
}
