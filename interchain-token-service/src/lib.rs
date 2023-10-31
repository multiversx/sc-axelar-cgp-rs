#![no_std]

use core::convert::TryFrom;
use core::ops::Deref;

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use multiversx_sc::codec::{EncodeError};

use crate::abi::{AbiEncodeDecode, ParamType};
use crate::constants::{
    Metadata, SendTokenPayload, TokenId, TokenManagerType, PREFIX_CUSTOM_TOKEN_ID,
    PREFIX_STANDARDIZED_TOKEN_ID, SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN,
    SELECTOR_DEPLOY_TOKEN_MANAGER, SELECTOR_RECEIVE_TOKEN, SELECTOR_RECEIVE_TOKEN_WITH_DATA,
};
use crate::proxy::CallbackProxy;

multiversx_sc::imports!();

pub mod abi;
pub mod constants;
pub mod events;
pub mod executable;
pub mod proxy;
pub mod remote;

#[multiversx_sc::contract]
pub trait InterchainTokenServiceContract:
    proxy::ProxyModule
    + executable::ExecutableModule
    + events::EventsModule
    + remote::RemoteModule
    + multiversx_sc_modules::pause::PauseModule
{
    #[init]
    fn init(
        &self,
        gateway: ManagedAddress,
        gas_service: ManagedAddress,
        remote_address_validator: ManagedAddress,
        token_manager_mint_burn: ManagedAddress,
        token_manager_lock_unlock: ManagedAddress,
    ) {
        require!(
            !remote_address_validator.is_zero()
                && !gas_service.is_zero()
                && !gateway.is_zero()
                && !token_manager_mint_burn.is_zero()
                && !token_manager_lock_unlock.is_zero(),
            "Zero address"
        );

        self.gateway().set_if_empty(gateway);
        self.gas_service().set_if_empty(gas_service);
        self.remote_address_validator()
            .set_if_empty(remote_address_validator);
        self.implementation_mint_burn()
            .set_if_empty(token_manager_mint_burn);
        self.implementation_lock_unlock()
            .set_if_empty(token_manager_lock_unlock);

        let chain_name = self.remote_address_validator_chain_name();
        self.chain_name_hash()
            .set_if_empty(self.crypto().keccak256(chain_name));
    }

    /// User Functions

    #[endpoint(registerCanonicalToken)]
    fn register_canonical_token(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();

        self.validate_token(&token_identifier);

        let token_id = self.get_canonical_token_id(&token_identifier);

        self.deploy_token_manager(
            &token_id,
            TokenManagerType::LockUnlock,
            self.blockchain().get_sc_address(),
            Some(token_identifier),
        );

        token_id
    }

    #[payable("EGLD")]
    #[endpoint(deployRemoteCanonicalToken)]
    fn deploy_remote_canonical_token(
        &self,
        token_id: TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
    ) {
        self.require_not_paused();

        let token_identifier = self.get_token_identifier(&token_id);

        require!(
            self.get_canonical_token_id(&token_identifier) == token_id,
            "Not canonical token manager"
        );

        let gas_value = self.call_value().egld_value().clone_value();

        // We can only fetch token properties from esdt contract if it is not EGLD not
        if token_identifier.is_egld() {
            self.deploy_remote_standardized_token(
                token_id,
                token_identifier.clone().into_name(),
                token_identifier.into_name(),
                18, // EGLD token has 18 decimals
                ManagedBuffer::new(),
                ManagedBuffer::new(),
                BigUint::zero(),
                ManagedBuffer::new(),
                destination_chain,
                gas_value,
            );

            return;
        }

        self.esdt_get_token_properties(
            token_identifier.clone(),
            self.callbacks().deploy_remote_token_callback(
                token_id,
                token_identifier,
                destination_chain,
                gas_value,
                self.blockchain().get_caller(),
            ),
        );
    }

    #[endpoint(deployCustomTokenManager)]
    fn deploy_custom_token_manager(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
        token_manager_type: TokenManagerType,
        operator: ManagedAddress,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();

        self.validate_token(&token_identifier);

        let deployer = self.blockchain().get_caller();

        let token_name = token_identifier.clone().into_name();

        let token_id = self.get_custom_token_id(&deployer, &token_name);

        self.deploy_token_manager(
            &token_id,
            token_manager_type,
            operator,
            Some(token_identifier),
        );

        self.custom_token_id_claimed_event(&token_id, deployer, token_name);

        token_id
    }

    #[payable("EGLD")]
    #[endpoint(deployRemoteCustomTokenManager)]
    fn deploy_remote_custom_token_manager(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
        destination_chain: ManagedBuffer,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();

        self.validate_token(&token_identifier);

        let deployer = self.blockchain().get_caller();

        let token_name = token_identifier.into_name();

        let token_id = self.get_custom_token_id(&deployer, &token_name);

        let gas_value = self.call_value().egld_value().clone_value();

        self.deploy_remote_token_manager(
            &token_id,
            destination_chain,
            gas_value,
            token_manager_type,
            params,
        );

        self.custom_token_id_claimed_event(&token_id, deployer, token_name);

        token_id
    }

    // Needs to be payable because it issues ESDT token through the TokenManager
    #[payable("EGLD")]
    #[endpoint(deployAndRegisterStandardizedToken)]
    fn deploy_and_register_standardized_token(
        &self,
        salt: ManagedBuffer,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        mint_amount: BigUint,
        distributor: ManagedAddress,
    ) {
        self.require_not_paused();

        let sender = self.blockchain().get_caller();

        let token_id = self.get_custom_token_id(&sender, &salt);

        // On first transaction, deploy the token manager and on second transaction deploy ESDT through the token manager
        // This is because we can not deploy token manager and call it to deploy the token in the same transaction
        let token_manager_address_mapper = self.token_manager_address(&token_id);
        if token_manager_address_mapper.is_empty() {
            require!(
                self.call_value().egld_value().deref() == &BigUint::zero(),
                "Can not send EGLD payment if not issuing ESDT"
            );

            self.deploy_token_manager(
                &token_id,
                TokenManagerType::MintBurn,
                self.blockchain().get_caller(),
                None,
            );

            return;
        }

        self.token_manager_deploy_standardized_token(
            &token_id,
            distributor,
            name,
            symbol,
            decimals,
            mint_amount,
            sender,
        );
    }

    #[payable("EGLD")]
    #[endpoint(deployAndRegisterRemoteStandardizedToken)]
    fn deploy_and_register_remote_standardized_token(
        &self,
        salt: ManagedBuffer,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        distributor: ManagedBuffer,
        mint_to: ManagedBuffer,
        mint_amount: BigUint,
        operator: ManagedBuffer,
        destination_chain: ManagedBuffer,
    ) {
        self.require_not_paused();

        let token_id = self.get_custom_token_id(&self.blockchain().get_caller(), &salt);

        let gas_value = self.call_value().egld_value().clone_value();

        self.deploy_remote_standardized_token(
            token_id,
            name,
            symbol,
            decimals,
            distributor,
            mint_to,
            mint_amount,
            operator,
            destination_chain,
            gas_value,
        );
    }

    #[payable("*")]
    #[endpoint(expressReceiveToken)]
    fn express_receive_token(
        &self,
        payload: ManagedBuffer,
        command_id: ManagedBuffer,
        source_chain: ManagedBuffer,
    ) {
        require!(
            !self.gateway_is_command_executed(&command_id),
            "Already executed"
        );

        let caller = self.blockchain().get_caller();

        let express_hash = self.set_express_receive_token(&payload, &command_id, &caller);

        let receive_token_payload: SendTokenPayload<Self::Api> =
            SendTokenPayload::<Self::Api>::abi_decode(payload);

        let token_identifier = self.get_token_identifier(&receive_token_payload.token_id);

        let destination_address =
            ManagedAddress::try_from(receive_token_payload.destination_address).unwrap();

        let (sent_token_identifier, sent_amount) = self.call_value().egld_or_single_fungible_esdt();

        require!(
            sent_token_identifier == token_identifier
                && sent_amount == receive_token_payload.amount,
            "Wrong token or amount sent"
        );

        if receive_token_payload.selector == SELECTOR_RECEIVE_TOKEN_WITH_DATA {
            self.executable_contract_express_execute_with_interchain_token(
                destination_address,
                source_chain,
                receive_token_payload.source_address.unwrap(),
                receive_token_payload.data.unwrap(),
                receive_token_payload.token_id,
                token_identifier,
                receive_token_payload.amount,
                caller,
                command_id,
                express_hash,
            );

            return;
        }

        require!(
            receive_token_payload.selector == SELECTOR_RECEIVE_TOKEN,
            "Invalid express selector"
        );

        self.send().direct(
            &destination_address,
            &token_identifier,
            0,
            &receive_token_payload.amount,
        );
    }

    #[payable("*")]
    #[endpoint(interchainTransfer)]
    fn interchain_transfer(
        &self,
        token_id: TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        metadata: ManagedBuffer,
    ) {
        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        self.token_manager_take_token(&token_id, token_identifier, amount.clone());

        self.transmit_send_token_raw(
            token_id,
            self.blockchain().get_caller(),
            destination_chain,
            destination_address,
            amount,
            metadata,
        );
    }

    #[payable("*")]
    #[endpoint(sendTokenWithData)]
    fn send_token_with_data(
        &self,
        token_id: TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        data: ManagedBuffer,
    ) {
        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        self.token_manager_take_token(&token_id, token_identifier, amount.clone());

        let mut raw_metadata = ManagedBuffer::new();

        let result: Result<(), EncodeError> = Metadata {
            version: 0,
            metadata: data,
        }
        .top_encode(&mut raw_metadata);

        require!(result.is_ok(), "Failed to encode metadata");

        self.transmit_send_token_raw(
            token_id,
            self.blockchain().get_caller(),
            destination_chain,
            destination_address,
            amount,
            raw_metadata,
        );
    }

    /// Token Manager Functions

    #[endpoint(transmitSendToken)]
    fn transmit_send_token(
        &self,
        token_id: TokenId<Self::Api>,
        source_address: ManagedAddress,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        amount: BigUint,
        metadata: ManagedBuffer,
    ) {
        self.require_not_paused();
        self.only_token_manager(&token_id);

        self.transmit_send_token_raw(
            token_id,
            source_address,
            destination_chain,
            destination_address,
            amount,
            metadata,
        );
    }

    /// Owner functions

    #[only_owner]
    #[endpoint(setFlowLimit)]
    fn set_flow_limit(
        &self,
        token_ids: MultiValueManagedVecCounted<TokenId<Self::Api>>,
        flow_limits: MultiValueManagedVecCounted<BigUint>,
    ) {
        require!(token_ids.len() == flow_limits.len(), "Length mismatch");

        for (token_id, flow_limit) in token_ids
            .into_vec()
            .iter()
            .zip(flow_limits.into_vec().iter())
        {
            self.token_manager_set_flow_limit(token_id.deref(), flow_limit.deref());
        }
    }

    /// Internal Functions

    // Needs to be payable because it can issue ESDT token through the TokenManager
    #[payable("EGLD")]
    #[endpoint]
    fn execute(
        &self,
        command_id: ManagedBuffer,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        self.require_not_paused();
        self.only_remote_service(&source_chain, &source_address);

        let payload_hash = self.crypto().keccak256(&payload);

        let selector = ParamType::Uint256.abi_decode(&payload, 0)
            .token
            .into_biguint()
            .to_u64()
            .unwrap();

        match selector {
            SELECTOR_RECEIVE_TOKEN
            | SELECTOR_RECEIVE_TOKEN_WITH_DATA
            | SELECTOR_DEPLOY_TOKEN_MANAGER => {
                require!(
                    self.call_value().egld_value().deref() == &BigUint::zero(),
                    "Can not send EGLD payment if not issuing ESDT"
                );

                let valid = self.gateway_validate_contract_call(
                    &command_id,
                    &source_chain,
                    &source_address,
                    &payload_hash,
                );

                require!(valid, "Not approved by gateway");
            }
            SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN => {
                // This is checked inside process_deploy_standardized_token_and_manager_payload function
            }
            _ => {
                sc_panic!("Selector unknown");
            }
        }

        match selector {
            SELECTOR_RECEIVE_TOKEN | SELECTOR_RECEIVE_TOKEN_WITH_DATA => {
                self.process_receive_token_payload(command_id, source_chain, payload);
            }
            SELECTOR_DEPLOY_TOKEN_MANAGER => {
                self.process_deploy_token_manager_payload(payload);
            }
            SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN => {
                self.process_deploy_standardized_token_and_manager_payload(
                    command_id,
                    source_chain,
                    source_address,
                    payload_hash,
                    payload,
                );
            }
            _ => {
                sc_panic!("Selector unknown");
            }
        }
    }

    fn only_token_manager(&self, token_id: &TokenId<Self::Api>) {
        let caller = self.blockchain().get_caller();

        require!(
            caller == self.get_valid_token_manager_address(token_id),
            "Not token manager"
        );
    }

    fn validate_token(&self, token_identifier: &EgldOrEsdtTokenIdentifier) {
        require!(token_identifier.is_valid(), "Invalid token identifier");
    }

    #[view]
    fn get_canonical_token_id(
        &self,
        token_identifier: &EgldOrEsdtTokenIdentifier,
    ) -> TokenId<Self::Api> {
        let prefix_standardized_token_id = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_STANDARDIZED_TOKEN_ID));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_standardized_token_id.as_managed_buffer());
        encoded.append(self.chain_name_hash().get().as_managed_buffer());
        encoded.append(&token_identifier.clone().into_name());

        self.crypto().keccak256(encoded)
    }

    #[view]
    fn get_custom_token_id(
        &self,
        sender: &ManagedAddress,
        salt: &ManagedBuffer,
    ) -> TokenId<Self::Api> {
        let prefix_custom_token_id = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_CUSTOM_TOKEN_ID));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_custom_token_id.as_managed_buffer());
        encoded.append(sender.as_managed_buffer());
        encoded.append(salt);

        self.crypto().keccak256(encoded)
    }

    #[storage_mapper("chain_name_hash")]
    fn chain_name_hash(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;
}
