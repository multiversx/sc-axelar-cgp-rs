multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use crate::constants::WeightedSigners;

#[multiversx_sc::module]
pub trait Events {
    #[event("contract_call_event")]
    fn contract_call_event(
        &self,
        #[indexed] sender: ManagedAddress,
        #[indexed] destination_chain: ManagedBuffer,
        #[indexed] destination_contract_address: ManagedBuffer,
        #[indexed] payload_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
        payload: ManagedBuffer,
    );

    #[event("message_approved_event")]
    fn message_approved_event(
        &self,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] message_id: ManagedBuffer,
        #[indexed] source_address: ManagedBuffer,
        #[indexed] contract_address: ManagedAddress,
        #[indexed] payload_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
    );

    #[event("message_executed_event")]
    fn message_executed_event(
        &self,
        #[indexed] source_chain: &ManagedBuffer,
        #[indexed] message_id: &ManagedBuffer,
    );

    #[event("signers_rotated_event")]
    fn signers_rotated_event(
        &self,
        #[indexed] epoch: BigUint, // This has nothing to do with the blockchain epoch
        #[indexed] signers_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
        signers: WeightedSigners<Self::Api>,
    );

    #[event("operatorship_transferred_event")]
    fn operatorship_transferred_event(&self, new_operator: ManagedAddress);
}
