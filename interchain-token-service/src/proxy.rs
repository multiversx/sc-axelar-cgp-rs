multiversx_sc::imports!();

use crate::constants::{
    DeployStandardizedTokenAndManagerPayload, ManagedBufferAscii, TokenId,
    SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN,
};
use crate::events;
use core::ops::Deref;
use multiversx_sc::api::KECCAK256_RESULT_LEN;
use crate::abi::AbiEncode;

pub mod remote_address_validator_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait RemoteAddressValidatorProxy {
        #[view(chainName)]
        fn chain_name(&self) -> ManagedBuffer;

        #[view(validateSender)]
        fn validate_sender(
            &self,
            source_chain: &ManagedBuffer,
            source_address: &ManagedBuffer,
        ) -> bool;

        #[view(getRemoteAddress)]
        fn get_remote_address(&self, destination_chain: &ManagedBuffer) -> ManagedBuffer;
    }
}

pub mod gas_service_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait GasServiceProxy {
        #[payable("EGLD")]
        #[endpoint(payNativeGasForContractCall)]
        fn pay_native_gas_for_contract_call(
            &self,
            destination_chain: &ManagedBuffer,
            destination_address: &ManagedBuffer,
            payload: &ManagedBuffer,
            refund_address: ManagedAddress,
        );
    }
}

pub mod gateway_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait Gateway {
        #[endpoint(callContract)]
        fn call_contract(
            &self,
            destination_chain: &ManagedBuffer,
            destination_contract_address: &ManagedBuffer,
            payload: &ManagedBuffer,
        );

        #[endpoint(validateContractCall)]
        fn validate_contract_call(
            &self,
            command_id: &ManagedBuffer,
            source_chain: &ManagedBuffer,
            source_address: &ManagedBuffer,
            payload_hash: &ManagedBuffer,
        ) -> bool;

        #[view(isCommandExecuted)]
        fn is_command_executed(&self, command_id: &ManagedBuffer) -> bool;

        #[view(isContractCallApproved)]
        fn is_contract_call_approved(
            &self,
            command_id: &ManagedBuffer,
            source_chain: &ManagedBuffer,
            source_address: &ManagedBuffer,
            contract_address: &ManagedAddress,
            payload_hash: &ManagedBuffer,
        ) -> bool;
    }
}

pub mod token_manager_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait TokenManagerProxy {
        #[payable("*")]
        #[endpoint(takeToken)]
        fn take_token(&self);

        #[endpoint(giveToken)]
        fn give_token(
            &self,
            destination_address: &ManagedAddress,
            amount: &BigUint,
        ) -> MultiValue2<EgldOrEsdtTokenIdentifier, BigUint>;

        #[endpoint(setFlowLimit)]
        fn set_flow_limit(&self, flow_limit: &BigUint);

        // Endpoint only available on MintBurn TokenManager
        #[payable("EGLD")]
        #[endpoint(deployStandardizedToken)]
        fn deploy_standardized_token(
            &self,
            _distributor: ManagedAddress,
            name: ManagedBuffer,
            symbol: ManagedBuffer,
            decimals: u8,
            mint_amount: BigUint,
            mint_to: ManagedAddress,
        );

        #[view(tokenIdentifier)]
        fn token_identifier(&self) -> EgldOrEsdtTokenIdentifier;

        #[view(getFlowLimit)]
        fn get_flow_limit(&self) -> BigUint;

        #[view(getFlowOutAmount)]
        fn get_flow_out_amount(&self) -> BigUint;

        #[view(getFlowInAmount)]
        fn get_flow_in_amount(&self) -> BigUint;
    }
}

pub mod executable_contract_proxy {
    multiversx_sc::imports!();

    use multiversx_sc::api::KECCAK256_RESULT_LEN;

    #[multiversx_sc::proxy]
    pub trait ExecutableContractProxy {
        // TODO: Contracts having these functions should check that the InterchainTokenService contract called them
        #[payable("*")]
        #[endpoint(executeWithInterchainToken)]
        fn execute_with_interchain_token(
            &self,
            source_chain: ManagedBuffer,
            source_address: ManagedBuffer,
            payload: ManagedBuffer,
            token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        ) -> BigUint;

        #[payable("*")]
        #[endpoint(expressExecuteWithInterchainToken)]
        fn express_execute_with_interchain_token(
            &self,
            source_chain: ManagedBuffer,
            source_address: ManagedBuffer,
            payload: ManagedBuffer,
            token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        ) -> BigUint;
    }
}

#[multiversx_sc::module]
pub trait ProxyModule: events::EventsModule + multiversx_sc_modules::pause::PauseModule {
    fn remote_address_validator_chain_name(&self) -> ManagedBuffer {
        self.remote_address_validator_proxy(self.remote_address_validator().get())
            .chain_name()
            .execute_on_dest_context()
    }

    fn remote_address_validator_get_remote_address(
        &self,
        destination_chain: &ManagedBuffer,
    ) -> ManagedBuffer {
        self.remote_address_validator_proxy(self.remote_address_validator().get())
            .get_remote_address(destination_chain)
            .execute_on_dest_context()
    }

    fn gas_service_pay_native_gas_for_contract_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        gas_value: &BigUint,
    ) {
        self.gas_service_proxy(self.gas_service().get())
            .pay_native_gas_for_contract_call(
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_egld_transfer(gas_value.clone())
            .execute_on_dest_context::<()>();
    }

    fn gateway_call_contract(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
    ) {
        self.gateway_proxy(self.gateway().get())
            .call_contract(destination_chain, destination_address, payload)
            .execute_on_dest_context::<()>();
    }

    fn gateway_is_command_executed(&self, command_id: &ManagedBuffer) -> bool {
        self.gateway_proxy(self.gateway().get())
            .is_command_executed(command_id)
            .execute_on_dest_context::<bool>()
    }

    fn gateway_validate_contract_call(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .validate_contract_call(
                command_id,
                source_chain,
                source_address,
                payload_hash.as_managed_buffer(),
            )
            .execute_on_dest_context::<bool>()
    }

    fn gateway_is_contract_call_approved(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .is_contract_call_approved(
                command_id,
                source_chain,
                source_address,
                &self.blockchain().get_sc_address(),
                payload_hash.as_managed_buffer(),
            )
            .execute_on_dest_context::<bool>()
    }

    fn token_manager_take_token(
        &self,
        token_id: &TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
    ) {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .take_token()
            .with_egld_or_single_esdt_transfer(EgldOrEsdtTokenPayment::new(
                token_identifier,
                0,
                amount,
            ))
            .execute_on_dest_context::<()>();
    }

    fn token_manager_set_flow_limit(&self, token_id: &TokenId<Self::Api>, flow_limit: &BigUint) {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .set_flow_limit(flow_limit)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_give_token(
        &self,
        token_id: &TokenId<Self::Api>,
        destination_address: &ManagedAddress,
        amount: &BigUint,
    ) -> (EgldOrEsdtTokenIdentifier, BigUint) {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .give_token(destination_address, amount)
            .execute_on_dest_context::<MultiValue2<EgldOrEsdtTokenIdentifier, BigUint>>()
            .into_tuple()
    }

    fn token_manager_deploy_standardized_token(
        &self,
        token_id: &TokenId<Self::Api>,
        distributor: ManagedAddress,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        mint_amount: BigUint,
        mint_to: ManagedAddress,
    ) {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .deploy_standardized_token(distributor, name, symbol, decimals, mint_amount, mint_to)
            .with_egld_transfer(self.call_value().egld_value().clone_value())
            .with_gas_limit(100_000_000) // Need to specify gas manually here because the function does an async call. This should be plenty
            .execute_on_dest_context::<()>();
    }

    fn executable_contract_execute_with_interchain_token(
        &self,
        destination_address: ManagedAddress,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        data: ManagedBuffer,
        token_id: TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
        command_id: ManagedBuffer,
    ) {
        self.executable_contract_proxy(destination_address)
            .execute_with_interchain_token(source_chain, source_address, data, token_id.clone())
            .with_egld_or_single_esdt_transfer((token_identifier.clone(), 0, amount.clone()))
            .async_call()
            .with_callback(self.callbacks().execute_with_token_callback(
                command_id,
                token_id,
                token_identifier,
                amount,
            ))
            .call_and_exit();
    }

    fn executable_contract_express_execute_with_interchain_token(
        &self,
        destination_address: ManagedAddress,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        data: ManagedBuffer,
        token_id: TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
        caller: ManagedAddress,
        command_id: ManagedBuffer,
        express_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) {
        self.executable_contract_proxy(destination_address)
            .express_execute_with_interchain_token(
                source_chain,
                source_address,
                data,
                token_id.clone(),
            )
            .with_egld_or_single_esdt_transfer((token_identifier.clone(), 0, amount.clone()))
            .async_call()
            .with_callback(self.callbacks().exp_execute_with_token_callback(
                caller,
                command_id,
                token_id,
                token_identifier,
                amount,
                express_hash,
            ))
            .call_and_exit();
    }

    fn esdt_get_token_properties(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
        callback: CallbackClosure<Self::Api>,
    ) {
        let esdt_system_sc_address =
            ESDTSystemSmartContractProxy::<Self::Api>::new_proxy_obj().esdt_system_sc_address();

        let mut contract_call = self.send().contract_call::<()>(
            esdt_system_sc_address,
            ManagedBuffer::from("getTokenProperties"),
        );
        contract_call.push_raw_argument(token_identifier.into_name());

        contract_call
            .async_call()
            .with_callback(callback)
            .call_and_exit();
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

        let payload = data.abi_encode();

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

        // TODO: see how to properly handle the gas here, since on MultiversX we can not send both EGLD and ESDT in the same transaction,
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

    #[view]
    fn get_flow_limit(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(&token_id))
            .get_flow_limit()
            .execute_on_dest_context()
    }

    #[view]
    fn get_flow_out_amount(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(&token_id))
            .get_flow_out_amount()
            .execute_on_dest_context()
    }

    #[view]
    fn get_flow_in_amount(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(&token_id))
            .get_flow_in_amount()
            .execute_on_dest_context()
    }

    #[view]
    fn get_token_identifier(&self, token_id: &TokenId<Self::Api>) -> EgldOrEsdtTokenIdentifier {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .token_identifier()
            .execute_on_dest_context()
    }

    #[view]
    fn get_valid_token_manager_address(&self, token_id: &TokenId<Self::Api>) -> ManagedAddress {
        let token_manager_address_mapper = self.token_manager_address(token_id);

        require!(
            !token_manager_address_mapper.is_empty(),
            "Token manager does not exist"
        );

        token_manager_address_mapper.get()
    }

    #[storage_mapper("gateway")]
    fn gateway(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("gas_service")]
    fn gas_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("remote_address_validator")]
    fn remote_address_validator(&self) -> SingleValueMapper<ManagedAddress>;

    #[view]
    #[storage_mapper("token_manager_address")]
    fn token_manager_address(
        &self,
        token_id: &TokenId<Self::Api>,
    ) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("express_receive_token_slot")]
    fn express_receive_token_slot(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway_proxy::Proxy<Self::Api>;

    #[proxy]
    fn gas_service_proxy(&self, sc_address: ManagedAddress) -> gas_service_proxy::Proxy<Self::Api>;

    #[proxy]
    fn remote_address_validator_proxy(
        &self,
        address: ManagedAddress,
    ) -> remote_address_validator_proxy::Proxy<Self::Api>;

    #[proxy]
    fn token_manager_proxy(&self, address: ManagedAddress)
        -> token_manager_proxy::Proxy<Self::Api>;

    #[proxy]
    fn executable_contract_proxy(
        &self,
        sc_address: ManagedAddress,
    ) -> executable_contract_proxy::Proxy<Self::Api>;

    // This seems to work fine on Devnet
    #[callback]
    fn execute_with_token_callback(
        &self,
        command_id: ManagedBuffer,
        token_id: TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
        #[call_result] result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(_) => {
                self.token_received_with_data_success_event(
                    command_id,
                    token_id,
                    token_identifier,
                    amount,
                );
            }
            ManagedAsyncCallResult::Err(_) => {
                self.token_received_with_data_error_event(
                    command_id,
                    &token_id,
                    &token_identifier,
                    &amount,
                );

                self.token_manager_take_token(&token_id, token_identifier, amount);
            }
        }
    }

    // This seems to work fine on Devnet
    #[callback]
    fn exp_execute_with_token_callback(
        &self,
        caller: ManagedAddress,
        command_id: ManagedBuffer,
        token_id: TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
        express_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[call_result] result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(_) => {
                self.express_token_received_with_data_success_event(
                    caller,
                    command_id,
                    token_id,
                    token_identifier,
                    amount,
                );
            }
            ManagedAsyncCallResult::Err(_) => {
                self.send().direct(&caller, &token_identifier, 0, &amount);

                self.express_receive_token_slot(&express_hash).clear();

                self.express_token_received_with_data_error_event(
                    &caller,
                    command_id,
                    &token_id,
                    &token_identifier,
                    &amount,
                );
            }
        }
    }

    // This seems to work fine on Devnet
    #[callback]
    fn deploy_remote_token_callback(
        &self,
        token_id: TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        destination_chain: ManagedBuffer,
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
                    // Send back payed cross chain gas value to initial caller if token is non fungible
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

                let token_identifier_name = token_identifier.into_name();
                // Leave the symbol be the beginning of the indentifier before `-`
                let token_symbol = token_identifier_name
                    .copy_slice(0, token_identifier_name.len() - 7)
                    .unwrap();

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
            ManagedAsyncCallResult::Err(_) => {
                // Send back payed gas value to initial caller
                self.send().direct_non_zero_egld(&caller, &gas_value);
            }
        }
    }
}
