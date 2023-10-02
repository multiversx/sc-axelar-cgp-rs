#![no_std]

multiversx_sc::imports!();

mod constants;
mod events;
mod executable;
mod proxy;

use crate::constants::{
    TokenManagerType, PREFIX_CUSTOM_TOKEN_ID, PREFIX_STANDARDIZED_TOKEN_ID,
    SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, SELECTOR_DEPLOY_TOKEN_MANAGER,
};
use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[multiversx_sc::contract]
pub trait InterchainTokenServiceContract:
    proxy::ProxyModule + executable::ExecutableModule + events::Events
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
        token_manager_implementations: MultiValueEncoded<ManagedAddress>,
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
        token_address: TokenIdentifier,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        self.validate_token(&token_address);

        let token_id = self.get_canonical_token_id(&token_address);

        self.deploy_token_manager(&token_id, TokenManagerType::LockUnlock, token_address);

        token_id
    }

    #[endpoint(deployRemoteCanonicalToken)]
    fn deploy_remote_canonical_token(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        gas_value: BigUint,
    ) {
        let token_address = self.get_token_address(token_id.clone());

        require!(
            self.get_canonical_token_id(&token_address) == token_id,
            "Not canonical token manager"
        );

        self.validate_token(&token_address);

        // TODO: In sol these can be retrieved from the token contract, how can we retrieve them for MultiversX so this function can still be called by anyone?
        // Should these be retrieved from the TokenManager?
        let token_name = token_address.clone().into_managed_buffer();
        let token_symbol = token_address.into_managed_buffer();
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
        token_address: TokenIdentifier,
    ) {
        let deployer = self.blockchain().get_caller();

        let token_id = self.get_custom_token_id(&deployer, &salt);

        self.deploy_token_manager(&token_id, token_manager_type, token_address);

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
        //
        // let token_address = self.get_standardized_token_address(token_id);
        //
        // self.deploy_token_manager(&token_id, TokenManagerType::MintBurn, token_address);
    }

    fn only_remote_service(&self, source_chain: ManagedBuffer, source_address: ManagedBuffer) {
        require!(
            self.remote_address_validator_validate_sender(source_chain, source_address),
            "Not remote service"
        );
    }

    fn only_token_manager(&self, token_id: ManagedByteArray<KECCAK256_RESULT_LEN>) {
        let caller = self.blockchain().get_caller();

        require!(
            caller == self.token_manager_address(token_id).get(),
            "Not token manager"
        );
    }

    // TODO: This function takes as a last argument a more generic `params` object, check if our implementation is ok
    // or if we need to make it more generic
    fn deploy_token_manager(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        token_manager_type: TokenManagerType,
        token_address: TokenIdentifier,
    ) {
        // TODO: This is done using a TokenManagerDeployer contract and TokenManagerProxy contract in sol but was simplified here
        let impl_address = self.get_implementation(token_manager_type);

        let mut arguments = ManagedArgBuffer::new();

        arguments.push_arg(self.blockchain().get_sc_address());
        arguments.push_arg(token_address);

        // TODO: What does this return when it fails?
        let (address, _) = self.send_raw().deploy_from_source_contract(
            self.blockchain().get_gas_left(),
            &BigUint::zero(),
            &impl_address,
            CodeMetadata::DEFAULT,
            &arguments,
        );

        require!(!address.is_zero(), "Token manager deployment failed");

        self.token_manager_deployed_event(token_id, token_manager_type, arguments);
    }

    fn deploy_remote_standardized_token(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
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

        payload.append(
            &BigUint::from(SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN).to_bytes_be_buffer(),
        );
        payload.append(token_id.as_managed_buffer());
        payload.append(&name);
        payload.append(&symbol);
        let _ = decimals.top_encode(&mut payload);
        payload.append(&distributor);
        payload.append(&mint_to);
        payload.append(&mint_amount.to_bytes_be_buffer());
        payload.append(&operator);

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

    fn call_contract(
        &self,
        destination_chain: &ManagedBuffer,
        payload: &ManagedBuffer,
        gas_value: &BigUint,
    ) {
        let destination_address =
            self.remote_address_validator_get_remote_address(destination_chain);

        if gas_value == &BigUint::zero() {
            self.gas_service_pay_native_gas_for_contract_call(
                destination_chain,
                &destination_address,
                payload,
                gas_value,
            );
        }

        self.gateway_call_contract(destination_chain, &destination_address, payload);
    }

    fn validate_token(&self, token_address: &TokenIdentifier) {
        // TODO: This also has validation for token in sol contract, check if this works and checks that the token exists
        let _ = self.blockchain().is_esdt_paused(&token_address);

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

    fn deploy_standardized_token(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        distributor: ManagedAddress,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        mint_amount: BigUint,
        sender: ManagedAddress,
    ) {
        // TODO:
    }

    #[view]
    fn get_canonical_token_id(
        &self,
        token_address: &TokenIdentifier,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let prefix_standardized_token_id = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_STANDARDIZED_TOKEN_ID));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_standardized_token_id.as_managed_buffer());
        encoded.append(self.chain_name_hash().get().as_managed_buffer());
        encoded.append(token_address.as_managed_buffer());

        self.crypto().keccak256(encoded)
    }

    // TODO: This salt should be changed to a TokenIdentifier or something else?
    #[view]
    fn get_custom_token_id(
        &self,
        sender: &ManagedAddress,
        salt: &ManagedBuffer,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let prefix_custom_token_id = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_CUSTOM_TOKEN_ID));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_custom_token_id.as_managed_buffer());
        encoded.append(sender.as_managed_buffer());
        encoded.append(&salt);

        self.crypto().keccak256(encoded)
    }

    #[view]
    fn get_implementation(&self, token_manager_type: TokenManagerType) -> ManagedAddress {
        match token_manager_type {
            TokenManagerType::LockUnlock => self.implementation_lock_unlock().get(),
            TokenManagerType::MintBurn => self.implementation_mint_burn().get(),
        }
    }

    #[storage_mapper("token_manager_deployer")]
    fn token_manager_deployer(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("standardized_token_deployer")]
    fn standardized_token_deployer(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("implementation_lock_unlock")]
    fn implementation_lock_unlock(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("implementation_mint_burn")]
    fn implementation_mint_burn(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("chain_name_hash")]
    fn chain_name_hash(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;
}
