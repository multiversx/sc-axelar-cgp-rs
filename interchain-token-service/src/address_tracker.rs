multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait AddressTracker {
    #[only_owner]
    #[endpoint(setTrustedAddress)]
    fn set_trusted_address(&self, chain: &ManagedBuffer, address: &ManagedBuffer) {
        require!(
            !chain.is_empty() && !address.is_empty(),
            "Zero string length"
        );

        self.trusted_address(chain).set(address.clone());

        self.trusted_address_added_event(chain, address);
    }

    #[only_owner]
    #[endpoint(removeTrustedAddress)]
    fn remove_trusted_address(&self, source_chain: &ManagedBuffer) {
        require!(!source_chain.is_empty(), "Zero string length");

        self.trusted_address(source_chain).clear();

        self.trusted_address_removed_event(source_chain);
    }

    fn set_chain_name(&self, chain_name: ManagedBuffer) {
        self.chain_name().set(chain_name);
    }

    fn is_trusted_address(&self, chain: &ManagedBuffer, address: &ManagedBuffer) -> bool {
        !self.trusted_address(chain).is_empty() && address == &self.trusted_address(chain).get()
    }

    #[view(chainName)]
    #[storage_mapper("chain_name")]
    fn chain_name(&self) -> SingleValueMapper<ManagedBuffer>;

    #[view(trustedAddress)]
    #[storage_mapper("trusted_address")]
    fn trusted_address(&self, chain_name: &ManagedBuffer) -> SingleValueMapper<ManagedBuffer>;

    #[event("trusted_address_added_event")]
    fn trusted_address_added_event(
        &self,
        #[indexed] source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
    );

    #[event("trusted_address_removed_event")]
    fn trusted_address_removed_event(&self, #[indexed] source_chain: &ManagedBuffer);
}
