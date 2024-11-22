#![no_std]

use multiversx_sc::api::KECCAK256_RESULT_LEN;

use crate::constants::*;

multiversx_sc::imports!();

mod auth;
mod constants;
mod events;
mod operator;

#[multiversx_sc::contract]
pub trait Gateway: auth::AuthModule + operator::OperatorModule + events::Events {
    #[init]
    fn init(
        &self,
        previous_signers_retention: BigUint,
        domain_separator: ManagedByteArray<KECCAK256_RESULT_LEN>,
        minimum_rotation_delay: u64,
        operator: ManagedAddress,
        signers: MultiValueEncoded<WeightedSigners<Self::Api>>,
    ) {
        self.previous_signers_retention()
            .set(previous_signers_retention);
        self.domain_separator().set(domain_separator);
        self.minimum_rotation_delay().set(minimum_rotation_delay);

        self.upgrade(operator, signers);
    }

    #[upgrade]
    fn upgrade(
        &self,
        operator: ManagedAddress,
        signers: MultiValueEncoded<WeightedSigners<Self::Api>>,
    ) {
        if !operator.is_zero() {
            self.transfer_operatorship_raw(operator);
        }

        for signer in signers.into_iter() {
            self.rotate_signers_raw(signer, false);
        }
    }

    /// External Functions

    #[endpoint(approveMessages)]
    fn approve_messages(&self, messages: ManagedBuffer, proof: Proof<Self::Api>) {
        let data_hash = self.get_data_hash(CommandType::ApproveMessages, &messages);

        // Decode manually since it is more efficient to do it after we calculate the above hash
        let messages: ManagedVec<Self::Api, Message<Self::Api>> =
            ManagedVec::<Self::Api, Message<Self::Api>>::top_decode(messages)
                .unwrap_or_else(|_| sc_panic!("Could not decode messages"));

        require!(!messages.is_empty(), "Invalid messages");

        let _ = self.validate_proof(data_hash, proof);

        for message in messages.into_iter() {
            self.approve_message(message);
        }
    }

    #[endpoint(rotateSigners)]
    fn rotate_signers(&self, new_signers: ManagedBuffer, proof: Proof<Self::Api>) {
        let data_hash = self.get_data_hash(CommandType::RotateSigners, &new_signers);

        // Decode manually since it is more efficient to do it after we calculate the above hash
        let new_signers: WeightedSigners<Self::Api> =
            WeightedSigners::<Self::Api>::top_decode(new_signers)
                .unwrap_or_else(|_| sc_panic!("Could not decode new signers"));

        let enforce_rotation_delay = self.blockchain().get_caller() != self.operator().get();
        let is_latest_signers = self.validate_proof(data_hash, proof);

        require!(
            !enforce_rotation_delay || is_latest_signers,
            "Not latest signers"
        );

        self.rotate_signers_raw(new_signers, enforce_rotation_delay);
    }

    /// Public Methods

    #[endpoint(callContract)]
    fn call_contract(
        &self,
        destination_chain: ManagedBuffer,
        destination_contract_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        self.contract_call_event(
            self.blockchain().get_caller(),
            destination_chain,
            destination_contract_address,
            self.crypto().keccak256(&payload),
            payload,
        );
    }

    // Can only be called by the appropriate contract address
    #[endpoint(validateMessage)]
    fn validate_message(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        let cross_chain_id = CrossChainId {
            source_chain,
            message_id,
        };

        let message_hash = self.message_hash(
            &cross_chain_id,
            source_address,
            &self.blockchain().get_caller(),
            payload_hash,
        );

        let messages_mapper = self.messages(&cross_chain_id);
        let valid = messages_mapper.get() == MessageState::Approved(message_hash);

        if valid {
            messages_mapper.set(MessageState::Executed);

            self.message_executed_event(&cross_chain_id.source_chain, &cross_chain_id.message_id);
        }

        valid
    }

    // Self Functions

    fn approve_message(&self, message: Message<Self::Api>) {
        let cross_chain_id = CrossChainId {
            source_chain: message.source_chain,
            message_id: message.message_id,
        };

        let messages_mapper = self.messages(&cross_chain_id);

        if messages_mapper.get() != MessageState::NonExistent {
            return;
        }

        let message_hash = self.message_hash(
            &cross_chain_id,
            &message.source_address,
            &message.contract_address,
            &message.payload_hash,
        );

        messages_mapper.set(MessageState::Approved(message_hash));

        self.message_approved_event(
            cross_chain_id.source_chain,
            cross_chain_id.message_id,
            message.source_address,
            message.contract_address,
            message.payload_hash,
        );
    }

    fn message_hash(
        &self,
        cross_chain_id: &CrossChainId<Self::Api>,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        cross_chain_id
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode cross chain id"));
        source_address
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode source address"));
        contract_address
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode contract address"));
        payload_hash
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode payload hash"));

        self.crypto().keccak256(encoded)
    }

    fn get_data_hash(
        &self,
        command_type: CommandType,
        buffer: &ManagedBuffer,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        let result = command_type.dep_encode(&mut encoded);
        require!(result.is_ok(), "Could not encode data hash");

        encoded.append(buffer);

        self.crypto().keccak256(encoded)
    }

    #[view(isMessageApproved)]
    fn is_message_approved(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        let cross_chain_id = CrossChainId {
            source_chain,
            message_id,
        };

        let message_hash = self.message_hash(
            &cross_chain_id,
            source_address,
            contract_address,
            payload_hash,
        );

        self.messages(&cross_chain_id).get() == MessageState::Approved(message_hash)
    }

    #[view(isMessageExecuted)]
    fn is_message_executed(&self, source_chain: ManagedBuffer, message_id: ManagedBuffer) -> bool {
        let cross_chain_id = CrossChainId {
            source_chain,
            message_id,
        };

        self.messages(&cross_chain_id).get() == MessageState::Executed
    }

    #[view(messages)]
    #[storage_mapper("messages")]
    fn messages(
        &self,
        cross_chain_id: &CrossChainId<Self::Api>,
    ) -> SingleValueMapper<MessageState<Self::Api>>;
}
