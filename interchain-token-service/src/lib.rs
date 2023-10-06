#![no_std]

multiversx_sc::imports!();

mod constants;
mod events;
mod executable;
mod proxy;

use crate::constants::{Metadata, SendTokenPayload, TokenManagerType, PREFIX_CUSTOM_TOKEN_ID, PREFIX_STANDARDIZED_TOKEN_ID, SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, SELECTOR_DEPLOY_TOKEN_MANAGER, SELECTOR_SEND_TOKEN, SELECTOR_SEND_TOKEN_WITH_DATA, DeployStandardizedTokenAndManagerPayload, TokenId};
use crate::executable::executable_contract_proxy::ProxyTrait as ExecutableContractProxyTrait;
use core::ops::Deref;
use multiversx_sc::api::KECCAK256_RESULT_LEN;
use core::convert::TryFrom;

#[multiversx_sc::contract]
pub trait InterchainTokenServiceContract:
    proxy::ProxyModule
    + executable::ExecutableModule
    + events::EventsModule
    + multiversx_sc_modules::pause::PauseModule
{
    /// token_manager_implementations - this need to have exactly 2 implementations in the following order: Lock/Unlock, mint/burn
    /// TODO: in sol contracts there is also a 3rd implementation for Lock/Unlock with fee and a 4th implementation for liquidity pool, do we need those as well?
    #[init]
    fn init(
        &self,
        token_manager_deployer: ManagedAddress,
        standardized_token_deployer: ManagedAddress,
        gateway: ManagedAddress,
        gas_service: ManagedAddress,
        remote_address_validator: ManagedAddress,
        token_manager_implementations: MultiValueEncoded<ManagedAddress>, // TODO: The implementations should be held by the token manager deployer contract
    ) {
        self.executable_constructor(gateway);

        require!(
            !remote_address_validator.is_zero()
                && !gas_service.is_zero()
                && !token_manager_deployer.is_zero()
                && !standardized_token_deployer.is_zero(),
            "Zero address"
        );

        self.remote_address_validator()
            .set_if_empty(remote_address_validator);
        self.gas_service().set_if_empty(gas_service);
        self.token_manager_deployer()
            .set_if_empty(token_manager_deployer);
        self.standardized_token_deployer()
            .set_if_empty(standardized_token_deployer);

        require!(token_manager_implementations.len() == 2, "Length mismatch");

        let mut token_manager_implementations_iter = token_manager_implementations.into_iter();

        // TODO: Should we actually check the type of these contracts?
        self.implementation_lock_unlock()
            .set_if_empty(token_manager_implementations_iter.next().unwrap());
        self.implementation_mint_burn()
            .set_if_empty(token_manager_implementations_iter.next().unwrap());

        let chain_name = self.remote_address_validator_chain_name();
        self.chain_name_hash()
            .set_if_empty(self.crypto().keccak256(chain_name));
    }

    /// User Functions

    #[endpoint(registerCanonicalToken)]
    fn register_canonical_token(
        &self,
        token_address: EgldOrEsdtTokenIdentifier,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        self.require_not_paused();

        self.validate_token(&token_address);

        let token_id = self.get_canonical_token_id(&token_address);

        self.deploy_token_manager(
            &token_id,
            TokenManagerType::LockUnlock,
            self.blockchain().get_sc_address(),
            Some(token_address),
        );

        token_id
    }

    #[endpoint(deployRemoteCanonicalToken)]
    fn deploy_remote_canonical_token(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.require_not_paused();

        let token_address = self.get_token_address(&token_id);

        require!(
            self.get_canonical_token_id(&token_address) == token_id,
            "Not canonical token manager"
        );

        self.validate_token(&token_address);

        // TODO: In sol these can be retrieved from the token contract, how can we retrieve them for MultiversX so this function can still be called by anyone?
        // Should these be retrieved from the TokenManager?
        let token_name = token_address.clone().into_name();
        let token_symbol = token_address.into_name();
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
        salt: ManagedBuffer,
        token_manager_type: TokenManagerType,
        operator: ManagedAddress,
        token_address: EgldOrEsdtTokenIdentifier,
    ) {
        self.require_not_paused();

        let deployer = self.blockchain().get_caller();

        let token_id = self.get_custom_token_id(&deployer, &salt);

        self.deploy_token_manager(&token_id, token_manager_type, operator, Some(token_address));

        self.custom_token_id_claimed_event(token_id, deployer, salt);
    }

    #[endpoint(deployRemoteCustomTokenManager)]
    fn deploy_remote_custom_token_manager(
        &self,
        salt: ManagedBuffer,
        destination_chain: ManagedBuffer,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.require_not_paused();

        let deployer = self.blockchain().get_caller();

        let token_id = self.get_custom_token_id(&deployer, &salt);

        self.deploy_remote_token_manager(
            token_id.clone(),
            destination_chain,
            gas_value,
            token_manager_type,
            params,
        );

        self.custom_token_id_claimed_event(token_id, deployer, salt);
    }

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

        self.deploy_standardized_token(
            &token_id,
            distributor,
            name,
            symbol,
            decimals,
            mint_amount,
            sender,
        );
        // TODO: There is no way to get the token_address (ESDT id) before it is deployed
        // let token_address = self.get_standardized_token_address(token_id);

        // let token_manager_address =
        //     self.deploy_token_manager(&token_id, TokenManagerType::MintBurn, self.blockchain().get_caller(), Option::None);

        // TODO: Should we call the token manager here to actually deploy the token?
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

    // TODO: Since the related functionality for this was not implemented in `process_send_token_payload`
    // currently, should we remove this function?
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

        self.set_express_receive_token(&payload, &command_id, &caller);

        let receive_token_payload: SendTokenPayload<Self::Api> =
            SendTokenPayload::<Self::Api>::top_decode(payload).unwrap();

        let token_address = self.get_token_address(&receive_token_payload.token_id);

        let destination_address = ManagedAddress::try_from(receive_token_payload.destination_address).unwrap();

        // TODO: This was changed to call the contract with tokens directly, and not send them before calling the
        // endpoint like in the sol implementation
        if receive_token_payload.selector == BigUint::from(SELECTOR_SEND_TOKEN_WITH_DATA) {
            // TODO: Should we have a callback that unsets the express_receive_token?
            self.executable_contract_proxy(destination_address)
                .execute_with_interchain_token(
                    source_chain,
                    receive_token_payload.source_address.unwrap(),
                    receive_token_payload.data.unwrap(),
                )
                .with_egld_or_single_esdt_transfer((token_address, 0, receive_token_payload.amount))
                .async_call()
                .call_and_exit();
        } else {
            require!(
                receive_token_payload.selector == BigUint::from(SELECTOR_SEND_TOKEN),
                "Invalid express selector"
            );

            self.send().direct(
                &destination_address,
                &token_address,
                0,
                &receive_token_payload.amount,
            );
        }
    }

    #[payable("*")]
    #[endpoint(interchainTransfer)]
    fn interchain_transfer(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        metadata: ManagedBuffer,
    ) {
        // TODO: No amount parameter here because the amount is taken from the token payment
        // These checks were added for MultiversX
        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        let token_address = self.get_token_address(&token_id);

        require!(token_identifier == token_address, "Wrong token sent");

        let sender = self.blockchain().get_caller();

        self.token_manager_take_token(&token_id, token_identifier, &sender, amount.clone());

        // TODO: Check if this is correct and what this metadata actually is
        let metadata = Metadata::<Self::Api>::top_decode(metadata);
        let mut raw_metadata: Metadata<Self::Api>;

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
            sender,
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
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        data: ManagedBuffer,
    ) {
        // TODO: No amount parameter here because the amount is taken from the token payment
        // These checks were added for MultiversX
        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        let token_address = self.get_token_address(&token_id);

        require!(token_identifier == token_address, "Wrong token sent");

        let sender = self.blockchain().get_caller();

        self.token_manager_take_token(&token_id, token_identifier, &sender, amount.clone());

        self.transmit_send_token_raw(
            token_id,
            sender,
            destination_chain,
            destination_address,
            amount,
            Metadata {
                version: 0, // TODO: This is the prefix from sol, is this encoding right?
                metadata: data,
            },
        );
    }

    /// Token Manager Functions

    #[endpoint(transmitSendToken)]
    fn transmit_send_token(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
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
        let mut raw_metadata: Metadata<Self::Api>;

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

    // TODO: Is only_owner correct or should we implement the operator like in sol?
    #[only_owner]
    #[endpoint(setFlowLimit)]
    fn set_flow_limit(
        &self,
        token_ids: MultiValueManagedVecCounted<ManagedByteArray<KECCAK256_RESULT_LEN>>,
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

    // _setup, _sanitizeTokenManagerImplementation were not implemented
    // _execute implemented in executable.rs - execute_raw

    fn only_token_manager(&self, token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>) {
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

    fn validate_token(&self, token_address: &EgldOrEsdtTokenIdentifier) {
        if token_address.is_egld() {
            return;
        }

        // TODO: This also has validation for token in sol contract, check if this works and checks that the token exists
        let _ = self.blockchain().is_esdt_paused(&token_address.clone().unwrap_esdt());

        // TODO: In sol contract this returns the name and decimals of the token, but there is no way to do that on MultiversX
    }

    fn deploy_remote_token_manager(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        gas_value: BigUint,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) {
        let mut payload = ManagedBuffer::new();

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

        data.top_encode(&mut payload);

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

    fn deploy_standardized_token(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        distributor: ManagedAddress,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        mint_amount: BigUint,
        mint_to: ManagedAddress,
    ) {
        // TODO: Should this be in the token manager instead? Since this is done async and the token manager should be the owner of the token
        // let async_call = self.send()
        //     .esdt_system_sc_proxy()
        //     .issue_and_set_all_roles(
        //         issue_cost,
        //         name.clone(),
        //         symbol.clone(),
        //         EsdtTokenType::Fungible,
        //         decimals as usize,
        //     )
        //     .async_call()
        //     .with_callback(
        //         self.callbacks()
        //             .deploy_standardized_token_callback(symbol, token_id),
        //     );

        // require!(sth, "Standardized token deployment failed");

        self.emit_standardized_token_deployed_event(
            token_id,
            distributor,
            name,
            symbol,
            decimals,
            mint_amount,
            mint_to,
        );
    }

    fn decode_metadata(&self, raw_metadata: Metadata<Self::Api>) -> (u32, ManagedBuffer) {
        // TODO: This does some Assembly logic specific to sol, what should we actually do here?
        // Currently we use the MultiversX encoding/decoding and a custom struct for this
        (raw_metadata.version, raw_metadata.metadata)
    }

    // TODO: The sol contract has a function `_expressExecuteWithInterchainTokenToken` which doesn't seem to be used

    fn transmit_send_token_raw(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
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
            let data = SendTokenPayload {
                selector: BigUint::from(SELECTOR_SEND_TOKEN),
                token_id: token_id.clone(),
                destination_address: destination_address.clone(),
                amount: amount.clone(),
                source_address: Option::None,
                data: Option::None
            };

            data.top_encode(&mut payload).unwrap();

            // TODO: What gas value should we use here? Since we can not have both EGLD and ESDT payment in the same contract call
            self.call_contract(&destination_chain, &payload, &BigUint::zero());

            self.emit_token_sent_event(token_id, destination_chain, destination_address, amount);

            return;
        }

        let (version, metadata) = self.decode_metadata(raw_metadata);
        require!(version == 0, "Invalid metadata version");

        let data = SendTokenPayload {
            selector: BigUint::from(SELECTOR_SEND_TOKEN_WITH_DATA),
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

    // TODO: This is from ExpressCallHandler and currently we only save the information but never read it
    fn set_express_receive_token(
        &self,
        payload: &ManagedBuffer,
        command_id: &ManagedBuffer,
        express_caller: &ManagedAddress,
    ) {
        let mut hash_data = ManagedBuffer::new();

        hash_data.append(payload);
        hash_data.append(command_id);

        let hash = self.crypto().keccak256(hash_data);

        let express_receive_token_slot_mapper = self.express_receive_token_slot(hash);

        require!(
            express_receive_token_slot_mapper.is_empty(),
            "Already express called"
        );

        express_receive_token_slot_mapper.set(express_caller);

        self.express_receive_event(command_id, express_caller, payload);
    }

    #[view]
    fn get_canonical_token_id(
        &self,
        token_address: &EgldOrEsdtTokenIdentifier,
    ) -> TokenId<Self::Api> {
        let prefix_standardized_token_id = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_STANDARDIZED_TOKEN_ID));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_standardized_token_id.as_managed_buffer());
        encoded.append(self.chain_name_hash().get().as_managed_buffer());
        encoded.append(&token_address.clone().into_name());

        self.crypto().keccak256(encoded)
    }

    // TODO: This salt should be changed to a TokenIdentifier or something else?
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

    #[storage_mapper("token_manager_deployer")]
    fn token_manager_deployer(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("standardized_token_deployer")]
    fn standardized_token_deployer(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("chain_name_hash")]
    fn chain_name_hash(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[storage_mapper("express_receive_token_slot")]
    fn express_receive_token_slot(
        &self,
        hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<ManagedAddress>;
}