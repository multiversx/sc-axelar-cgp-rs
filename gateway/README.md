# MultiversX Gateway Smart Contract

This contract provides endpoints for outward cross-chain transactions from MultiversX to other blockchains,
as well as from inward cross-chain transactions, facilitated through the Axelar network and the Relayer services.

It is based on the reference [CGP Axelar Gateway implementation in Solidity](https://github.com/axelarnetwork/axelar-cgp-solidity/blob/main/contracts/AxelarGateway.sol)

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
(note: for EVM this means that the string should be in HEX format with `0x` prefix)

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

To facilitate cross-chain communication with MultiversX, there is one main endpoint called **execute**, which can handle multiple commands that were authorized by the Axelar network and then sent to the MultiversX blockchain by a Relayer in one transaction.

The **validateContractCall** endpoint needs to be used by supported smart contracts to validate that they have been cross-chain called successfully.
- **execute** (data, proof)
- **validateContractCall** (command_id, source_chain, source_address, payload_hash)
```rust
#[endpoint(execute)]
fn execute(&self, input: ExecuteInput<Self::Api>);
```
The **input** argument contains the **ExecuteInput** struct as **top encoded bytes**. The struct has the following fields:
```rust
#[derive(TypeAbi, TopDecode, Debug)]
pub struct ExecuteInput<M: ManagedTypeApi> {
    pub data: ManagedBuffer<M>,
    pub proof: ManagedBuffer<M>,
}
```
The **data** is the **ExecuteData** struct as **top encoded bytes**:
```rust
#[derive(TypeAbi, TopDecode, Debug)]
pub struct ExecuteData<M: ManagedTypeApi> {
    pub command_ids: ManagedVec<M, ManagedBuffer<M>>,
    pub commands: ManagedVec<M, ManagedBuffer<M>>,
    pub params: ManagedVec<M, ManagedBuffer<M>>,
}
```
And the **proof* is of type **ProofData** from the [Auth Contract](../auth).

The **execute** endpoint uses the **Auth Contract** to validate that a the call was approved by the required Axelar Network Validators.

All commands that are to be executed have a **commandId**, which is used to validate that the same command is not executed multiple times.

After a command is successfully executed, the **executed_event** is dispatched with the **commandId** as an indexed argument:
```rust
#[event("executed_event")]
fn executed_event(&self, #[indexed] command_id: &ManagedBuffer);
```

Below you will first find detailed the commands supported by the **execute** endpoint.

### Contract calls (approve)
Inward contract calls coming from another chain are not actually executed here, but they are only approved to be executed by a Relayer later, which will pay the gas for the contract call.
It is important to note that only specific **supported** contracts can be called cross chain.

The command to approve a contract call is **approveContractCall** and has as parameter the **ApproveContractCallParams** struct with the following fields:
```rust
#[derive(TypeAbi, TopDecode, Debug)]
pub struct ApproveContractCallParams<M: ManagedTypeApi> {
    pub source_chain: ManagedBuffer<M>,
    pub source_address: ManagedBuffer<M>,
    pub contract_address: ManagedAddress<M>,
    pub payload_hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
}
```
The command marks the contract call as approved by setting a key in storage. The key is a unique keccak256 hash of the command id, source chain, source address, contract address and payload hash.

Then the contract_call_approved_event is dispatched, which has the following information:
```rust
    #[event("contract_call_approved_event")]
fn contract_call_approved_event(
    &self,
    #[indexed] command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    #[indexed] source_chain: ManagedBuffer,
    #[indexed] source_address: ManagedBuffer,
    #[indexed] contract_address: ManagedAddress,
    #[indexed] payload_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
);
```

This event will then need to be handled by a Relayer who will then do the actual smart contract call.

### Transfer operatorship
The command **transferOperatorship** is used to manage the set of operators from the Auth Contract. It actually calls the Auth Contract **transferOperatorship** endpoint.
Axelar validators can update the list of validators and weights that need to be checked when validating an execute endpoint transaction.
This is detailed more in the [Auth Contract](../auth).

### Validating contract call
3rd party contracts that support cross chain calls need to call back the Axelar gateway contract on the **validateContractCall** endpoint in order to validate that the call happened successfully.
The endpoint has the following arguments:
```rust
#[endpoint(validateContractCall)]
fn validate_contract_call(
    &self,
    command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    source_chain: &ManagedBuffer,
    source_address: &ManagedBuffer,
    payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
) -> bool;
```
The endpoint **can only be called** by the 3rd party contract that has a previously approved call.
This is done by generating the contract call approved key hash by using the address of the caller, which in this case is the actual 3rd party contract address.
If the validation passes, then the endpoint will return **true** and the contract call approved key will be removed from storage so no other Relayer will try to re-do the call.

The **contract_call_executed_event** is also emitted to help Relayers know that this call was successfully executed and it should not be retried:
```rust
#[event("contract_call_executed_event")]
fn contract_call_executed_event(&self, #[indexed] command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>);
```
