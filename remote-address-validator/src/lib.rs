#![no_std]

multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use core::ops::Deref;

pub trait ManagedBufferLowercase<M: ManagedTypeApi> {
    fn lowercase(&self) -> ManagedBuffer<M>;
}

impl<M: ManagedTypeApi> ManagedBufferLowercase<M> for ManagedBuffer<M> {
    fn lowercase(&self) -> ManagedBuffer<M> {
        let mut output = ManagedBuffer::<M>::new();

        self.for_each_batch::<32, _>(|batch| {
            for byte in batch {
                output.append_bytes(&[byte.to_ascii_lowercase()]);
            }
        });

        output
    }
}

#[multiversx_sc::contract]
pub trait RemoteAddressValidatorContract {
    #[init]
    fn init(
        &self,
        chain_name: ManagedBuffer,
        trusted_chain_names: MultiValueManagedVecCounted<ManagedBuffer>,
        trusted_addresses: MultiValueManagedVecCounted<ManagedBuffer>,
    ) {
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
            .set(self.crypto().keccak256(source_address.lowercase()));
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
        let source_address_normalized = source_address.lowercase();
        let source_address_hash = self.crypto().keccak256(source_address_normalized);

        if self.remote_address_hashes(source_chain).is_empty() {
            return false;
        }

        return source_address_hash == self.remote_address_hashes(source_chain).get();
    }

    #[view(getRemoteAddress)]
    fn get_remote_address(&self, chain_name: &ManagedBuffer) -> ManagedBuffer {
        let remote_addresses_mapper = self.remote_addresses(chain_name);

        require!(!remote_addresses_mapper.is_empty(), "Untrusted chain");

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
