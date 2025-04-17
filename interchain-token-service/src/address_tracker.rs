multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait AddressTracker {
    #[only_owner]
    #[endpoint(setTrustedChain)]
    fn set_trusted_chain(&self, chain: ManagedBuffer) {
        require!(!chain.is_empty(), "Zero string length");

        self.trusted_chain_added_event(&chain);

        self.trusted_chains().insert(chain);
    }

    #[only_owner]
    #[endpoint(removeTrustedChain)]
    fn remove_trusted_chain(&self, source_chain: &ManagedBuffer) {
        require!(!source_chain.is_empty(), "Zero string length");

        self.trusted_chain_removed_event(source_chain);

        self.trusted_chains().swap_remove(source_chain);
    }

    fn set_chain_name(&self, chain_name: ManagedBuffer) {
        self.chain_name().set(chain_name);
    }

    fn is_trusted_chain(&self, chain: &ManagedBuffer) -> bool {
        self.trusted_chains().contains(chain)
    }

    #[view(chainName)]
    #[storage_mapper("chain_name")]
    fn chain_name(&self) -> SingleValueMapper<ManagedBuffer>;

    #[view(trustedChains)]
    #[storage_mapper("trusted_chains")]
    fn trusted_chains(&self) -> UnorderedSetMapper<ManagedBuffer>;

    #[view(itsHubAddress)]
    #[storage_mapper("its_hub_address")]
    fn its_hub_address(&self) -> SingleValueMapper<ManagedBuffer>;

    #[event("trusted_chain_added_event")]
    fn trusted_chain_added_event(&self, #[indexed] source_chain: &ManagedBuffer);

    #[event("trusted_chain_removed_event")]
    fn trusted_chain_removed_event(&self, #[indexed] source_chain: &ManagedBuffer);
}
