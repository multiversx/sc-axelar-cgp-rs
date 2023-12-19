multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopEncode)]
pub struct GasPaidForContractCallData<M: ManagedTypeApi> {
    pub hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub gas_token: TokenIdentifier<M>,
    pub gas_fee_amount: BigUint<M>,
    pub refund_address: ManagedAddress<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct NativeGasPaidForContractCallData<M: ManagedTypeApi> {
    pub hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub value: BigUint<M>,
    pub refund_address: ManagedAddress<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct AddGasData<M: ManagedTypeApi> {
    pub gas_token: TokenIdentifier<M>,
    pub gas_fee_amount: BigUint<M>,
    pub refund_address: ManagedAddress<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct AddNativeGasData<M: ManagedTypeApi> {
    pub value: BigUint<M>,
    pub refund_address: ManagedAddress<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct RefundedData<M: ManagedTypeApi> {
    pub receiver: ManagedAddress<M>,
    pub token: EgldOrEsdtTokenIdentifier<M>,
    pub amount: BigUint<M>,
}

#[multiversx_sc::module]
pub trait Events {
    #[event("gas_paid_for_contract_call_event")]
    fn gas_paid_for_contract_call_event(
        &self,
        #[indexed] sender: ManagedAddress,
        #[indexed] destination_chain: ManagedBuffer,
        #[indexed] destination_contract_address: ManagedBuffer,
        data: GasPaidForContractCallData<Self::Api>,
    );

    #[event("native_gas_paid_for_contract_call_event")]
    fn native_gas_paid_for_contract_call_event(
        &self,
        #[indexed] sender: ManagedAddress,
        #[indexed] destination_chain: ManagedBuffer,
        #[indexed] destination_contract_address: ManagedBuffer,
        data: NativeGasPaidForContractCallData<Self::Api>,
    );

    #[event("gas_paid_for_express_call")]
    fn gas_paid_for_express_call(
        &self,
        #[indexed] sender: ManagedAddress,
        #[indexed] destination_chain: ManagedBuffer,
        #[indexed] destination_contract_address: ManagedBuffer,
        data: GasPaidForContractCallData<Self::Api>,
    );

    #[event("native_gas_paid_for_express_call")]
    fn native_gas_paid_for_express_call(
        &self,
        #[indexed] sender: ManagedAddress,
        #[indexed] destination_chain: ManagedBuffer,
        #[indexed] destination_contract_address: ManagedBuffer,
        data: NativeGasPaidForContractCallData<Self::Api>,
    );

    #[event("gas_added_event")]
    fn gas_added_event(
        &self,
        #[indexed] tx_hash: ManagedBuffer,
        #[indexed] log_index: BigUint,
        data: AddGasData<Self::Api>,
    );

    #[event("native_gas_added_event")]
    fn native_gas_added_event(
        &self,
        #[indexed] tx_hash: ManagedBuffer,
        #[indexed] log_index: BigUint,
        data: AddNativeGasData<Self::Api>,
    );

    #[event("express_gas_added_event")]
    fn express_gas_added_event(
        &self,
        #[indexed] tx_hash: ManagedBuffer,
        #[indexed] log_index: BigUint,
        data: AddGasData<Self::Api>,
    );

    #[event("native_express_gas_added_event")]
    fn native_express_gas_added_event(
        &self,
        #[indexed] tx_hash: ManagedBuffer,
        #[indexed] log_index: BigUint,
        data: AddNativeGasData<Self::Api>,
    );

    #[event("refunded_event")]
    fn refunded_event(
        &self,
        #[indexed] tx_hash: ManagedBuffer,
        #[indexed] log_index: BigUint,
        data: RefundedData<Self::Api>,
    );
}
