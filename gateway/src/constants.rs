multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::{KECCAK256_RESULT_LEN};

pub const SELECTOR_APPROVE_CONTRACT_CALL: &[u8; 19] = b"approveContractCall";
pub const SELECTOR_TRANSFER_OPERATORSHIP: &[u8; 20] = b"transferOperatorship";

pub const MULTIVERSX_SIGNED_MESSAGE_PREFIX: &[u8; 28] = b"\x19MultiversX Signed Message:\n";

#[derive(TypeAbi, TopDecode, Debug)]
pub struct ExecuteInput<M: ManagedTypeApi> {
    pub data: ManagedBuffer<M>,
    pub proof: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopDecode, Debug)]
pub struct ExecuteData<M: ManagedTypeApi> {
    pub chain_id: ManagedBuffer<M>,
    pub command_ids: ManagedVec<M, ManagedByteArray<M, KECCAK256_RESULT_LEN>>,
    pub commands: ManagedVec<M, ManagedBuffer<M>>,
    pub params: ManagedVec<M, ManagedBuffer<M>>,
}

#[derive(TypeAbi, TopDecode, Debug)]
pub struct ApproveContractCallParams<M: ManagedTypeApi> {
    pub source_chain: ManagedBuffer<M>,
    pub source_address: ManagedBuffer<M>,
    pub contract_address: ManagedAddress<M>,
    pub payload_hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
}
