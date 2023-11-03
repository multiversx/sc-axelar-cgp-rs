# MultiversX Gas Service Smart Contract

The gas service contract is responsible for handling cross-chain gas payments.
Before a cross-chain call is made (before the Gateway contract **callContract** endpoint is called), the cross-chain gas should
be paid using one of the endpoints of this contract.

The endpoints in this contract emit events which will later be catched by Relayers and forwarded to Validators (TBD)

## Important endpoints

The most used endpoints are:
- **payGasForContractCall** (destination_chain, destination_address, payload, refund_address) - accepts ESDT payment
- **payNativeGasForContractCall** (destination_chain, destination_address, payload, refund_address) - accepts EGLD payment

These endpoints look like this:
```rust
#[payable("*")]
#[endpoint(payGasForContractCall)]
fn pay_gas_for_contract_call(
    &self,
    destination_chain: ManagedBuffer,
    destination_address: ManagedBuffer,
    payload: ManagedBuffer,
    refund_address: ManagedAddress,
)
```

It will emit a **gas_paid_for_contract_call_event**:
```rust
#[event("gas_paid_for_contract_call_event")]
fn gas_paid_for_contract_call_event(
    &self,
    #[indexed] sender: ManagedAddress,
    #[indexed] destination_chain: ManagedBuffer,
    #[indexed] destination_contract_address: ManagedBuffer,
    data: GasPaidForContractCallData<Self::Api>,
);
```

Where **GasPaidForContractCallData** is a struct with the following fields:
```rust
#[derive(TypeAbi, TopEncode)]
pub struct GasPaidForContractCallData<M: ManagedTypeApi> {
    pub hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub gas_token: TokenIdentifier<M>,
    pub gas_fee_amount: BigUint<M>,
    pub refund_address: ManagedAddress<M>,
}
```

The endpoint for paying gas with native token (EGLD) is similar:
```rust
#[payable("EGLD")]
#[endpoint(payNativeGasForContractCall)]
fn pay_native_gas_for_contract_call(
    &self,
    destination_chain: ManagedBuffer,
    destination_address: ManagedBuffer,
    payload: ManagedBuffer,
    refund_address: ManagedAddress,
);
```

It will emit a **native_gas_paid_for_contract_call_event**:
```rust
#[event("native_gas_paid_for_contract_call_event")]
fn native_gas_paid_for_contract_call_event(
    &self,
    #[indexed] sender: ManagedAddress,
    #[indexed] destination_chain: ManagedBuffer,
    #[indexed] destination_contract_address: ManagedBuffer,
    data: NativeGasPaidForContractCallData<Self::Api>,
);
```

Where **NativeGasPaidForContractCallData** is a struct with the following fields:
```rust
#[derive(TypeAbi, TopEncode)]
pub struct NativeGasPaidForContractCallData<M: ManagedTypeApi> {
    pub hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub value: BigUint<M>,
    pub refund_address: ManagedAddress<M>,
}
```
