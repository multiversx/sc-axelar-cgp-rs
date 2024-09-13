#![no_std]

mod constants;

multiversx_sc::imports!();

use crate::constants::{Call, DestinationCalls};
use multiversx_sc::api::KECCAK256_RESULT_LEN;

/// An empty contract. To be used as a template when starting a new contract from scratch.
#[multiversx_sc::contract]
pub trait Multicall {
    #[init]
    fn init(&self, axelar_gateway: ManagedAddress, interchain_token_service: ManagedAddress) {
        require!(
            !axelar_gateway.is_zero() && !interchain_token_service.is_zero(),
            "Zero address provided"
        );

        self.axelar_gateway().set(axelar_gateway);
        self.interchain_token_service()
            .set(interchain_token_service);
    }

    #[payable("*")]
    #[endpoint(fundAndRunMulticall)]
    fn fund_and_run_multicall(&self, calls: MultiValueEncoded<Call>) {
        // TODO: Run multicall
    }

    #[payable("*")]
    #[endpoint(executeWithInterchainToken)]
    fn execute_with_interchain_token(
        &self,
        _source_chain: ManagedBuffer,
        _message_id: ManagedBuffer,
        _source_address: ManagedBuffer,
        payload: ManagedBuffer,
        _token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) {
        require!(
            self.blockchain().get_caller() == self.interchain_token_service().get(),
            "Not service"
        );

        let payment = self.call_value().egld_or_single_esdt();

        if payload.len() == 32 {
            let decode_address = ManagedAddress::try_from(payload);

            require!(decode_address.is_some(), "Invalid MultiversX address");

            self.send().direct(
                &decode_address.unwrap(),
                &payment.token_identifier,
                0,
                &payment.amount,
            );

            return;
        }

        let destination_calls = DestinationCalls::<Self::Api>::top_decode(payload)
            .unwrap_or(|| sc_panic!("Could not decode payload"));

        // TODO: Run calls
    }

    #[view(getAxelarGateway)]
    #[storage_mapper("axelar_gateway")]
    fn axelar_gateway(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(getInterchainTokenService)]
    #[storage_mapper("interchain_token_service")]
    fn interchain_token_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway::Proxy<Self::Api>;
}
