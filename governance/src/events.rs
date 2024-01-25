multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopEncode)]
pub struct ProposalExecutedData<'a, M: ManagedTypeApi> {
    pub call_data: &'a ManagedBuffer<M>,
    pub value: &'a BigUint<M>,
}

#[multiversx_sc::module]
pub trait Events {
    #[event("proposal_executed_event")]
    fn proposal_executed_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] target: &ManagedAddress,
        data: ProposalExecutedData<Self::Api>,
    );
}
