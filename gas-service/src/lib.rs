#![no_std]

use crate::events::{
    AddGasData, AddNativeGasData, GasPaidForContractCallData, NativeGasPaidForContractCallData,
    RefundedData,
};

multiversx_sc::imports!();

mod events;

#[multiversx_sc::contract]
pub trait GasService: events::Events {
    #[init]
    fn init(&self, gas_collector: &ManagedAddress) {
        self.gas_collector().set_if_empty(gas_collector);
    }

    #[payable("*")]
    #[endpoint(payGasForContractCall)]
    fn pay_gas_for_contract_call(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        payload: ManagedBuffer,
        refund_address: ManagedAddress,
    ) {
        let (gas_token, gas_fee_amount) = self.call_value().single_fungible_esdt();

        let sender = self.blockchain().get_caller();
        let hash = self.crypto().keccak256(&payload);

        self.gas_paid_for_contract_call_event(
            sender,
            destination_chain,
            destination_address,
            GasPaidForContractCallData {
                hash,
                gas_token,
                gas_fee_amount,
                refund_address,
            },
        );
    }

    #[payable("EGLD")]
    #[endpoint(payNativeGasForContractCall)]
    fn pay_native_gas_for_contract_call(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        payload: ManagedBuffer,
        refund_address: ManagedAddress,
    ) {
        let value = self.call_value().egld_value().clone_value();

        require!(value > 0, "Nothing received");

        let sender = self.blockchain().get_caller();
        let hash = self.crypto().keccak256(&payload);

        self.native_gas_paid_for_contract_call_event(
            sender,
            destination_chain,
            destination_address,
            NativeGasPaidForContractCallData {
                hash,
                value,
                refund_address,
            },
        );
    }

    #[payable("*")]
    #[endpoint(payGasForExpressCall)]
    fn pay_gas_for_express_call(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        payload: ManagedBuffer,
        refund_address: ManagedAddress,
    ) {
        let (gas_token, gas_fee_amount) = self.call_value().single_fungible_esdt();

        let sender = self.blockchain().get_caller();
        let hash = self.crypto().keccak256(&payload);

        self.gas_paid_for_express_call(
            sender,
            destination_chain,
            destination_address,
            GasPaidForContractCallData {
                hash,
                gas_token,
                gas_fee_amount,
                refund_address,
            },
        );
    }

    #[payable("EGLD")]
    #[endpoint(payNativeGasForExpressCall)]
    fn pay_native_gas_for_express_call(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        payload: ManagedBuffer,
        refund_address: ManagedAddress,
    ) {
        let value = self.call_value().egld_value().clone_value();

        require!(value > 0, "Nothing received");

        let sender = self.blockchain().get_caller();
        let hash = self.crypto().keccak256(&payload);

        self.native_gas_paid_for_express_call(
            sender,
            destination_chain,
            destination_address,
            NativeGasPaidForContractCallData {
                hash,
                value,
                refund_address,
            },
        );
    }

    #[payable("*")]
    #[endpoint(addGas)]
    fn add_gas(&self, tx_hash: ManagedBuffer, log_index: BigUint, refund_address: ManagedAddress) {
        let (gas_token, gas_fee_amount) = self.call_value().single_fungible_esdt();

        self.gas_added_event(
            tx_hash,
            log_index,
            AddGasData {
                gas_token,
                gas_fee_amount,
                refund_address,
            },
        );
    }

    #[payable("EGLD")]
    #[endpoint(addNativeGas)]
    fn add_native_gas(
        &self,
        tx_hash: ManagedBuffer,
        log_index: BigUint,
        refund_address: ManagedAddress,
    ) {
        let value = self.call_value().egld_value().clone_value();

        require!(value > 0, "Nothing received");

        self.native_gas_added_event(
            tx_hash,
            log_index,
            AddNativeGasData {
                value,
                refund_address,
            },
        );
    }

    #[payable("*")]
    #[endpoint(addExpressGas)]
    fn add_express_gas(
        &self,
        tx_hash: ManagedBuffer,
        log_index: BigUint,
        refund_address: ManagedAddress,
    ) {
        let (gas_token, gas_fee_amount) = self.call_value().single_fungible_esdt();

        self.express_gas_added_event(
            tx_hash,
            log_index,
            AddGasData {
                gas_token,
                gas_fee_amount,
                refund_address,
            },
        );
    }

    #[payable("EGLD")]
    #[endpoint(addNativeExpressGas)]
    fn add_native_express_gas(
        &self,
        tx_hash: ManagedBuffer,
        log_index: BigUint,
        refund_address: ManagedAddress,
    ) {
        let value = self.call_value().egld_value().clone_value();

        require!(value > 0, "Nothing received");

        self.native_express_gas_added_event(
            tx_hash,
            log_index,
            AddNativeGasData {
                value,
                refund_address,
            },
        );
    }

    #[endpoint(collectFees)]
    fn collect_fees(
        &self,
        receiver: &ManagedAddress,
        tokens: MultiValueManagedVecCounted<EgldOrEsdtTokenIdentifier>,
        amounts: MultiValueManagedVecCounted<BigUint>,
    ) {
        self.require_only_collector();

        require!(!receiver.is_zero(), "Invalid address");

        let tokens_length = tokens.len();
        require!(tokens_length == amounts.len(), "Invalid amounts");

        let tokens_vec = tokens.into_vec();
        let amounts_vec = amounts.into_vec();

        let mut payments = ManagedVec::new();

        for index in 0..tokens_length {
            let token: EgldOrEsdtTokenIdentifier = tokens_vec.get(index);
            let amount = amounts_vec.get(index).clone_value();

            require!(amount > 0, "Invalid amounts");

            let balance = self.blockchain().get_sc_balance(&token, 0);

            if token.is_egld() {
                if amount <= balance {
                    self.send().direct_egld(receiver, &amount);
                }
            } else if amount <= balance {
                payments.push(EsdtTokenPayment::new(token.unwrap_esdt(), 0, amount));
            }
        }

        if !payments.is_empty() {
            self.send().direct_multi(receiver, &payments);
        }
    }

    #[endpoint(refund)]
    fn refund(
        &self,
        tx_hash: ManagedBuffer,
        log_index: BigUint,
        receiver: ManagedAddress,
        token: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
    ) {
        self.require_only_collector();

        require!(!receiver.is_zero(), "Invalid address");

        self.send().direct(&receiver, &token, 0, &amount);

        self.refunded_event(
            tx_hash,
            log_index,
            RefundedData {
                receiver,
                token,
                amount,
            },
        );
    }

    fn require_only_collector(&self) {
        let caller = self.blockchain().get_caller();
        let collector = self.gas_collector().get();

        require!(caller == collector, "Not collector");
    }

    #[view]
    #[storage_mapper("gas_collector")]
    fn gas_collector(&self) -> SingleValueMapper<ManagedAddress>;
}
