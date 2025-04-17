#![no_std]

multiversx_sc::imports!();

pub const CONTRACT_GAS_NEEDED: u64 = 20_000_000; // Gas needed for contract execution, can be dynamically calculated based on the data

pub const CALLBACK_GAS: u64 = 10_000_000; // The callback should be prevented from failing at all costs
pub const KEEP_EXTRA_GAS: u64 = 10_000_000; // Extra gas to keep in contract before registering async promise. This needs to be a somewhat larger value

pub type TokenId<M> = ManagedByteArray<M, 32>;

pub mod contract_proxy {
    use crate::TokenId;

    multiversx_sc::imports!();

    // Proxy for your contract, it can have whatever functions you want
    // For security reasons, the functions you call should check that the caller is exclusively this Proxy contract
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

// This Proxy contract should be on the same Shard as the MultiversX Axelar ITS contract, and forward calls to your contract on another Shard
#[multiversx_sc::contract]
pub trait InterchainTokenServiceProxy {
    // Store interchain_token_service address and your contract_address into storage
    #[init]
    fn init(&self, interchain_token_service: ManagedAddress, contract_address: ManagedAddress) {
        self.interchain_token_service()
            .set(interchain_token_service);
        self.contract_address().set(contract_address);
    }

    #[upgrade]
    fn upgrade(&self) {}

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
        // Make sure that only the Interchain Token Service contract can call this Proxy!
        // Additionally, make sure that only this Proxy can call the respective endpoint from your contract!
        require!(
            self.blockchain().get_caller() == self.interchain_token_service().get(),
            "Only its contract can call this"
        );

        let gas_left = self.blockchain().get_gas_left();

        // Reserve gas needed for your contract call, this can be dynamically calculated based on the `data`
        require!(
            gas_left >= CONTRACT_GAS_NEEDED + CALLBACK_GAS + KEEP_EXTRA_GAS,
            "Not enough gas left for async call"
        );

        let gas_limit = gas_left - CALLBACK_GAS - KEEP_EXTRA_GAS;

        // Get tokens sent by Interchain Token Service
        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        // Forward call to your contract. In your contract you should check if the call comes from
        // this proxy contract and act accordingly.
        // The callback should be prevented from failing at all costs, in order for the system to not
        // remain in an unrecoverable state!
        self.contract_proxy(self.contract_address().get())
            .execute_with_interchain_token(
                &source_chain,
                &message_id,
                source_address,
                data,
                token_id.clone(),
            )
            .with_egld_or_single_esdt_transfer((token_identifier.clone(), 0, amount.clone()))
            .with_gas_limit(gas_limit)
            .with_callback(self.callbacks().execute_callback(
                source_chain,
                message_id,
                token_identifier,
                amount,
            ))
            .with_extra_gas_for_callback(CALLBACK_GAS)
            .register_promise();
    }

    #[view(interchainTokenService)]
    #[storage_mapper("interchain_token_service")]
    fn interchain_token_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(contractAddress)]
    #[storage_mapper("contract_address")]
    fn contract_address(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(failedCalls)]
    #[storage_mapper("failed_calls")]
    fn failed_calls(
        &self,
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
    ) -> SingleValueMapper<(EgldOrEsdtTokenIdentifier, BigUint)>;

    #[proxy]
    fn contract_proxy(&self, sc_address: ManagedAddress) -> contract_proxy::Proxy<Self::Api>;

    #[promises_callback]
    fn execute_callback(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
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
                // You probably also want to save the user address or other information you have in the `data` field
                // that would be relevant for a your dApp
                self.failed_calls(&source_chain, &message_id)
                    .set((token_identifier, amount));

                self.execute_failed_event(source_chain, message_id);
            }
        }
    }

    #[event("execute_success_event")]
    fn execute_success_event(
        &self,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] message_id: ManagedBuffer,
    );

    #[event("execute_failed_event")]
    fn execute_failed_event(
        &self,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] message_id: ManagedBuffer,
    );
}
