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
        previous_signers_rotation: BigUint,
        domain_separator: ManagedByteArray<KECCAK256_RESULT_LEN>,
        minimum_rotation_delay: u64,
        operator: ManagedAddress,
        signers: MultiValueEncoded<WeightedSigners<Self::Api>>,
    ) {
        self.previous_signers_retention()
            .set(previous_signers_rotation);
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

        let _ = self.validate_proof(data_hash, proof);

        require!(!messages.is_empty(), "Invalid messages");

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

        let enfore_rotation_delay = self.blockchain().get_caller() != self.operator().get();
        let is_latest_signers = self.validate_proof(data_hash, proof);

        require!(
            !enfore_rotation_delay || is_latest_signers,
            "Not latest signers"
        );

        self.rotate_signers_raw(new_signers, enfore_rotation_delay);
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
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        let command_id = self.message_to_command_id(source_chain, message_id);

        let message_hash = self.message_hash(
            source_chain,
            message_id,
            source_address,
            &self.blockchain().get_caller(),
            payload_hash,
        );

        let messages_mapper = self.messages(&command_id);
        let valid = messages_mapper.get() == MessageState::Approved(message_hash);

        if valid {
            messages_mapper.set(MessageState::Executed);

            self.message_executed_event(&command_id, source_chain, message_id);
        }

        valid
    }

    // Self Functions

    fn approve_message(&self, message: Message<Self::Api>) {
        let command_id = self.message_to_command_id(&message.source_chain, &message.message_id);

        let messages_mapper = self.messages(&command_id);

        if messages_mapper.get() != MessageState::NonExistent {
            return;
        }

        let message_hash = self.message_hash(
            &message.source_chain,
            &message.message_id,
            &message.source_address,
            &message.contract_address,
            &message.payload_hash,
        );

        messages_mapper.set(MessageState::Approved(message_hash));

        self.message_approved_event(
            &command_id,
            message.source_chain,
            message.message_id,
            message.source_address,
            message.contract_address,
            message.payload_hash,
        );
    }

    fn message_hash(
        &self,
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        encoded.append(source_chain);
        encoded.append(message_id);
        encoded.append(source_address);
        encoded.append(contract_address.as_managed_buffer());
        encoded.append(payload_hash.as_managed_buffer());

        self.crypto().keccak256(encoded)
    }

    fn get_data_hash(
        &self,
        command_type: CommandType,
        buffer: &ManagedBuffer,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        let result = command_type.top_encode(&mut encoded);

        require!(result.is_ok(), "Cnould not encode data hash");

        encoded.append(buffer);

        self.crypto().keccak256(encoded)
    }

    fn message_to_command_id(
        &self,
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        // Axelar doesn't allow `sourceChain` to contain '_', hence this encoding is umambiguous
        let mut encoded = ManagedBuffer::new();

        encoded.append(source_chain);
        encoded.append(&ManagedBuffer::from("_"));
        encoded.append(message_id);

        self.crypto().keccak256(encoded)
    }

    #[view(isMessageApproved)]
    fn is_message_approved(
        &self,
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        let command_id = self.message_to_command_id(source_chain, message_id);

        let message_hash = self.message_hash(
            source_chain,
            message_id,
            source_address,
            contract_address,
            payload_hash,
        );

        self.messages(&command_id).get() == MessageState::Approved(message_hash)
    }

    #[view(isMessageExecuted)]
    fn is_message_executed(
        &self,
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
    ) -> bool {
        self.messages(&self.message_to_command_id(&source_chain, &message_id))
            .get()
            == MessageState::Executed
    }

    #[view(messages)]
    #[storage_mapper("messages")]
    fn messages(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<MessageState<Self::Api>>;
}
