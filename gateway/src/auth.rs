use multiversx_sc::api::{ED25519_SIGNATURE_BYTE_LEN, KECCAK256_RESULT_LEN};

use crate::constants::{Proof, WeightedSigners, MULTIVERSX_SIGNED_MESSAGE_PREFIX};
use crate::events;

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait AuthModule: events::Events {
    /// Integration Functions

    #[view(validateProof)]
    fn validate_proof(
        &self,
        data_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
        proof: Proof<Self::Api>,
    ) -> bool {
        let signers = proof.signers;

        let signers_hash = self.get_signers_hash(&signers);
        let signer_epoch = self.epoch_by_signer_hash(&signers_hash).get();
        let current_epoch = self.epoch().get();

        let is_latest_signers = signer_epoch == current_epoch;

        require!(
            signer_epoch > 0
                && current_epoch - signer_epoch <= self.previous_signers_retention().get(),
            "Invalid signers"
        );

        let message_hash = self.message_hash_to_sign(&signers_hash, &data_hash);

        self.validate_signatures(message_hash, signers, proof.signatures);

        is_latest_signers
    }

    fn rotate_signers_raw(
        &self,
        new_signers: WeightedSigners<Self::Api>,
        enforce_rotation_delay: bool,
    ) {
        self.validate_signers(&new_signers);

        self.update_rotation_timestamp(enforce_rotation_delay);

        let new_signers_hash = self.get_signers_hash(&new_signers);

        let new_epoch = self.epoch().update(|epoch| {
            *epoch += BigUint::from(1u64);
            epoch.clone()
        });

        self.signer_hash_by_epoch(&new_epoch).set(&new_signers_hash);

        let epoch_for_hash_mapper = self.epoch_by_signer_hash(&new_signers_hash);

        require!(epoch_for_hash_mapper.is_empty(), "Duplicate signers");

        epoch_for_hash_mapper.set(&new_epoch);

        self.signers_rotated_event(new_epoch, new_signers_hash, new_signers);
    }

    /// Internal Functions

    fn update_rotation_timestamp(&self, enforce_rotation_delay: bool) {
        let last_rotation_timestamp_mapper = self.last_rotation_timestamp();
        let last_rotation_timestamp = last_rotation_timestamp_mapper.get();
        let current_timestamp = self.blockchain().get_block_timestamp();

        require!(
            !enforce_rotation_delay
                || (current_timestamp - last_rotation_timestamp)
                    >= self.minimum_rotation_delay().get(),
            "Insufficient rotation delay"
        );

        last_rotation_timestamp_mapper.set(current_timestamp);
    }

    // Signatures need to have the same length as signers, but some signers could have not signed
    // the message hash, so for those signers we have the signature None instead.
    // Signers are ordered and the signatures will also need to be in the same order
    fn validate_signatures(
        &self,
        message_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
        weighted_signers: WeightedSigners<Self::Api>,
        signatures: ManagedVec<Option<ManagedByteArray<ED25519_SIGNATURE_BYTE_LEN>>>,
    ) {
        let signers = weighted_signers.signers;

        require!(
            !signatures.is_empty() && signers.len() == signatures.len(),
            "Low signatures weight"
        );

        let mut total_weight = BigUint::zero();

        for (signer_index, signature) in signatures.iter().enumerate() {
            if signature.is_none() {
                continue;
            }

            let signer = signers.get(signer_index);

            self.crypto().verify_ed25519(
                signer.signer.as_managed_buffer(),
                message_hash.as_managed_buffer(),
                signature.unwrap().as_managed_buffer(),
            );

            total_weight += signer.weight;

            if total_weight >= weighted_signers.threshold {
                return;
            }
        }

        sc_panic!("Low signatures weight");
    }

    fn message_hash_to_sign(
        &self,
        signers_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        data_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        encoded.append(&ManagedBuffer::from(MULTIVERSX_SIGNED_MESSAGE_PREFIX));
        encoded.append(self.domain_separator().get().as_managed_buffer());
        encoded.append(signers_hash.as_managed_buffer());
        encoded.append(data_hash.as_managed_buffer());

        self.crypto().keccak256(encoded)
    }

    fn validate_signers(&self, weighted_signers: &WeightedSigners<Self::Api>) {
        let signers = &weighted_signers.signers;

        require!(!signers.is_empty(), "Invalid signers");

        let mut total_weight = BigUint::zero();
        let mut prev_signer = BigUint::zero();

        for weighted_signer in signers.into_iter() {
            let curr_signer =
                BigUint::from_bytes_be_buffer(weighted_signer.signer.as_managed_buffer());

            require!(curr_signer > prev_signer, "Invalid signers");

            prev_signer = curr_signer;

            require!(weighted_signer.weight > 0, "Invalid weights");

            total_weight += &weighted_signer.weight;
        }

        require!(
            weighted_signers.threshold > 0 && total_weight >= weighted_signers.threshold,
            "Invalid threshold"
        );
    }

    fn get_signers_hash(
        &self,
        signers: &WeightedSigners<Self::Api>,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        signers.signers
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode signers"));
        signers.threshold
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode threshold"));
        signers.nonce
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode nonce"));

        self.crypto().keccak256(encoded)
    }

    #[view(timeSinceRotation)]
    fn time_since_rotation(&self) -> u64 {
        self.blockchain().get_block_timestamp() - self.last_rotation_timestamp().get()
    }

    // This epoch has nothing to do with the blockchain epoch, it is an internal naming convention
    #[view]
    #[storage_mapper("epoch")]
    fn epoch(&self) -> SingleValueMapper<BigUint>;

    #[view(lastRotationTimestamp)]
    #[storage_mapper("last_rotation_timestamp")]
    fn last_rotation_timestamp(&self) -> SingleValueMapper<u64>;

    #[view(signerHashByEpoch)]
    #[storage_mapper("signer_hash_by_epoch")]
    fn signer_hash_by_epoch(
        &self,
        epoch: &BigUint,
    ) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[view(epochBySignerHash)]
    #[storage_mapper("epoch_by_signer_hash")]
    fn epoch_by_signer_hash(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<BigUint>;

    /// @dev Previous signers retention. 0 means only the current signers are valid
    /// @return The number of epochs to keep the signers valid for signature verification
    #[view(previousSignersRetention)]
    #[storage_mapper("previous_signers_retention")]
    fn previous_signers_retention(&self) -> SingleValueMapper<BigUint>;

    /// @dev The domain separator for the signer proof
    /// @return The domain separator for the signer proof
    #[view(domainSeparator)]
    #[storage_mapper("domain_separator")]
    fn domain_separator(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    /// @dev The minimum delay required between rotations
    /// @return The minimum delay required between rotations
    #[view(minimumRotationDelay)]
    #[storage_mapper("minimum_rotation_delay")]
    fn minimum_rotation_delay(&self) -> SingleValueMapper<u64>;
}
