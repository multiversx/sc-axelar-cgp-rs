#![no_std]

multiversx_sc::imports!();

mod constants;

use crate::constants::{ProofData, TransferData, OLD_KEY_RETENTION, Operator};
use core::ops::Deref;
use multiversx_sc::api::{ED25519_SIGNATURE_BYTE_LEN, KECCAK256_RESULT_LEN};

#[multiversx_sc::contract]
pub trait Auth {
    #[init]
    fn init(&self, recent_operators: MultiValueEncoded<TransferData<Self::Api>>) {
        for operator in recent_operators.into_iter() {
            self.transfer_operatorship(operator);
        }
    }

    #[endpoint(validateProof)]
    fn validate_proof(
        &self,
        message_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
        proof_data: ProofData<Self::Api>,
    ) -> bool {
        let operators_hash = self.get_operators_hash(
            &proof_data.operators,
            &proof_data.weights,
            &proof_data.threshold,
        );

        let operators_epoch_mapper = self.epoch_for_hash(&operators_hash);
        let epoch = self.current_epoch().get();

        require!(
            !operators_epoch_mapper.is_empty()
                && epoch - operators_epoch_mapper.get() < OLD_KEY_RETENTION,
            "Invalid operators"
        );

        self.validate_signatures(
            message_hash,
            proof_data.operators,
            proof_data.weights,
            proof_data.threshold,
            proof_data.signatures,
        );

        operators_epoch_mapper.get() == epoch
    }

    #[only_owner]
    #[endpoint(transferOperatorship)]
    fn transfer_operatorship(&self, transfer_data: TransferData<Self::Api>) {
        require!(
            !transfer_data.new_operators.is_empty()
                && self.contains_no_duplicate(&transfer_data.new_operators),
            "Invalid operators"
        );

        require!(
            transfer_data.new_weights.len() == transfer_data.new_operators.len(),
            "Invalid weights"
        );

        let mut total_weight = BigUint::zero();
        for weight in transfer_data.new_weights.iter() {
            total_weight += weight.deref();
        }

        require!(
            transfer_data.new_threshold > 0 && total_weight >= transfer_data.new_threshold,
            "Invalid threshold"
        );

        let new_operators_hash = self.get_operators_hash(
            &transfer_data.new_operators,
            &transfer_data.new_weights,
            &transfer_data.new_threshold,
        );

        require!(
            self.epoch_for_hash(&new_operators_hash).is_empty(),
            "Duplicate operators"
        );

        let epoch = self.current_epoch().update(|epoch| {
            *epoch += 1;
            *epoch
        });

        self.hash_for_epoch(epoch).set(&new_operators_hash);
        self.epoch_for_hash(&new_operators_hash).set(epoch);

        self.operatorship_transferred_event(transfer_data);
    }

    fn validate_signatures(
        &self,
        message_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
        operators: ManagedVec<Operator<Self::Api>>,
        weights: ManagedVec<BigUint>,
        threshold: BigUint,
        signatures: ManagedVec<ManagedByteArray<ED25519_SIGNATURE_BYTE_LEN>>,
    ) {
        let mut weight = BigUint::zero();

        for (operator_index, signature) in signatures.iter().enumerate() {
            let address = operators.get(operator_index);

            self.crypto().verify_ed25519(
                address.as_managed_buffer(),
                message_hash.as_managed_buffer(),
                signature.as_managed_buffer(),
            );

            // Check that operators do not repeat
            require!(
                operators.find(&address) == Some(operator_index),
                "Malformed signers"
            );

            let current_weight = weights.get(operator_index);
            weight += current_weight.deref();

            if weight >= threshold {
                return;
            }
        }

        sc_panic!("Low signatures weight");
    }

    fn get_operators_hash(
        &self,
        operators: &ManagedVec<Operator<Self::Api>>,
        weights: &ManagedVec<BigUint>,
        threshold: &BigUint,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        for operator in operators.iter() {
            encoded.append(operator.as_managed_buffer());
        }

        for weight in weights.iter() {
            encoded.append(&weight.to_bytes_be_buffer());
        }

        encoded.append(&threshold.to_bytes_be_buffer());

        self.crypto().keccak256(encoded)
    }

    // TODO: Check for a better way of doing this when ManagedMap is available?
    fn contains_no_duplicate(&self, operators: &ManagedVec<Operator<Self::Api>>) -> bool {
        if operators.is_empty() {
            return false;
        }

        for iindex in 0..(operators.len() - 1) {
            for jindex in (iindex + 1)..operators.len() {
                if operators.get(iindex) == operators.get(jindex) {
                    return false;
                }
            }
        }

        true
    }

    #[event("operatorship_transferred_event")]
    fn operatorship_transferred_event(&self, data: TransferData<Self::Api>);

    #[view]
    #[storage_mapper("epoch_for_hash")]
    fn epoch_for_hash(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<u64>;

    #[view]
    #[storage_mapper("hash_for_epoch")]
    fn hash_for_epoch(
        &self,
        epoch: u64,
    ) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    // This epoch has nothing to do with the blockchain epoch, it is an internal naming convention
    #[view]
    #[storage_mapper("current_epoch")]
    fn current_epoch(&self) -> SingleValueMapper<u64>;
}
