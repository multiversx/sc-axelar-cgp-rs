#![no_std]

multiversx_sc::imports!();

mod constants;
mod events;
mod tokens;

use crate::constants::*;
use crate::events::{ContractCallData, ContractCallWithTokenData};

#[multiversx_sc::contract]
pub trait Gateway: tokens::Tokens + events::Events {
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

        let hash = self.get_is_contract_call_approved_key(command_id, source_chain, source_address, contract_address, payload_hash);

        let valid = self.approved_key_bool().contains(&hash);

        if valid {
            self.approved_key_bool().remove(&hash);
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

        let hash = self.get_is_contract_call_approved_with_mint_key(command_id, source_chain, source_address, contract_address, payload_hash, symbol.clone(), amount);

        let valid = self.approved_key_bool().contains(&hash);

        if valid {
            self.approved_key_bool().remove(&hash);
            self.mint_token(symbol, contract_address, amount);
        }

        valid
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
        let hash = self.get_is_contract_call_approved_key(command_id, source_chain, source_address, contract_address, payload_hash);

        self.approved_key_bool().contains(&hash)
    }

    #[view(isContractCallAndMintApproved)]
    fn is_contract_call_and_mint_approved(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedBuffer,
        symbol: EgldOrEsdtTokenIdentifier,
        amount: &BigUint,
    ) -> bool {
        let hash = self.get_is_contract_call_approved_with_mint_key(command_id, source_chain, source_address, contract_address, payload_hash, symbol, amount);

        self.approved_key_bool().contains(&hash)
    }

    fn get_is_contract_call_approved_key(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedBuffer,
    ) -> ManagedByteArray<32> {
        let prefix: ManagedByteArray<32> = self.crypto().keccak256(ManagedBuffer::new_from_bytes(PREFIX_CONTRACT_CALL_APPROVED));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix.as_managed_buffer());
        encoded.append(command_id);
        encoded.append(source_chain);
        encoded.append(source_address);
        encoded.append(contract_address.as_managed_buffer());
        encoded.append(payload_hash);

        self.crypto().keccak256(encoded)
    }

    fn get_is_contract_call_approved_with_mint_key(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedBuffer,
        symbol: EgldOrEsdtTokenIdentifier,
        amount: &BigUint,
    ) -> ManagedByteArray<32> {
        let prefix: ManagedByteArray<32> = self.crypto().keccak256(ManagedBuffer::new_from_bytes(PREFIX_CONTRACT_CALL_APPROVED_WITH_MINT));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix.as_managed_buffer());
        encoded.append(command_id);
        encoded.append(source_chain);
        encoded.append(source_address);
        encoded.append(contract_address.as_managed_buffer());
        encoded.append(payload_hash);
        encoded.append(&symbol.into_name());
        encoded.append(&amount.to_bytes_be_buffer());

        self.crypto().keccak256(encoded)
    }

    fn only_governance(&self, caller: ManagedAddress) {
        require!(
            caller
                == self
                    .get_address(ManagedBuffer::new_from_bytes(KEY_GOVERNANCE))
                    .get(),
            "Not governance"
        );
    }

    // @dev Reverts with an error if the sender is not the mint limiter or governance.
    fn only_mint_limiter(&self, caller: ManagedAddress) {
        let mint_limiter = self
            .get_address(ManagedBuffer::new_from_bytes(KEY_MINT_LIMITER))
            .get();

        let governance = self
            .get_address(ManagedBuffer::new_from_bytes(KEY_GOVERNANCE))
            .get();

        require!(
            caller == mint_limiter || caller == governance,
            "Not mint limiter"
        );
    }

    #[storage_mapper("auth_module")]
    fn auth_module(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("token_deployer_implementation")]
    fn token_deployer_implementation(&self) -> SingleValueMapper<ManagedAddress>;

    // TODO: Modify these to independent storages?
    #[storage_mapper("get_address")]
    fn get_address(&self, key: ManagedBuffer) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("approved_key_bool")]
    fn approved_key_bool(&self) -> WhitelistMapper<ManagedByteArray<32>>;
}
