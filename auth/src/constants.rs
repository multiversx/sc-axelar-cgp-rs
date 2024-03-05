multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::ED25519_KEY_BYTE_LEN;
use multiversx_sc::api::ED25519_SIGNATURE_BYTE_LEN;

pub const OLD_KEY_RETENTION: u64 = 16;

pub type Operator<M> = ManagedByteArray<M, ED25519_KEY_BYTE_LEN>;

#[derive(TypeAbi, TopDecode, Debug)]
pub struct ProofData<M: ManagedTypeApi> {
    pub operators: ManagedVec<M, Operator<M>>,
    pub weights: ManagedVec<M, BigUint<M>>,
    pub threshold: BigUint<M>,
    pub signatures: ManagedVec<M, ManagedByteArray<M, ED25519_SIGNATURE_BYTE_LEN>>,
}

#[derive(TypeAbi, TopDecode, TopEncode, Debug)]
pub struct TransferData<M: ManagedTypeApi> {
    pub new_operators: ManagedVec<M, Operator<M>>,
    pub new_weights: ManagedVec<M, BigUint<M>>,
    pub new_threshold: BigUint<M>,
}
