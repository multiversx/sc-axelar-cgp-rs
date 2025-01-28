use core::ops::Deref;
use token_manager::flow_limit::ProxyTrait as _;
use token_manager::ProxyTrait as _;

use crate::abi::AbiEncodeDecode;
use crate::abi_types::RegisterTokenMetadataPayload;
use crate::constants::{
    Hash, ManagedBufferAscii, MetadataVersion, TokenId, EXECUTE_WITH_TOKEN_CALLBACK_GAS,
    ITS_HUB_CHAIN_NAME, KEEP_EXTRA_GAS, MESSAGE_TYPE_REGISTER_TOKEN_METADATA,
};
use crate::{address_tracker, events, proxy_gmp};

multiversx_sc::imports!();

pub mod executable_contract_proxy {
    use crate::constants::TokenId;

    multiversx_sc::imports!();

    // Contracts having these functions should check that the InterchainTokenService contract called them
    #[multiversx_sc::proxy]
    pub trait ExecutableContractProxy {
        #[payable("*")]
        #[endpoint(executeWithInterchainToken)]
        fn execute_with_interchain_token(
            &self,
            source_chain: &ManagedBuffer,
            message_id: &ManagedBuffer,
            source_address: ManagedBuffer,
            data: ManagedBuffer,
            token_id: TokenId<Self::Api>,
        );
    }
}

#[multiversx_sc::module]
pub trait ProxyItsModule:
    events::EventsModule + proxy_gmp::ProxyGmpModule + address_tracker::AddressTracker
{
    fn token_manager_take_token(
        &self,
        token_id: &TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
    ) {
        self.token_manager_proxy(self.deployed_token_manager(token_id))
            .take_token()
            .with_egld_or_single_esdt_transfer(EgldOrEsdtTokenPayment::new(
                token_identifier,
                0,
                amount,
            ))
            .execute_on_dest_context::<()>();
    }

    fn token_manager_set_flow_limit(&self, token_id: &TokenId<Self::Api>, flow_limit: &BigUint) {
        self.token_manager_proxy(self.deployed_token_manager(token_id))
            .set_flow_limit(flow_limit)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_give_token(
        &self,
        token_id: &TokenId<Self::Api>,
        destination_address: &ManagedAddress,
        amount: &BigUint,
    ) -> (EgldOrEsdtTokenIdentifier, BigUint) {
        self.token_manager_proxy(self.deployed_token_manager(token_id))
            .give_token(destination_address, amount)
            .execute_on_dest_context::<MultiValue2<EgldOrEsdtTokenIdentifier, BigUint>>()
            .into_tuple()
    }

    fn token_manager_deploy_interchain_token(
        &self,
        token_id: &TokenId<Self::Api>,
        minter: Option<ManagedAddress>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
    ) {
        self.token_manager_proxy(self.deployed_token_manager(token_id))
            .deploy_interchain_token(minter, name, symbol, decimals)
            .with_egld_transfer(self.call_value().egld_value().clone_value())
            .with_gas_limit(100_000_000) // Need to specify gas manually here because the function does an async call. This should be plenty
            .execute_on_dest_context::<()>();
    }

    fn executable_contract_execute_with_interchain_token(
        &self,
        destination_address: ManagedAddress,
        original_source_chain: ManagedBuffer,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        source_address: ManagedBuffer,
        payload_hash: Hash<Self::Api>,
        original_source_address: ManagedBuffer,
        data: ManagedBuffer,
        token_id: TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
    ) {
        let gas_left = self.blockchain().get_gas_left();

        require!(
            gas_left > EXECUTE_WITH_TOKEN_CALLBACK_GAS + KEEP_EXTRA_GAS,
            "Not enough gas left for async call"
        );

        let gas_limit = gas_left - EXECUTE_WITH_TOKEN_CALLBACK_GAS - KEEP_EXTRA_GAS;

        require!(
            self.transfer_with_data_lock(&source_chain, &message_id)
                .is_empty(),
            "Async call in progress"
        );

        self.transfer_with_data_lock(&source_chain, &message_id)
            .set(true);

        self.executable_contract_proxy(destination_address)
            .execute_with_interchain_token(
                &original_source_chain,
                &message_id,
                original_source_address,
                data,
                token_id.clone(),
            )
            .with_egld_or_single_esdt_transfer((token_identifier.clone(), 0, amount.clone()))
            .with_gas_limit(gas_limit)
            .with_callback(self.callbacks().execute_with_token_callback(
                source_chain,
                message_id,
                source_address,
                payload_hash,
                token_id,
                token_identifier,
                amount,
            ))
            .with_extra_gas_for_callback(EXECUTE_WITH_TOKEN_CALLBACK_GAS)
            .register_promise();
    }

    fn register_token_metadata_async_call(
        &self,
        token_identifier: TokenIdentifier,
        gas_value: BigUint,
    ) {
        // Get ESDT token properties
        let mut contract_call = self.send().contract_call::<()>(
            ESDTSystemSCAddress.to_managed_address(),
            ManagedBuffer::from("getTokenProperties"),
        );
        contract_call.push_raw_argument(token_identifier.into_managed_buffer());

        contract_call
            .async_call()
            .with_callback(
                self.callbacks()
                    .register_token_metadata_callback(gas_value, self.blockchain().get_caller()),
            ) // TODO: Is the caller the correct sender here?)
            .call_and_exit();
    }

    #[view(flowLimit)]
    fn flow_limit(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.deployed_token_manager(&token_id))
            .flow_limit()
            .execute_on_dest_context()
    }

    #[view(flowOutAmount)]
    fn flow_out_amount(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.deployed_token_manager(&token_id))
            .get_flow_out_amount()
            .execute_on_dest_context()
    }

    #[view(flowInAmount)]
    fn flow_in_amount(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.deployed_token_manager(&token_id))
            .get_flow_in_amount()
            .execute_on_dest_context()
    }

    #[view(deployedTokenManager)]
    fn deployed_token_manager(&self, token_id: &TokenId<Self::Api>) -> ManagedAddress {
        let token_manager_address_mapper = self.token_manager_address(token_id);

        require!(
            !token_manager_address_mapper.is_empty(),
            "Token manager does not exist"
        );

        token_manager_address_mapper.get()
    }

    #[view(registeredTokenIdentifier)]
    fn registered_token_identifier(
        &self,
        token_id: &TokenId<Self::Api>,
    ) -> EgldOrEsdtTokenIdentifier {
        self.token_manager_proxy(self.deployed_token_manager(token_id))
            .token_identifier()
            .execute_on_dest_context()
    }

    #[view(invalidTokenManagerAddress)]
    fn invalid_token_manager_address(&self, token_id: &TokenId<Self::Api>) -> ManagedAddress {
        let token_manager_address_mapper = self.token_manager_address(token_id);

        if token_manager_address_mapper.is_empty() {
            return ManagedAddress::zero();
        }

        token_manager_address_mapper.get()
    }

    #[view(tokenManagerAddress)]
    #[storage_mapper("token_manager_address")]
    fn token_manager_address(
        &self,
        token_id: &TokenId<Self::Api>,
    ) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn token_manager_proxy(&self, address: ManagedAddress) -> token_manager::Proxy<Self::Api>;

    #[proxy]
    fn executable_contract_proxy(
        &self,
        sc_address: ManagedAddress,
    ) -> executable_contract_proxy::Proxy<Self::Api>;

    #[promises_callback]
    fn execute_with_token_callback(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        source_address: ManagedBuffer,
        payload_hash: Hash<Self::Api>,
        token_id: TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
        #[call_result] result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(_) => {
                self.transfer_with_data_lock(&source_chain, &message_id)
                    .clear();

                // This will always be true
                let _ = self.gateway_validate_message(
                    &source_chain,
                    &message_id,
                    &source_address,
                    &payload_hash,
                );

                self.execute_with_interchain_token_success_event(source_chain, message_id);
            }
            ManagedAsyncCallResult::Err(_) => {
                self.transfer_with_data_lock(&source_chain, &message_id)
                    .clear();

                self.token_manager_take_token(&token_id, token_identifier, amount);

                self.execute_with_interchain_token_failed_event(source_chain, message_id);
            }
        }
    }

    #[view(transferWithDataLock)]
    #[storage_mapper("transfer_with_data_lock")]
    fn transfer_with_data_lock(
        &self,
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
    ) -> SingleValueMapper<bool>;

    #[callback]
    fn register_token_metadata_callback(
        &self,
        gas_value: BigUint,
        caller: ManagedAddress,
        #[call_result] result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(values) => {
                let vec: ManagedVec<ManagedBuffer> = values.into_vec_of_buffers();

                let token_name = vec.get(0).clone_value();
                let token_type = vec.get(1);
                let decimals_buffer_ref = vec.get(5);

                if token_type.deref() != EsdtTokenType::Fungible.as_type_name() {
                    // Send back paid cross chain gas value to initial caller if token is non fungible
                    self.send().direct_non_zero_egld(&caller, &gas_value);

                    return;
                }

                let decimals_buffer = decimals_buffer_ref.deref();
                // num decimals is in format string NumDecimals-DECIMALS
                // skip `NumDecimals-` part and convert to number
                let token_decimals_buf: ManagedBuffer = decimals_buffer
                    .copy_slice(12, decimals_buffer.len() - 12)
                    .unwrap();
                let token_decimals = token_decimals_buf.ascii_to_u8();

                self.register_token_metadata_raw(
                    TokenIdentifier::from(token_name),
                    token_decimals,
                    gas_value,
                );
            }
            ManagedAsyncCallResult::Err(_) => {
                // Send back paid gas value to initial caller
                self.send().direct_non_zero_egld(&caller, &gas_value);
            }
        }
    }

    fn register_token_metadata_raw(
        &self,
        token_identifier: TokenIdentifier,
        decimals: u8,
        gas_value: BigUint,
    ) {
        self.token_metadata_registered_event(&token_identifier, decimals);

        let data = RegisterTokenMetadataPayload {
            message_type: BigUint::from(MESSAGE_TYPE_REGISTER_TOKEN_METADATA),
            token_identifier: token_identifier.into_managed_buffer(),
            decimals,
        };

        let payload = data.abi_encode();

        let its_hub_chain_name = ManagedBuffer::from(ITS_HUB_CHAIN_NAME);
        let its_hub_address = self.trusted_address(&its_hub_chain_name).get();

        self.call_contract(
            its_hub_chain_name,
            its_hub_address,
            payload,
            MetadataVersion::ContractCall,
            EgldOrEsdtTokenIdentifier::egld(),
            gas_value,
        );
    }
}
