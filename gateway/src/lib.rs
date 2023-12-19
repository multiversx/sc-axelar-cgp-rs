#![no_std]

use core::ops::Deref;

use multiversx_sc::api::KECCAK256_RESULT_LEN;

use crate::constants::*;
use crate::events::{ContractCallData};

multiversx_sc::imports!();

mod constants;
mod events;
mod proxy;

#[multiversx_sc::contract]
pub trait Gateway: proxy::ProxyModule + events::Events {
    #[init]
    fn init(&self, auth_module: &ManagedAddress, chain_id: &ManagedBuffer) {
        require!(
            self.blockchain().is_smart_contract(auth_module),
            "Invalid auth module"
        );

        self.auth_module().set_if_empty(auth_module);
        self.chain_id().set_if_empty(chain_id);
    }

    #[endpoint(callContract)]
    fn call_contract(
        &self,
        destination_chain: ManagedBuffer,
        destination_contract_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        let caller = self.blockchain().get_caller();

        self.contract_call_event(
            caller,
            destination_chain,
            destination_contract_address,
            ContractCallData {
                hash: self.crypto().keccak256(&payload),
                payload,
            },
        );
    }

    // Can only be called by the appropriate contract address
    #[endpoint(validateContractCall)]
    fn validate_contract_call(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        let contract_address = &self.blockchain().get_caller();

        let hash = self.get_is_contract_call_approved_key(
            command_id,
            source_chain,
            source_address,
            contract_address,
            payload_hash,
        );

        let valid = self.contract_call_approved().contains(&hash);

        if valid {
            self.contract_call_approved().remove(&hash);

            self.contract_call_executed_event(command_id);
        }

        valid
    }

    // External Functions

    #[endpoint(execute)]
    fn execute(&self, input: ExecuteInput<Self::Api>) {
        let message_hash = self.get_message_hash(&input.data);

        let mut allow_operatorship_transfer: bool =
            self.auth_validate_proof(&message_hash, &input.proof);

        let execute_data: ExecuteData<Self::Api> =
            ExecuteData::<Self::Api>::top_decode(input.data).unwrap();

        require!(
            execute_data.chain_id == self.chain_id().get(),
            "Invalid chain id"
        );

        let commands_length = execute_data.command_ids.len();

        require!(
            commands_length == execute_data.commands.len()
                && commands_length == execute_data.params.len(),
            "Invalid commands"
        );

        let selector_approve_contract_call =
            &ManagedBuffer::new_from_bytes(SELECTOR_APPROVE_CONTRACT_CALL);
        let selector_transfer_operatorship =
            &ManagedBuffer::new_from_bytes(SELECTOR_TRANSFER_OPERATORSHIP);

        let command_executed_mapper = self.command_executed();
        for index in 0..commands_length {
            let command_id_ref = execute_data.command_ids.get(index);
            let command_id = command_id_ref.deref();

            if command_executed_mapper.contains(command_id) {
                continue;
            }

            let command_ref = execute_data.commands.get(index);
            let command = command_ref.deref();

            let success: bool;

            if command == selector_approve_contract_call {
                success =
                    self.approve_contract_call(execute_data.params.get(index).deref(), command_id);
            } else if command == selector_transfer_operatorship {
                if !allow_operatorship_transfer {
                    continue;
                }

                allow_operatorship_transfer = false;
                success = self.transfer_operatorship(execute_data.params.get(index).deref());
            } else {
                continue; // ignore if unknown command received
            }

            if success {
                command_executed_mapper.add(command_id);

                self.executed_event(command_id);
            }
        }
    }

    // Self Functions

    fn approve_contract_call(
        &self,
        params_raw: &ManagedBuffer,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        let params: ApproveContractCallParams<Self::Api> =
            ApproveContractCallParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        let hash = self.get_is_contract_call_approved_key(
            command_id,
            &params.source_chain,
            &params.source_address,
            &params.contract_address,
            &params.payload_hash,
        );

        self.contract_call_approved().add(&hash);

        self.contract_call_approved_event(
            command_id,
            params.source_chain,
            params.source_address,
            params.contract_address,
            params.payload_hash,
        );

        true
    }

    fn transfer_operatorship(&self, params: &ManagedBuffer) -> bool {
        self.auth_transfer_operatorship(params);

        self.operatorship_transferred_event(params);

        true
    }

    fn get_is_contract_call_approved_key(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        encoded.append(command_id.as_managed_buffer());
        encoded.append(source_chain);
        encoded.append(source_address);
        encoded.append(contract_address.as_managed_buffer());
        encoded.append(payload_hash.as_managed_buffer());

        self.crypto().keccak256(encoded)
    }

    fn get_message_hash(&self, data: &ManagedBuffer) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        encoded.append(&ManagedBuffer::from(MULTIVERSX_SIGNED_MESSAGE_PREFIX));
        encoded.append(data);

        self.crypto().keccak256(encoded)
    }

    #[view(isCommandExecuted)]
    fn is_command_executed(&self, command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>) -> bool {
        self.command_executed().contains(command_id)
    }

    #[view(isContractCallApproved)]
    fn is_contract_call_approved(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        let hash = self.get_is_contract_call_approved_key(
            command_id,
            source_chain,
            source_address,
            contract_address,
            payload_hash,
        );

        self.contract_call_approved().contains(&hash)
    }

    #[storage_mapper("command_executed")]
    fn command_executed(&self) -> WhitelistMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[storage_mapper("contract_call_approved")]
    fn contract_call_approved(&self) -> WhitelistMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[view]
    #[storage_mapper("chain_id")]
    fn chain_id(&self) -> SingleValueMapper<ManagedBuffer>;
}
