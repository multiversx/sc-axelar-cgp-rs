multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopEncode)]
pub struct ProposalEventData<'a, M: ManagedTypeApi> {
    pub call_data: &'a ManagedBuffer<M>,
    pub value: &'a BigUint<M>,
}

#[multiversx_sc::module]
pub trait Events {
    #[event("proposal_scheduled_event")]
    fn proposal_scheduled_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] target: &ManagedAddress,
        #[indexed] eta: u64,
        data: ProposalEventData<Self::Api>,
    );

    #[event("proposal_cancelled_event")]
    fn proposal_cancelled_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] target: &ManagedAddress,
        #[indexed] eta: u64,
        data: ProposalEventData<Self::Api>,
    );

    #[event("proposal_executed_event")]
    fn proposal_executed_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] target: &ManagedAddress,
        data: ProposalEventData<Self::Api>,
    );

    #[event("execute_proposal_success_event")]
    fn execute_proposal_success_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] results: MultiValueEncoded<ManagedBuffer>,
    );

    #[event("execute_proposal_error_event")]
    fn execute_proposal_error_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] err_code: u32,
        err_message: ManagedBuffer,
    );

    #[event("operator_approved_event")]
    fn operator_approved_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] target: &ManagedAddress,
        data: ProposalEventData<Self::Api>,
    );

    #[event("operator_cancelled_event")]
    fn operator_cancelled_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] target: &ManagedAddress,
        data: ProposalEventData<Self::Api>,
    );

    #[event("operator_proposal_executed_event")]
    fn operator_proposal_executed_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] target: &ManagedAddress,
        data: ProposalEventData<Self::Api>,
    );

    #[event("operator_execute_proposal_success_event")]
    fn operator_execute_proposal_success_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] results: MultiValueEncoded<ManagedBuffer>,
    );

    #[event("operator_execute_proposal_error_event")]
    fn operator_execute_proposal_error_event(
        &self,
        #[indexed] proposal_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] err_code: u32,
        err_message: ManagedBuffer,
    );

    #[event("operatorship_transferred_event")]
    fn operatorship_transferred_event(
        &self,
        #[indexed] old_multisig: &ManagedAddress,
        new_multisig: &ManagedAddress,
    );
}
