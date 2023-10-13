#![no_std]

use core::convert::TryFrom;
use core::ops::Deref;

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use multiversx_sc::codec::TopDecodeInput;

use crate::constants::{
    DeployStandardizedTokenAndManagerPayload, Metadata, SendTokenPayload, TokenId,
    TokenManagerType, PREFIX_CUSTOM_TOKEN_ID, PREFIX_STANDARDIZED_TOKEN_ID,
    SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, SELECTOR_DEPLOY_TOKEN_MANAGER,
    SELECTOR_RECEIVE_TOKEN, SELECTOR_RECEIVE_TOKEN_WITH_DATA,
};
use crate::proxy::gateway_proxy::ProxyTrait as GatewayProxyTrait;
use crate::proxy::remote_address_validator_proxy::ProxyTrait as RemoteAddressValidatorProxyTrait;

multiversx_sc::imports!();

mod constants;
mod events;
mod executable;
mod proxy;

#[multiversx_sc::contract]
pub trait InterchainTokenServiceContract:
    proxy::ProxyModule
    + executable::ExecutableModule
    + events::EventsModule
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

    // TODO: Need to do an async call here and in the callback deploy the remote token manager
    #[endpoint(deployRemoteCanonicalToken)]
    fn deploy_remote_canonical_token(
        &self,
        token_id: TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.require_not_paused();

        let token_identifier = self.get_token_identifier(&token_id);

        require!(
            self.get_canonical_token_id(&token_identifier) == token_id,
            "Not canonical token manager"
        );

        self.validate_token(&token_identifier);

        // TODO: In sol these can be retrieved from the token contract, how can we retrieve them for MultiversX so this function can still be called by anyone?
        // Should these be retrieved from the TokenManager?
        let token_name = token_identifier.clone().into_name();
        let token_symbol = token_identifier.into_name();
        let token_decimals = 18;

        self.deploy_remote_standardized_token(
            token_id,
            token_name,
            token_symbol,
            token_decimals,
            ManagedBuffer::new(),
            ManagedBuffer::new(),
            BigUint::zero(),
            ManagedBuffer::new(),
            destination_chain,
            gas_value,
        );
    }

    #[endpoint(deployCustomTokenManager)]
    fn deploy_custom_token_manager(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
        token_manager_type: TokenManagerType,
        operator: ManagedAddress,
    ) {
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

        self.custom_token_id_claimed_event(token_id, deployer, token_name);
    }

    #[endpoint(deployRemoteCustomTokenManager)]
    fn deploy_remote_custom_token_manager(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
        destination_chain: ManagedBuffer,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.require_not_paused();

        self.validate_token(&token_identifier);

        let deployer = self.blockchain().get_caller();

        let token_name = token_identifier.clone().into_name();

        let token_id = self.get_custom_token_id(&deployer, &token_name);

        self.deploy_remote_token_manager(
            token_id.clone(),
            destination_chain,
            gas_value,
            token_manager_type,
            params,
        );

        self.custom_token_id_claimed_event(token_id, deployer, token_name);
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

        // Allow retry of deploying standardized token
        let token_manager_address_mapper = self.token_manager_address(&token_id);
        if token_manager_address_mapper.is_empty() {
            self.deploy_token_manager(
                &token_id,
                TokenManagerType::MintBurn,
                self.blockchain().get_caller(),
                None,
            );
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
        gas_value: BigUint,
    ) {
        self.require_not_paused();

        let token_id = self.get_custom_token_id(&self.blockchain().get_caller(), &salt);

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
            SendTokenPayload::<Self::Api>::top_decode(payload).unwrap();

        let token_identifier = self.get_token_identifier(&receive_token_payload.token_id);

        let destination_address =
            ManagedAddress::try_from(receive_token_payload.destination_address).unwrap();

        if receive_token_payload.selector == BigUint::from(SELECTOR_RECEIVE_TOKEN_WITH_DATA) {
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
                express_hash
            );
        } else {
            require!(
                receive_token_payload.selector == BigUint::from(SELECTOR_RECEIVE_TOKEN),
                "Invalid express selector"
            );

            self.send().direct(
                &destination_address,
                &token_identifier,
                0,
                &receive_token_payload.amount,
            );
        }
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
        let (token_identifier, amount) = self.get_required_payment(&token_id);

        self.token_manager_take_token(&token_id, token_identifier, amount.clone());

        // TODO: Check if this is correct and what this metadata actually is
        let metadata = Metadata::<Self::Api>::top_decode(metadata);
        let raw_metadata: Metadata<Self::Api>;
        if metadata.is_err() {
            raw_metadata = Metadata::<Self::Api> {
                version: 0,
                metadata: ManagedBuffer::new(),
            };
        } else {
            raw_metadata = metadata.unwrap();
        }

        self.transmit_send_token_raw(
            token_id,
            self.blockchain().get_caller(),
            destination_chain,
            destination_address,
            amount,
            raw_metadata,
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
        let (token_identifier, amount) = self.get_required_payment(&token_id);

        self.token_manager_take_token(&token_id, token_identifier, amount.clone());

        self.transmit_send_token_raw(
            token_id,
            self.blockchain().get_caller(),
            destination_chain,
            destination_address,
            amount,
            Metadata {
                version: 0,
                metadata: data,
            },
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

        // TODO: Check if this is correct and what this metadata actually is
        let metadata = Metadata::<Self::Api>::top_decode(metadata);
        let raw_metadata: Metadata<Self::Api>;
        if metadata.is_err() {
            raw_metadata = Metadata::<Self::Api> {
                version: 0,
                metadata: ManagedBuffer::new(),
            };
        } else {
            raw_metadata = metadata.unwrap();
        }

        self.transmit_send_token_raw(
            token_id,
            source_address,
            destination_chain,
            destination_address,
            amount,
            raw_metadata,
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
        payload_raw: ManagedBuffer,
    ) {
        self.require_not_paused();
        self.only_remote_service(&source_chain, &source_address);

        let payload_hash = self.crypto().keccak256(&payload_raw);

        let valid = self
            .gateway_proxy(self.gateway().get())
            .validate_contract_call(
                &command_id,
                &source_chain,
                &source_address,
                payload_hash.as_managed_buffer(),
            )
            .execute_on_dest_context::<bool>();

        require!(valid, "Not approved by gateway");

        let mut payload = payload_raw.clone().into_nested_buffer();

        // TODO: Use abi decoding here. Optimize to not decode w
        let selector = BigUint::dep_decode(&mut payload).unwrap();

        match selector.to_u64().unwrap() as u32 {
            SELECTOR_RECEIVE_TOKEN | SELECTOR_RECEIVE_TOKEN_WITH_DATA => {
                self.process_receive_token_payload(command_id, source_chain, payload_raw);
            }
            SELECTOR_DEPLOY_TOKEN_MANAGER => {
                self.process_deploy_token_manager_payload(payload_raw);
            }
            SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN => {
                self.process_deploy_standardized_token_and_manager_payload(payload_raw);
            }
            _ => {
                sc_panic!("Selector unknown");
            }
        }
    }

    fn only_remote_service(&self, source_chain: &ManagedBuffer, source_address: &ManagedBuffer) {
        let valid_sender: bool = self
            .remote_address_validator_proxy(self.remote_address_validator().get())
            .validate_sender(source_chain, source_address)
            .execute_on_dest_context();

        require!(valid_sender, "Not remote service");
    }

    fn only_token_manager(&self, token_id: &TokenId<Self::Api>) {
        let caller = self.blockchain().get_caller();

        require!(
            caller == self.get_valid_token_manager_address(token_id),
            "Not token manager"
        );
    }

    fn call_contract(
        &self,
        destination_chain: &ManagedBuffer,
        payload: &ManagedBuffer,
        gas_value: &BigUint,
    ) {
        let destination_address =
            self.remote_address_validator_get_remote_address(destination_chain);

        // TODO: On MultiversX we can not send both EGLD and ESDT in the same transaction,
        // see how to properly handle the gas here
        if gas_value > &BigUint::zero() {
            self.gas_service_pay_native_gas_for_contract_call(
                destination_chain,
                &destination_address,
                payload,
                gas_value,
            );
        }

        self.gateway_call_contract(destination_chain, &destination_address, payload);
    }

    fn validate_token(&self, token_identifier: &EgldOrEsdtTokenIdentifier) {
        require!(token_identifier.is_valid(), "Invalid token identifier");

        // TODO: This also has validation for token in sol contract, check if this works and checks that the token exists?
        let _ = self
            .blockchain()
            .is_esdt_paused(&token_identifier.clone().unwrap_esdt());

        // TODO: In sol contract this returns the name and decimals of the token, but there is no way to do that on MultiversX
    }

    fn deploy_remote_token_manager(
        &self,
        token_id: TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        gas_value: BigUint,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) {
        let mut payload = ManagedBuffer::new();

        // TODO: Switch this to use abi encoding
        payload.append(&BigUint::from(SELECTOR_DEPLOY_TOKEN_MANAGER).to_bytes_be_buffer());
        payload.append(token_id.as_managed_buffer());
        let _ = token_manager_type.top_encode(&mut payload);
        payload.append(&params);

        self.call_contract(&destination_chain, &payload, &gas_value);

        self.emit_remote_token_manager_deployment_initialized(
            token_id,
            destination_chain,
            gas_value,
            token_manager_type,
            params,
        );
    }

    fn deploy_remote_standardized_token(
        &self,
        token_id: TokenId<Self::Api>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        distributor: ManagedBuffer,
        mint_to: ManagedBuffer,
        mint_amount: BigUint,
        operator: ManagedBuffer,
        destination_chain: ManagedBuffer,
        gas_value: BigUint,
    ) {
        let mut payload = ManagedBuffer::new();

        let data = DeployStandardizedTokenAndManagerPayload {
            selector: BigUint::from(SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN),
            token_id: token_id.clone(),
            name: name.clone(),
            symbol: symbol.clone(),
            decimals,
            distributor: distributor.clone(),
            mint_to: mint_to.clone(),
            mint_amount: mint_amount.clone(),
            operator: operator.clone(),
        };

        // TODO: Switch this to use abi encoding
        let _ = data.top_encode(&mut payload);

        self.call_contract(&destination_chain, &payload, &gas_value);

        self.emit_remote_standardized_token_and_manager_deployment_initialized_event(
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

    fn decode_metadata(&self, raw_metadata: Metadata<Self::Api>) -> (u32, ManagedBuffer) {
        // TODO: This does some Assembly logic specific to sol, what should we actually do here?
        // Currently we use the MultiversX encoding/decoding and a custom struct for this
        (raw_metadata.version, raw_metadata.metadata)
    }

    fn transmit_send_token_raw(
        &self,
        token_id: TokenId<Self::Api>,
        source_address: ManagedAddress,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        amount: BigUint,
        raw_metadata: Metadata<Self::Api>,
    ) {
        let mut payload = ManagedBuffer::new();

        // TODO: Not sure what this metadata contains exactly and how to decode it
        // This check was changed here because of different encoding/decoding
        if raw_metadata.metadata.len() == 0 {
            // TODO: Change this to abi encoding
            let data = SendTokenPayload {
                selector: BigUint::from(SELECTOR_RECEIVE_TOKEN),
                token_id: token_id.clone(),
                destination_address: destination_address.clone(),
                amount: amount.clone(),
                source_address: Option::None,
                data: Option::None,
            };

            data.top_encode(&mut payload).unwrap();

            // TODO: What gas value should we use here? Since we can not have both EGLD and ESDT payment in the same contract call
            self.call_contract(&destination_chain, &payload, &BigUint::zero());

            self.emit_token_sent_event(token_id, destination_chain, destination_address, amount);

            return;
        }

        let (version, metadata) = self.decode_metadata(raw_metadata);
        require!(version == 0, "Invalid metadata version");

        // TODO: Change this to abi encoding
        let data = SendTokenPayload {
            selector: BigUint::from(SELECTOR_RECEIVE_TOKEN_WITH_DATA),
            token_id: token_id.clone(),
            destination_address: destination_address.clone(),
            amount: amount.clone(),
            source_address: Some(source_address.as_managed_buffer().clone()),
            data: Some(metadata.clone()),
        };

        data.top_encode(&mut payload).unwrap();

        // TODO: What gas value should we use here? Since we can not have both EGLD and ESDT payment in the same contract call
        self.call_contract(&destination_chain, &payload, &BigUint::zero());

        self.emit_token_sent_with_data_event(
            token_id,
            destination_chain,
            destination_address,
            amount,
            source_address,
            metadata,
        );
    }

    fn set_express_receive_token(
        &self,
        payload: &ManagedBuffer,
        command_id: &ManagedBuffer,
        express_caller: &ManagedAddress,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut hash_data = ManagedBuffer::new();

        hash_data.append(payload);
        hash_data.append(command_id);

        let hash = self.crypto().keccak256(hash_data);

        let express_receive_token_slot_mapper = self.express_receive_token_slot(&hash);

        require!(
            express_receive_token_slot_mapper.is_empty(),
            "Already express called"
        );

        express_receive_token_slot_mapper.set(express_caller);

        self.express_receive_event(command_id, express_caller, payload);

        hash
    }

    fn get_required_payment(
        &self,
        token_id: &TokenId<Self::Api>,
    ) -> (EgldOrEsdtTokenIdentifier, BigUint) {
        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        let required_token_identifier = self.get_token_identifier(token_id);

        require!(
            token_identifier == required_token_identifier,
            "Wrong token sent"
        );

        (token_identifier, amount)
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
        encoded.append(&salt);

        self.crypto().keccak256(encoded)
    }

    #[storage_mapper("chain_name_hash")]
    fn chain_name_hash(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;
}
