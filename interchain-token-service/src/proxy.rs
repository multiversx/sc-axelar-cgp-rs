use multiversx_sc::api::KECCAK256_RESULT_LEN;

use gas_service::ProxyTrait as _;
use gateway::ProxyTrait as _;
use token_manager::constants::TokenManagerType;
use token_manager::flow_limit::ProxyTrait as _;
use token_manager::ProxyTrait as _;

use crate::constants::{MetadataVersion, TokenId};
use crate::{address_tracker, events, express_executor_tracker};

multiversx_sc::imports!();

pub mod executable_contract_proxy {
    use multiversx_sc::api::KECCAK256_RESULT_LEN;

    multiversx_sc::imports!();

    // Contracts having these functions should check that the InterchainTokenService contract called them
    #[multiversx_sc::proxy]
    pub trait ExecutableContractProxy {
        #[payable("*")]
        #[endpoint(executeWithInterchainToken)]
        fn execute_with_interchain_token(
            &self,
            command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
            source_chain: ManagedBuffer,
            source_address: ManagedBuffer,
            data: ManagedBuffer,
            token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        );

        #[payable("*")]
        #[endpoint(expressExecuteWithInterchainToken)]
        fn express_execute_with_interchain_token(
            &self,
            command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
            source_chain: ManagedBuffer,
            source_address: ManagedBuffer,
            data: ManagedBuffer,
            token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        );
    }
}

#[multiversx_sc::module]
pub trait ProxyModule:
    events::EventsModule
    + address_tracker::AddressTracker
    + express_executor_tracker::ExpressExecutorTracker
    + multiversx_sc_modules::pause::PauseModule
{
    fn gas_service_pay_gas_for_contract_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        token_identifier: EgldOrEsdtTokenIdentifier,
        gas_value: BigUint,
    ) {
        if token_identifier.is_egld() {
            self.gas_service_pay_native_gas_for_contract_call(
                destination_chain,
                destination_address,
                payload,
                gas_value,
            );

            return;
        }

        self.gas_service_proxy(self.gas_service().get())
            .pay_gas_for_contract_call(
                self.blockchain().get_sc_address(),
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_esdt_transfer(EsdtTokenPayment::new(
                token_identifier.unwrap_esdt(),
                0,
                gas_value,
            ))
            .execute_on_dest_context::<()>();
    }

    fn gas_service_pay_native_gas_for_contract_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.gas_service_proxy(self.gas_service().get())
            .pay_native_gas_for_contract_call(
                self.blockchain().get_sc_address(),
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_egld_transfer(gas_value)
            .execute_on_dest_context::<()>();
    }

    fn gas_service_pay_gas_for_express_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        token_identifier: EgldOrEsdtTokenIdentifier,
        gas_value: BigUint,
    ) {
        if token_identifier.is_egld() {
            self.gas_service_pay_native_gas_for_express_call(
                destination_chain,
                destination_address,
                payload,
                gas_value,
            );

            return;
        }

        self.gas_service_proxy(self.gas_service().get())
            .pay_gas_for_express_call(
                self.blockchain().get_sc_address(),
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_esdt_transfer(EsdtTokenPayment::new(
                token_identifier.unwrap_esdt(),
                0,
                gas_value,
            ))
            .execute_on_dest_context::<()>();
    }

    fn gas_service_pay_native_gas_for_express_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.gas_service_proxy(self.gas_service().get())
            .pay_native_gas_for_express_call(
                self.blockchain().get_sc_address(),
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_egld_transfer(gas_value)
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

    fn gateway_is_command_executed(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .is_command_executed(command_id)
            .execute_on_dest_context::<bool>()
    }

    fn gateway_validate_contract_call(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .validate_contract_call(command_id, source_chain, source_address, payload_hash)
            .execute_on_dest_context::<bool>()
    }

    fn gateway_is_contract_call_approved(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
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
                payload_hash,
            )
            .execute_on_dest_context::<bool>()
    }

    fn token_manager_take_token(
        &self,
        token_id: &TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
    ) {
        self.token_manager_proxy(self.valid_token_manager_address(token_id))
            .take_token()
            .with_egld_or_single_esdt_transfer(EgldOrEsdtTokenPayment::new(
                token_identifier,
                0,
                amount,
            ))
            .execute_on_dest_context::<()>();
    }

    fn token_manager_set_flow_limit(&self, token_id: &TokenId<Self::Api>, flow_limit: &BigUint) {
        self.token_manager_proxy(self.valid_token_manager_address(token_id))
            .set_flow_limit(flow_limit)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_give_token(
        &self,
        token_id: &TokenId<Self::Api>,
        destination_address: &ManagedAddress,
        amount: &BigUint,
    ) -> (EgldOrEsdtTokenIdentifier, BigUint) {
        self.token_manager_proxy(self.valid_token_manager_address(token_id))
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
        self.token_manager_proxy(self.valid_token_manager_address(token_id))
            .deploy_interchain_token(minter, name, symbol, decimals)
            .with_egld_transfer(self.call_value().egld_value().clone_value())
            .with_gas_limit(100_000_000) // Need to specify gas manually here because the function does an async call. This should be plenty
            .execute_on_dest_context::<()>();
    }

    // TODO
    fn token_manager_implementation_type(&self, sc_address: ManagedAddress) -> TokenManagerType {
        self.token_manager_proxy(sc_address)
            .implementation_type()
            .execute_on_dest_context()
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
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) {
        self.executable_contract_proxy(destination_address)
            .execute_with_interchain_token(
                &command_id,
                source_chain,
                source_address,
                data,
                token_id.clone(),
            )
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
        express_executor: ManagedAddress,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        express_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) {
        self.executable_contract_proxy(destination_address)
            .express_execute_with_interchain_token(
                &command_id,
                source_chain,
                source_address,
                data,
                token_id,
            )
            .with_egld_or_single_esdt_transfer((token_identifier.clone(), 0, amount.clone()))
            .async_call()
            .with_callback(self.callbacks().exp_execute_with_token_callback(
                express_executor,
                command_id,
                token_identifier,
                amount,
                express_hash,
            ))
            .call_and_exit();
    }

    fn call_contract(
        &self,
        destination_chain: &ManagedBuffer,
        payload: &ManagedBuffer,
        metadata_version: MetadataVersion,
        gas_token: EgldOrEsdtTokenIdentifier,
        gas_value: BigUint,
    ) {
        let destination_address = self.trusted_address(destination_chain);

        require!(!destination_address.is_empty(), "Untrusted chain");

        let destination_address = destination_address.get();

        if gas_value > 0 {
            match metadata_version {
                MetadataVersion::ContractCall => self.gas_service_pay_gas_for_contract_call(
                    destination_chain,
                    &destination_address,
                    payload,
                    gas_token,
                    gas_value,
                ),
                MetadataVersion::ExpressCall => self.gas_service_pay_gas_for_express_call(
                    destination_chain,
                    &destination_address,
                    payload,
                    gas_token,
                    gas_value,
                ),
            }
        }

        self.gateway_call_contract(destination_chain, &destination_address, payload);
    }

    #[view(flowLimit)]
    fn flow_limit(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.valid_token_manager_address(&token_id))
            .flow_limit()
            .execute_on_dest_context()
    }

    #[view(flowOutAmount)]
    fn flow_out_amount(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.valid_token_manager_address(&token_id))
            .get_flow_out_amount()
            .execute_on_dest_context()
    }

    #[view(flowInAmount)]
    fn flow_in_amount(&self, token_id: TokenId<Self::Api>) -> BigUint {
        self.token_manager_proxy(self.valid_token_manager_address(&token_id))
            .get_flow_in_amount()
            .execute_on_dest_context()
    }

    #[view(validTokenManagerAddress)]
    fn valid_token_manager_address(&self, token_id: &TokenId<Self::Api>) -> ManagedAddress {
        let token_manager_address_mapper = self.token_manager_address(token_id);

        require!(
            !token_manager_address_mapper.is_empty(),
            "Token manager does not exist"
        );

        token_manager_address_mapper.get()
    }

    #[view(validTokenIdentifier)]
    fn valid_token_identifier(&self, token_id: &TokenId<Self::Api>) -> EgldOrEsdtTokenIdentifier {
        self.token_manager_proxy(self.valid_token_manager_address(token_id))
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

    #[view]
    #[storage_mapper("gateway")]
    fn gateway(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(gasService)]
    #[storage_mapper("gas_service")]
    fn gas_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(tokenManagerAddress)]
    #[storage_mapper("token_manager_address")]
    fn token_manager_address(
        &self,
        token_id: &TokenId<Self::Api>,
    ) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway::Proxy<Self::Api>;

    #[proxy]
    fn gas_service_proxy(&self, sc_address: ManagedAddress) -> gas_service::Proxy<Self::Api>;

    #[proxy]
    fn token_manager_proxy(&self, address: ManagedAddress) -> token_manager::Proxy<Self::Api>;

    #[proxy]
    fn executable_contract_proxy(
        &self,
        sc_address: ManagedAddress,
    ) -> executable_contract_proxy::Proxy<Self::Api>;

    // This seems to work fine on Devnet
    #[callback]
    fn execute_with_token_callback(
        &self,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        token_id: TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
        #[call_result] result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(_) => {
                self.execute_with_interchain_token_success_event(command_id);
            }
            ManagedAsyncCallResult::Err(_) => {
                self.token_manager_take_token(&token_id, token_identifier, amount);

                self.execute_with_interchain_token_failed_event(command_id);
            }
        }
    }

    // This seems to work fine on Devnet
    #[callback]
    fn exp_execute_with_token_callback(
        &self,
        express_executor: ManagedAddress,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
        express_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[call_result] result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(_) => {
                self.express_execute_with_interchain_token_success_event(
                    &command_id,
                    &express_executor,
                );
            }
            ManagedAsyncCallResult::Err(_) => {
                self.send()
                    .direct(&express_executor, &token_identifier, 0, &amount);

                self.express_execute(&express_hash).clear();

                self.express_execute_with_interchain_token_failed_event(
                    &command_id,
                    &express_executor,
                );
            }
        }
    }
}
