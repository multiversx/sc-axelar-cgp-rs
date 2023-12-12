multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopEncode)]
pub struct ContractCallData<M: ManagedTypeApi> {
    pub hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub payload: ManagedBuffer<M>,
}

#[multiversx_sc::module]
pub trait Events {
    #[event("contract_call_event")]
    fn contract_call_event(
        &self,
        #[indexed] sender: ManagedAddress,
        #[indexed] destination_chain: ManagedBuffer,
        #[indexed] destination_contract_address: ManagedBuffer,
        data: ContractCallData<Self::Api>,
    );

    #[event("executed_event")]
    fn executed_event(&self, #[indexed] command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>);

    #[event("contract_call_approved_event")]
    fn contract_call_approved_event(
        &self,
        #[indexed] command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] source_address: ManagedBuffer,
        #[indexed] contract_address: ManagedAddress,
        #[indexed] payload_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
    );

    #[event("contract_call_executed_event")]
    fn contract_call_executed_event(&self, #[indexed] command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>);

    #[event("operatorship_transferred_event")]
    fn operatorship_transferred_event(&self, params: &ManagedBuffer);
}
