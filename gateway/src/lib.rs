#![no_std]

multiversx_sc::imports!();

mod constants;
mod events;
mod functions;
mod governance;
mod proxy;
mod tokens;

use crate::constants::*;
use crate::events::{ContractCallData, ContractCallWithTokenData};
use core::ops::Deref;

#[multiversx_sc::contract]
pub trait Gateway:
    tokens::Tokens + governance::Governance + functions::Functions + proxy::ProxyModule + events::Events
{
    #[init]
    fn init(&self, auth_module: &ManagedAddress, mint_limiter: &ManagedAddress) {
        require!(
            self.blockchain().is_smart_contract(auth_module),
            "Invalid auth module"
        );

        self.auth_module().set_if_empty(auth_module);
        self.mint_limiter().set_if_empty(mint_limiter);
        self.esdt_issue_cost().set_if_empty(&BigUint::from(DEFAULT_ESDT_ISSUE_COST));
    }

    #[payable("*")]
    #[endpoint(sendToken)]
    fn send_token(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        symbol: ManagedBuffer,
    ) {
        let (token, amount) = self.call_value().egld_or_single_fungible_esdt();

        let caller = self.blockchain().get_caller();

        self.burn_token_from(&caller, &symbol, token, &amount);

        self.token_sent_event(
            caller,
            destination_chain,
            destination_address,
            symbol,
            amount,
        );
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

    #[payable("*")]
    #[endpoint(callContractWithToken)]
    fn call_contract_with_token(
        &self,
        destination_chain: ManagedBuffer,
        destination_contract_address: ManagedBuffer,
        payload: ManagedBuffer,
        symbol: ManagedBuffer,
    ) {
        let (token, amount) = self.call_value().egld_or_single_fungible_esdt();

        let caller = self.blockchain().get_caller();

        self.burn_token_from(&caller, &symbol, token, &amount);

        self.contract_call_with_token_event(
            caller,
            destination_chain,
            destination_contract_address,
            ContractCallWithTokenData {
                hash: self.crypto().keccak256(&payload),
                payload,
                symbol,
                amount,
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

    // Can only be called by the appropriate contract address
    #[endpoint(validateContractCallAndMint)]
    fn validate_contract_call_and_mint(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedBuffer,
        symbol: &ManagedBuffer,
        amount: &BigUint,
    ) -> bool {
        let contract_address = &self.blockchain().get_caller();

        let hash = self.get_is_contract_call_approved_with_mint_key(
            command_id,
            source_chain,
            source_address,
            contract_address,
            payload_hash,
            symbol,
            amount,
        );

        let valid = self.contract_call_approved().contains(&hash);

        if valid {
            self.contract_call_approved().remove(&hash);
            let result = self.mint_token_raw(symbol, contract_address, amount);

            require!(result, "Token does not exist");
        }

        valid
    }

    // External Functions

    #[payable("EGLD")]
    #[endpoint(execute)]
    fn execute(&self, data: ManagedBuffer, proof: ManagedBuffer) {
        // TODO: This hash uses ECDSA.toEthSignedMessageHash in SOL, not sure if there is any equivalent of that on MultiversX
        let message_hash = self.crypto().keccak256(&data);

        let mut allow_operatorship_transfer: bool = self.auth_validate_proof(&message_hash, &proof);

        let execute_data: ExecuteData<Self::Api> =
            ExecuteData::<Self::Api>::top_decode(data).unwrap();

        let commands_length = execute_data.command_ids.len();

        require!(
            commands_length == execute_data.commands.len()
                && commands_length == execute_data.params.len(),
            "Invalid commands"
        );

        let selector_deploy_token = &ManagedBuffer::new_from_bytes(SELECTOR_DEPLOY_TOKEN);
        let selector_mint_token = &ManagedBuffer::new_from_bytes(SELECTOR_MINT_TOKEN);
        let selector_approve_contract_call =
            &ManagedBuffer::new_from_bytes(SELECTOR_APPROVE_CONTRACT_CALL);
        let selector_approve_contract_call_with_mint =
            &ManagedBuffer::new_from_bytes(SELECTOR_APPROVE_CONTRACT_CALL_WITH_MINT);
        let selector_transfer_operatorship =
            &ManagedBuffer::new_from_bytes(SELECTOR_TRANSFER_OPERATORSHIP);
        let selector_set_esdt_issue_cost =
            &ManagedBuffer::new_from_bytes(SELECTOR_SET_ESDT_ISSUE_COST);

        let mut external_deploy_call: Option<AsyncCall> = Option::None;

        for index in 0..commands_length {
            let command_id_ref = execute_data.command_ids.get(index);
            let command_id = command_id_ref.deref();
            let command_id_hash = self.get_is_command_executed_key(command_id);

            if self.command_executed().contains(&command_id_hash) {
                continue;
            }

            let command_ref = execute_data.commands.get(index);
            let command = command_ref.deref();

            let success: bool;

            if command == selector_deploy_token {
                // TODO: Change deploy token to use `async_call_promise` to support multiple token issues in the same transaction?
                require!(
                    external_deploy_call.is_none(),
                    "Only one external token deploy command is allowed per transaction"
                );

                (success, external_deploy_call) =
                    self.deploy_token(execute_data.params.get(index).deref(), command_id);
            } else if command == selector_mint_token {
                success = self.mint_token(execute_data.params.get(index).deref());
            } else if command == selector_approve_contract_call {
                success =
                    self.approve_contract_call(execute_data.params.get(index).deref(), command_id);
            } else if command == selector_approve_contract_call_with_mint {
                success = self.approve_contract_call_with_mint(
                    execute_data.params.get(index).deref(),
                    command_id,
                );
            } else if command == selector_transfer_operatorship {
                if !allow_operatorship_transfer {
                    continue;
                }

                allow_operatorship_transfer = false;
                success = self.transfer_operatorship(execute_data.params.get(index).deref());
            } else if command == selector_set_esdt_issue_cost {
                success = self.set_esdt_issue_cost(execute_data.params.get(index).deref());
            } else {
                continue; // ignore if unknown command received
            }

            if success {
                self.command_executed().add(&command_id_hash);

                self.executed_event(command_id);
            }
        }

        if let Some(deploy_call) = external_deploy_call {
            deploy_call.call_and_exit()
        }
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

    #[view(isContractCallAndMintApproved)]
    fn is_contract_call_and_mint_approved(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedBuffer,
        symbol: &ManagedBuffer,
        amount: &BigUint,
    ) -> bool {
        let hash = self.get_is_contract_call_approved_with_mint_key(
            command_id,
            source_chain,
            source_address,
            contract_address,
            payload_hash,
            symbol,
            amount,
        );

        self.contract_call_approved().contains(&hash)
    }

    #[view(isCommandExecuted)]
    fn is_command_executed(&self, command_id: &ManagedBuffer) -> bool {
        let hash = self.get_is_command_executed_key(command_id);

        self.command_executed().contains(&hash)
    }
}
