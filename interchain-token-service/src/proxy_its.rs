use multiversx_sc::api::KECCAK256_RESULT_LEN;

use token_manager::flow_limit::ProxyTrait as _;
use token_manager::ProxyTrait as _;

use crate::constants::TokenId;
use crate::{events, express_executor_tracker};

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
pub trait ProxyItsModule:
    events::EventsModule + express_executor_tracker::ExpressExecutorTracker
{
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
