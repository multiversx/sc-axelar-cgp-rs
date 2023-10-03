multiversx_sc::imports!();
multiversx_sc::derive_imports!();

pub const SELECTOR_APPROVE_CONTRACT_CALL: &[u8; 19] = b"approveContractCall";
pub const SELECTOR_TRANSFER_OPERATORSHIP: &[u8; 20] = b"transferOperatorship";

#[derive(TypeAbi, TopDecode, Debug)]
pub struct ExecuteData<M: ManagedTypeApi> {
    pub command_ids: ManagedVec<M, ManagedBuffer<M>>,
    pub commands: ManagedVec<M, ManagedBuffer<M>>,
    pub params: ManagedVec<M, ManagedBuffer<M>>,
}

#[derive(TypeAbi, TopDecode, Debug)]
pub struct ApproveContractCallParams<M: ManagedTypeApi> {
    pub source_chain: ManagedBuffer<M>,
    pub source_address: ManagedBuffer<M>,
    pub contract_address: ManagedAddress<M>,
    pub payload_hash: ManagedBuffer<M>,
    pub source_tx_hash: ManagedBuffer<M>,
    pub source_event_index: BigUint<M>,
}
