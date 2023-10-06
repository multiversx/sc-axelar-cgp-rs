#![no_std]

multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use core::ops::Deref;

#[macro_export]
macro_rules! sc_panic_self {
    ($api: ty, $msg:tt, $($arg:expr),+ $(,)?) => {{
        let mut ___buffer___ =
            multiversx_sc::types::ManagedBufferCachedBuilder::<$api>::new_from_slice(&[]);
        multiversx_sc::derive::format_receiver_args!(___buffer___, $msg, $($arg),+);
        multiversx_sc::contract_base::ErrorHelper::<$api>::signal_error_with_message(___buffer___.into_managed_buffer());
    }};
    ($api: ty, $msg:expr $(,)?) => {
        multiversx_sc::contract_base::ErrorHelper::<$api>::signal_error_with_message($msg)
    };
}

pub trait ManagedBufferUtils<M: ManagedTypeApi> {
    fn load_512_bytes(&self) -> [u8; 512];

    fn lower_case(&self) -> ManagedBuffer<M>;
}

impl<M: ManagedTypeApi> ManagedBufferUtils<M> for ManagedBuffer<M> {
    fn load_512_bytes(&self) -> [u8; 512] {
        if (self.len() as usize) > 512 {
            sc_panic_self!(M, "ManagedBuffer is too big");
        }

        let mut bytes: [u8; 512] = [0; 512];

        self.load_to_byte_array(&mut bytes);

        return bytes;
    }

    fn lower_case(&self) -> ManagedBuffer<M> {
        let bytes = self.load_512_bytes();

        let mut o = ManagedBuffer::<M>::new();

        for i in 0..self.len() {
            o.append_bytes(&[bytes[i].to_ascii_lowercase()]);
        }

        return o;
    }
}

#[multiversx_sc::contract]
pub trait RemoteAddressValidatorContract {
    // TODO: The InterchainTokenService also depends on this contract's address, the circular dependency should be fixed
    #[init]
    fn init(
        &self,
        interchain_token_service_address: ManagedAddress,
        chain_name: ManagedBuffer,
        trusted_chain_names: MultiValueManagedVecCounted<ManagedBuffer>,
        trusted_addresses: MultiValueManagedVecCounted<ManagedBuffer>,
    ) {
        require!(!interchain_token_service_address.is_zero(), "Zero address");

        self.interchain_token_service_address()
            .set_if_empty(interchain_token_service_address.clone());
        self.interchain_token_service_address_hash().set(
            self.crypto()
                .keccak256(interchain_token_service_address.as_managed_buffer()),
        );

        require!(chain_name.len() > 0, "Zero string length");

        self.chain_name().set_if_empty(chain_name);

        require!(
            trusted_chain_names.len() == trusted_addresses.len(),
            "Length mismatch"
        );

        for (name, address) in trusted_chain_names.into_vec().iter().zip(trusted_addresses.into_vec().iter()) {
            self.add_trusted_address(name.deref(), address.deref());
        }
    }

    #[only_owner]
    #[endpoint(addTrustedAddress)]
    fn add_trusted_address(&self, source_chain: &ManagedBuffer, source_address: &ManagedBuffer) {
        require!(
            source_chain.len() > 0 && source_address.len() > 0,
            "Zero string length"
        );

        self.remote_address_hashes(source_chain)
            .set(self.crypto().keccak256(source_address.lower_case()));
        self.remote_addresses(&source_chain).set(source_address.clone());

        self.trusted_address_added_event(source_chain, source_address);
    }

    #[only_owner]
    #[endpoint(removeTrustedAddress)]
    fn remove_trusted_address(&self, source_chain: &ManagedBuffer) {
        require!(
            source_chain.len() > 0,
            "Zero string length"
        );

        self.remote_address_hashes(source_chain)
            .clear();
        self.remote_addresses(&source_chain).clear();

        self.trusted_address_removed_event(source_chain);
    }

    #[view(validateSender)]
    fn validate_sender(&self, source_chain: &ManagedBuffer, source_address: ManagedBuffer) -> bool {
        let source_address_normalized = source_address.lower_case();
        let source_address_hash = self.crypto().keccak256(source_address_normalized);

        if source_address_hash == self.interchain_token_service_address_hash().get() {
            return true;
        }

        return source_address_hash == self.remote_address_hashes(source_chain).get();
    }

    #[view(getRemoteAddress)]
    fn get_remote_address(&self, chain_name: &ManagedBuffer) -> ManagedBuffer {
        let remote_addresses_mapper = self.remote_addresses(chain_name);

        if remote_addresses_mapper.is_empty() {
            return self.interchain_token_service_address().get().as_managed_buffer().clone();
        }

        remote_addresses_mapper.get()
    }

    #[view]
    #[storage_mapper("remote_address_hashes")]
    fn remote_address_hashes(
        &self,
        chain_name: &ManagedBuffer,
    ) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[view]
    #[storage_mapper("remote_addresses")]
    fn remote_addresses(&self, chain_name: &ManagedBuffer) -> SingleValueMapper<ManagedBuffer>;

    #[view(chainName)]
    #[storage_mapper("chain_name")]
    fn chain_name(&self) -> SingleValueMapper<ManagedBuffer>;

    #[view]
    #[storage_mapper("interchain_token_service_address")]
    fn interchain_token_service_address(&self) -> SingleValueMapper<ManagedAddress>;

    #[view]
    #[storage_mapper("interchain_token_service_address_hash")]
    fn interchain_token_service_address_hash(
        &self,
    ) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[event("trusted_address_added_event")]
    fn trusted_address_added_event(
        &self,
        #[indexed] source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
    );

    #[event("trusted_address_removed_event")]
    fn trusted_address_removed_event(
        &self,
        #[indexed] source_chain: &ManagedBuffer,
    );
}
