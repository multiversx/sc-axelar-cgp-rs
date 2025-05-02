#![no_std]

multiversx_sc::imports!();

pub const CALLBACK_GAS: u64 = 10_000_000; // The callback should be prevented from failing at all costs
pub const KEEP_EXTRA_GAS: u64 = 10_000_000; // Extra gas to keep in contract before registering async promise. This needs to be a somewhat larger value

pub type TokenId<M> = ManagedByteArray<M, 32>;

pub mod contract_proxy {
    use crate::TokenId;

    multiversx_sc::imports!();

    // Proxy for your contract, it can have whatever functions and signature you want
    // For security reasons, make sure that only this Proxy can call the respective endpoint from your contract!
    #[multiversx_sc::proxy]
    pub trait ExecutableContractProxy {
        #[payable("*")]
        #[endpoint(executeWithInterchainToken)]
        fn execute_with_interchain_token(
            &self,
            source_chain: &ManagedBuffer,
            message_id: &ManagedBuffer,
            source_address: &ManagedBuffer,
            data: &ManagedBuffer,
            token_id: &TokenId<Self::Api>,
        );
    }
}

// This Proxy contract should be on the same Shard as the MultiversX Axelar ITS contract, and forward calls to your contract on another Shard
#[multiversx_sc::contract]
pub trait InterchainTokenServiceProxy {
    // Store interchain_token_service address and your contract_address into storage
    #[init]
    fn init(
        &self,
        interchain_token_service: ManagedAddress,
        contract_address: ManagedAddress,
        min_gas_for_execution: u64,
    ) {
        self.interchain_token_service()
            .set(interchain_token_service);
        self.contract_address().set(contract_address);
        self.min_gas_for_execution().set(min_gas_for_execution);
    }

    #[upgrade]
    fn upgrade(&self, min_gas_for_execution: u64) {
        self.min_gas_for_execution().set(min_gas_for_execution);
    }

    // This function will be called by the Interchain Token Service, it has to have this exact signature!
    #[payable("*")]
    #[endpoint(executeWithInterchainToken)]
    fn execute_with_interchain_token(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        source_address: ManagedBuffer,
        data: ManagedBuffer,
        token_id: TokenId<Self::Api>,
    ) {
        // If the Interchain Token Service contract calls this Proxy, take tokens from that.
        // If not, check if the call was previously failed in order to allow anyone to retry
        // failed calls
        let (token_identifier, amount) =
            if self.blockchain().get_caller() == self.interchain_token_service().get() {
                // Get tokens sent by Interchain Token Service
                self.call_value().egld_or_single_fungible_esdt()
            } else {
                let failed_calls_mapper = self.failed_calls(
                    &source_chain,
                    &message_id,
                    &source_address,
                    &data,
                    &token_id,
                );

                require!(!failed_calls_mapper.is_empty(), "Call is not allowed");
                require!(
                    self.call_value().any_payment().is_empty(),
                    "Can not send any payment"
                );

                failed_calls_mapper.take()
            };

        let gas_left = self.blockchain().get_gas_left();

        // Reserve gas needed for your contract call, this can be dynamically calculated based on the `data`
        require!(
            gas_left >= self.min_gas_for_execution().get() + CALLBACK_GAS + KEEP_EXTRA_GAS,
            "Not enough gas left for async call"
        );

        let gas_limit = gas_left - CALLBACK_GAS - KEEP_EXTRA_GAS;

        // Forward call to your contract. In your contract you should check if the call comes from
        // this proxy contract and act accordingly.
        // The callback should be prevented from failing at all costs, in order for the system to not
        // remain in an unrecoverable state!
        self.contract_proxy(self.contract_address().get())
            .execute_with_interchain_token(
                &source_chain,
                &message_id,
                &source_address,
                &data,
                &token_id,
            )
            .with_egld_or_single_esdt_transfer((token_identifier.clone(), 0, amount.clone()))
            .with_gas_limit(gas_limit)
            .with_callback(self.callbacks().execute_callback(
                source_chain,
                message_id,
                source_address,
                data,
                token_id,
                token_identifier,
                amount,
            ))
            .with_extra_gas_for_callback(CALLBACK_GAS)
            .register_promise();
    }

    #[only_owner]
    #[endpoint(setMinGasForExecution)]
    fn set_min_gas_for_execution(&self, min_gas_for_execution: u64) {
        self.min_gas_for_execution().set(min_gas_for_execution);
    }

    #[view(interchainTokenService)]
    #[storage_mapper("interchain_token_service")]
    fn interchain_token_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(contractAddress)]
    #[storage_mapper("contract_address")]
    fn contract_address(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(minGasForExecution)]
    #[storage_mapper("min_gas_for_execution")]
    fn min_gas_for_execution(&self) -> SingleValueMapper<u64>;

    #[view(failedCalls)]
    #[storage_mapper("failed_calls")]
    fn failed_calls(
        &self,
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
        source_address: &ManagedBuffer,
        data: &ManagedBuffer,
        token_id: &TokenId<Self::Api>,
    ) -> SingleValueMapper<(EgldOrEsdtTokenIdentifier, BigUint)>;

    #[proxy]
    fn contract_proxy(&self, sc_address: ManagedAddress) -> contract_proxy::Proxy<Self::Api>;

    #[promises_callback]
    fn execute_callback(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        source_address: ManagedBuffer,
        data: ManagedBuffer,
        token_id: TokenId<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
        #[call_result] result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(_) => {
                self.execute_success_event(source_chain, message_id);
            }
            ManagedAsyncCallResult::Err(_) => {
                // Saved failed calls to be recovered later by the dApp
                // In is up to your dApp contract to handle failure resolution!
                // You can also save the user address or other information you have in the `data` field
                // that would be relevant for your dApp
                self.failed_calls(
                    &source_chain,
                    &message_id,
                    &source_address,
                    &data,
                    &token_id,
                )
                .set((token_identifier, amount));

                self.execute_failed_event(source_chain, message_id, source_address, token_id, data);
            }
        }
    }

    #[event("execute_success_event")]
    fn execute_success_event(
        &self,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] message_id: ManagedBuffer,
    );

    // It is up to your dApp to handle this event and allow users to retry their calls if needed
    #[event("execute_failed_event")]
    fn execute_failed_event(
        &self,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] message_id: ManagedBuffer,
        #[indexed] source_address: ManagedBuffer,
        #[indexed] token_id: TokenId<Self::Api>,
        data: ManagedBuffer,
    );
}
