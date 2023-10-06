multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

mod interchain_token_service_proxy {
    multiversx_sc::imports!();

    use multiversx_sc::api::KECCAK256_RESULT_LEN;

    #[multiversx_sc::proxy]
    pub trait InterchainTokenServiceProxy {
        #[endpoint(transmitSendToken)]
        fn transmit_send_token(
            &self,
            token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
            source_address: ManagedAddress,
            destination_chain: ManagedBuffer,
            destination_address: ManagedBuffer,
            amount: BigUint,
            metadata: ManagedBuffer,
        );
    }
}

#[multiversx_sc::module]
pub trait ProxyModule
{
    fn interchain_token_service_transmit_send_token(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_address: ManagedAddress,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        amount: BigUint,
        metadata: ManagedBuffer,
    ) {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .transmit_send_token(
                token_id,
                source_address,
                destination_chain,
                destination_address,
                amount,
                metadata,
            )
            .execute_on_dest_context::<()>();
    }

    #[storage_mapper("interchain_token_service")]
    fn interchain_token_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn interchain_token_service_proxy(&self, sc_address: ManagedAddress) -> interchain_token_service_proxy::Proxy<Self::Api>;
}
