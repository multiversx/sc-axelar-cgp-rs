multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use crate::constants::TokenManagerType;

#[multiversx_sc::module]
pub trait Events {
    #[event("token_manager_deployed_event")]
    fn token_manager_deployed_event(
        &self,
        #[indexed] token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] token_manager_type: TokenManagerType,
        data: ManagedArgBuffer<Self::Api>,
    );
}
