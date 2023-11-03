#![no_std]

multiversx_sc::imports!();

mod constants;
mod events;
mod proxy;

use crate::constants::*;
use crate::events::{ContractCallApprovedData, ContractCallData};
use core::ops::Deref;
use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[multiversx_sc::contract]
pub trait Gateway: proxy::ProxyModule + events::Events {
    #[init]
    fn init(&self, auth_module: &ManagedAddress) {
        require!(
            self.blockchain().is_smart_contract(auth_module),
            "Invalid auth module"
        );

        self.auth_module().set_if_empty(auth_module);
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
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedBuffer,
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
        }

        valid
    }

    // External Functions

    #[endpoint(execute)]
    fn execute(&self, data: ManagedBuffer, proof: ManagedBuffer) {
        let message_hash = self.crypto().keccak256(&data);

        let mut allow_operatorship_transfer: bool = self.auth_validate_proof(&message_hash, &proof);

        // TODO: Should we add chain id here?
        let execute_data: ExecuteData<Self::Api> =
            ExecuteData::<Self::Api>::top_decode(data).unwrap();

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
            let command_id_hash = self.get_is_command_executed_key(command_id);

            if command_executed_mapper.contains(&command_id_hash) {
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
                command_executed_mapper.add(&command_id_hash);

                self.executed_event(command_id);
            }
        }
    }

    // Self Functions

    fn approve_contract_call(
        &self,
        params_raw: &ManagedBuffer,
        command_id: &ManagedBuffer,
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
            ContractCallApprovedData {
                source_tx_hash: params.source_tx_hash,
                source_event_index: params.source_event_index,
            },
        );

        return true;
    }

    fn transfer_operatorship(&self, params: &ManagedBuffer) -> bool {
        self.auth_transfer_operatorship(params);

        self.operatorship_transferred_event(params);

        return true;
    }

    fn get_is_command_executed_key(
        &self,
        command_id: &ManagedBuffer,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        self.crypto().keccak256(command_id)
    }

    fn get_is_contract_call_approved_key(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedBuffer,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        encoded.append(command_id);
        encoded.append(source_chain);
        encoded.append(source_address);
        encoded.append(contract_address.as_managed_buffer());
        encoded.append(payload_hash);

        self.crypto().keccak256(encoded)
    }

    #[view(isCommandExecuted)]
    fn is_command_executed(&self, command_id: &ManagedBuffer) -> bool {
        let hash = self.get_is_command_executed_key(command_id);

        self.command_executed().contains(&hash)
    }

    #[view(isContractCallApproved)]
    fn is_contract_call_approved(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedBuffer,
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
}
