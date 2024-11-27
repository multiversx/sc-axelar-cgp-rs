use crate::constants::Hash;

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait EventsModule {
    #[event("deploy_remote_interchain_token_approval_event")]
    fn deploy_remote_interchain_token_approval_event(
        &self,
        #[indexed] minter: &ManagedAddress,
        #[indexed] deployer: &ManagedAddress,
        #[indexed] token_id: &Hash<Self::Api>,
        #[indexed] destination_chain: &ManagedBuffer,
        destination_minter: &ManagedBuffer,
    );

    #[event("revoked_deploy_remote_interchain_token_approval_event")]
    fn revoked_deploy_remote_interchain_token_approval_event(
        &self,
        #[indexed] minter: &ManagedAddress,
        #[indexed] deployer: &ManagedAddress,
        #[indexed] token_id: &Hash<Self::Api>,
        #[indexed] destination_chain: &ManagedBuffer,
    );
}
