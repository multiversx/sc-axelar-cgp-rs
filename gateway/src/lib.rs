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
use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[multiversx_sc::contract]
pub trait Gateway:
    tokens::Tokens + governance::Governance + functions::Functions + proxy::ProxyModule + events::Events
{
    #[init]
    fn init(&self, auth_module: &ManagedAddress, token_deployer_implementation: &ManagedAddress) {
        require!(
            self.blockchain().is_smart_contract(auth_module),
            "Invalid auth module"
        );
        require!(
            self.blockchain()
                .is_smart_contract(token_deployer_implementation),
            "Invalid token deployer"
        );

        if self.auth_module().is_empty() {
            self.auth_module().set(auth_module);
        }

        if self.token_deployer_implementation().is_empty() {
            self.token_deployer_implementation()
                .set(token_deployer_implementation);
        }
    }

    #[payable("*")]
    #[endpoint(sendToken)]
    fn send_token(&self, destination_chain: ManagedBuffer, destination_address: ManagedBuffer) {
        let (symbol, amount) = self.call_value().egld_or_single_fungible_esdt();

        let caller = self.blockchain().get_caller();

        self.burn_token_from(&caller, &symbol, &amount);

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
    ) {
        let (symbol, amount) = self.call_value().egld_or_single_fungible_esdt();

        let caller = self.blockchain().get_caller();

        self.burn_token_from(&caller, &symbol, &amount);

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
        symbol: &EgldOrEsdtTokenIdentifier,
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
    // TODO: Should `setup` function be implemented? And if so, how should the authentication work?
    // It seems to be related to a proxy which I don't think we will implement on MultiversX

    #[payable("*")]
    // Needs to be payable since tokens can be issued; TODO: Should we add some checks for these amounts?
    #[endpoint(execute)]
    fn execute(&self, data: ManagedBuffer, proof: ManagedBuffer) {
        // TODO: This hash uses ECDSA.toEthSignedMessageHash in SOL, not sure if there is any equivalent of that on MultiversX
        let message_hash = self.crypto().keccak256(&data);

        let mut allow_operatorship_transfer: bool = self.auth_validate_proof(&message_hash, &proof);

        // TODO: Should we improve this and have the struct fields as function arguments instead?
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
        let selector_burn_token = &ManagedBuffer::new_from_bytes(SELECTOR_BURN_TOKEN);
        let selector_transfer_operatorship =
            &ManagedBuffer::new_from_bytes(SELECTOR_TRANSFER_OPERATORSHIP);

        for index in 0..commands_length {
            let command_id_ref = execute_data.command_ids.get(index);
            let command_id = command_id_ref.deref();
            let command_id_hash = self.get_is_command_executed_key(command_id);

            if self.command_executed().contains(&command_id_hash) {
                continue;
            }

            // TODO: In the SOL contract, this comparison is done using keccak256, but since we can not store
            // those as constants I just left normal comparisons here without hash, should be the same
            let command_ref = execute_data.commands.get(index);
            let command = command_ref.deref();

            let success: bool;

            if command == selector_deploy_token {
                success = self.deploy_token(execute_data.params.get(index).deref());
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
            } else if command == selector_burn_token {
                success = self.burn_token(execute_data.params.get(index).deref());
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
                self.command_executed().add(&command_id_hash);

                self.executed_event(command_id);
            }
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
        symbol: &EgldOrEsdtTokenIdentifier,
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

    // TODO: Is this really needed? What is it used for?
    #[view(contractId)]
    fn contract_id(&self) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        self.crypto()
            .keccak256(ManagedBuffer::new_from_bytes(AXELAR_GATEWAY))
    }

    fn get_is_command_executed_key(
        &self,
        command_id: &ManagedBuffer,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let prefix: ManagedByteArray<KECCAK256_RESULT_LEN> = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_COMMAND_EXECUTED));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix.as_managed_buffer());
        encoded.append(command_id);

        self.crypto().keccak256(encoded)
    }

    // TODO: This is currently unused. For what should we use it?
    #[view(tokenDeployer)]
    #[storage_mapper("token_deployer_implementation")]
    fn token_deployer_implementation(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("command_executed")]
    fn command_executed(&self) -> WhitelistMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    // TODO: Functions not yet implemented:
    // setup - not sure how this can be implented and if relevant with native upgrading of MultiversX
    // _hasCode - no equivalent on MultiversX
    // _getCreate2Address - not sure how to handle the DepositHandler from sol
    // _setImplementation - since MultiversX supports native upgrades, nothing related to that was put here
    // upgrade - function was not implemented since MultiversX contracts are upgradable
}
