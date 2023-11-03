# MultiversX Gateway Smart Contract

This contract provides endpoints for outward cross-chain transactions from MultiversX to other blockchains,
as well as from inward cross-chain transactions, facilitated through the Axelar network and the Relayer services.

## MultiversX → other blockchain transactions

Outward cross-chain contract calls can be initiated by calling the publicly accessible **callContract** endpoint:
```rust
#[endpoint(callContract)]
fn call_contract(
    &self,
    destination_chain: ManagedBuffer,
    destination_contract_address: ManagedBuffer,
    payload: ManagedBuffer,
);
```

The payload needs to be a string with data encoded in the format that the destination contract expects.

This endpoint will then dispatch the **contract_call_event** with the following information:
```rust
#[event("contract_call_event")]
fn contract_call_event(
    &self,
    #[indexed] sender: ManagedAddress,
    #[indexed] destination_chain: ManagedBuffer,
    #[indexed] destination_contract_address: ManagedBuffer,
    data: ContractCallData<Self::Api>,
);
```

Where **ContractCallData** has the following information:
```rust
#[derive(TypeAbi, TopEncode)]
pub struct ContractCallData<M: ManagedTypeApi> {
    pub hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub payload: ManagedBuffer<M>,
}
```
Hash being the **keccak256** hash of the payload.

## Other blockchain transactions → MultiversX

To facilitate cross-chain communication with MultiversX, there is one main endpoint called **execute**, which can however handle multiple commands that were authorized by the Axelar network and then sent to the MultiversX blockchain by a Relayer in one transaction.

There is another endpoint used by supported smart contracts to validate that they have been called successfully.
- **execute** (data, proof)
- **validateContractCall** (command_id, source_chain, source_address, payload_hash)
```rust
#[endpoint(execute)]
fn execute(&self, data: ManagedBuffer, proof: ManagedBuffer)
```
The **data** argument contains the **ExecuteData** struct as **top encoded bytes**. The struct has the following fields:
```rust
#[derive(TypeAbi, TopDecode, Debug)]
pub struct ExecuteData<M: ManagedTypeApi> {
    pub command_ids: ManagedVec<M, ManagedBuffer<M>>,
    pub commands: ManagedVec<M, ManagedBuffer<M>>,
    pub params: ManagedVec<M, ManagedBuffer<M>>,
}
```

The **params** contain different **top encoded struct data** depending on which command should be executed.

The **execute** endpoint has **validation** in place so it can only be called with valid data and proof that the data was signed by trustworthy validators.
This is done through the **Auth Contract**. The proof is a **ProofData** struct defined in the Auth contract.
All commands that are to be executed have a **commandId**, which is used to validate that the same command is not executed multiple times.

After a command is successfully executed, the **executed_event** is dispatched with the **commandId** as an indexed argument:
```rust
#[event("executed_event")]
fn executed_event(&self, #[indexed] command_id: &ManagedBuffer);
```

Below you will first find detailed the commands supported by the **execute** endpoint.

### Contract calls (approve)
Inward contract calls coming from another chain are not actually executed here, but they are only approved to be executed by a Relayer, which will pay the gas for the contract call.
It is important to note that only specific **supported** contracts can be called cross chain.
The command to approve a contract call is **approveContractCall** and has as parameter the **ApproveContractCallParams** struct with the following fields:
```rust
#[derive(TypeAbi, TopDecode, Debug)]
pub struct ApproveContractCallParams<M: ManagedTypeApi> {
    pub source_chain: ManagedBuffer<M>,
    pub source_address: ManagedBuffer<M>,
    pub contract_address: ManagedAddress<M>,
    pub payload_hash: ManagedBuffer<M>,
    pub source_tx_hash: ManagedBuffer<M>,
    pub source_event_index: BigUint<M>,
}
```
The command marks the contract call as approved by setting a key in storage. The key is a unique keccak256 hash of the command id, source chain, source address, contract address and payload hash.

Then the contract_call_approved_event is dispatched, which has the following information:
```rust
#[event("contract_call_approved_event")]
fn contract_call_approved_event(
    &self,
    #[indexed] command_id: &ManagedBuffer,
    #[indexed] source_chain: ManagedBuffer,
    #[indexed] source_address: ManagedBuffer,
    #[indexed] contract_address: ManagedAddress,
    #[indexed] payload_hash: ManagedBuffer,
    data: ContractCallApprovedData<Self::Api>,
);
```

Where **ContractCallApprovedData** is a struct with the following fields:
```rust
#[derive(TypeAbi, TopEncode)]
pub struct ContractCallApprovedData<M: ManagedTypeApi> {
    pub source_tx_hash: ManagedBuffer<M>,
    pub source_event_index: BigUint<M>,
}
```

This event will then need to be handled by a Relayer who will then do the actual smart contract call.

### Transfer operatorship
The command **transferOperatorship** is related to the Auth Contract, Axelar validators can update the list of validators and weights that need to be checked when validating an execute endpoint transaction.
This is detailed more in the [Auth Contract](../auth), since this command contract calls the Auth Contract.

### Validating contract call
The 3rd party contracts that support cross chain calls need to call back the Axelar gateway contract on the **validateContractCall** endpoint in order to validate that the call happened successfully.
The endpoint has the following arguments:
```rust
#[endpoint(validateContractCall)]
fn validate_contract_call(
    &self,
    command_id: &ManagedBuffer,
    source_chain: &ManagedBuffer,
    source_address: &ManagedBuffer,
    payload_hash: &ManagedBuffer,
) -> bool;
```
The endpoint has **validation** in place so it **can only be called** by the 3rd party contract that has a previously approved call.
This is done by generating the contract call approved key hash by using the address of the caller, which in this case is the actual 3rd party contract address.
If the validation passes, then the endpoint will return **true** and the contract call approved key will be removed from storage so no other Relayer will try to re-do the call.
