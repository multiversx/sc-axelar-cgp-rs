# MultiversX Gateway Smart Contract

This contract provides endpoints for outward cross-chain transactions from MultiversX to other blockchains,
as well as from inward cross-chain transactions, facilitated through the Axelar network and the Relayer services.

It is based on the v5.9.0 reference [Axelar Amplifier Gateway implementation in Solidity](https://github.com/axelarnetwork/axelar-gmp-sdk-solidity/blob/v5.9.0/contracts/gateway/INTEGRATION.md)

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



# MultiversX Auth Smart Contract (TBD)

The Auth contract acts like a form of multi sig, making sure that a required number of Axelar Network Validators approved
a cross-chain command that is about to be executed in a transaction call to the **execute** endpoint of the [Gateway Contract](../gateway).

It is based on the reference [CGP Axelar Auth implementation in Solidity](https://github.com/axelarnetwork/axelar-cgp-solidity/blob/main/contracts/auth/AxelarAuthWeighted.sol)

Internally, the validators are called operators, and they have an associated **weight** to them.
There is also a **threshold** weight set to make sure that commands are valid only if signed by a minimum number of validators for which their combined weights exceed this threshold.

A hash of the operators, their weights and the threshold is then stored in the contract at a specific internal **epoch** (note: this has **nothing** to do with the MultiversX epoch).
The epoch is just an incrementing id that is modified whenever the set of operators changes.

The contract provides 2 endpoints:
- **validateProof** (message_hash, proof_data) - used to validate that the message that is about to be executed by the Gateway contract above was signed by at least the minimum number of validators depending on their weights and the configured threshold
- **transferOperatorship** (transfer_data) - can only be called by the contract owner, which will be the Gateway contract (more details below); used to add new operators with their associated weights and threshold whenever the validators on the Axelar Network are changed

## Deployment of Auth contract
When the contract is first deployed, multiple sets of recent operators with their associated weights and thresholds need to be sent:
```rust
#[init]
fn init(&self, recent_operators: MultiValueEncoded<TransferData<Self::Api>>);
```

This **TransferData** struct has the following fields:
```rust
#[derive(TypeAbi, TopDecode, TopEncode, Debug)]
pub struct TransferData<M: ManagedTypeApi> {
    pub new_operators: ManagedVec<M, Operator<M>>,
    pub new_weights: ManagedVec<M, BigUint<M>>,
    pub new_threshold: BigUint<M>,
}
```
Where **Operator** is an ed25519 public key: `pub type Operator<M> = ManagedByteArray<M, ED25519_KEY_BYTE_LEN>;`

The operators hash will then be computed and set in storage for the current epoch (starts at 1), which will then be incremented.

In order for the Auth contract to be fully decentralized, its owner will need to be changed to the Gateway contract.
This is because only the owner of the contract can call the **transferOperatorship** endpoint which can be executed if the **transferOperatorship** command is passed to the execute endpoint of the Gateway contract.

## Validate proof
The **validateProof** endpoint is publicly accessible and is used to verify that a message was signed by valid Axelar network validators.
```rust
#[endpoint(validateProof)]
fn validate_proof(
    &self,
    message_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
    proof_data: ProofData<Self::Api>,
) -> bool;
```

The **ProofData** struct has the following fields:
```rust
#[derive(TypeAbi, TopDecode, Debug)]
pub struct ProofData<M: ManagedTypeApi> {
    pub operators: ManagedVec<M, Operator<M>>,
    pub weights: ManagedVec<M, BigUint<M>>,
    pub threshold: BigUint<M>,
    pub signatures: ManagedVec<M, ManagedByteArray<M, ED25519_SIGNATURE_BYTE_LEN>>,
}
```

This is the same proof that is passed as the last argument of the **execute** endpoint of the Gateway contract.

The endpoint validates that an epoch exists for the operators hash computed as a keccak256 hash from the operators, weights and threshold. The last 16 epochs from the current epoch are accepted as valid.

The signatures are then verified, and if the combined weight of the operators which signed the message is greater than the threshold, then the call is considered valid.

The endpoint also returns a **bool**, which is true if the epoch found for the proof is the current epoch. This is used in the **execute** endpoint of the Gateway contract to allow a call to the **transferOperatorship** endpoint, since only the latest set of operators can actually update the operators, their weights and threshold.

## Transfer operatorship
The **transferOperatorship** endpoint can only be called by the owner of the Auth contract, which should be the Gateway contract.

This will add a new set of operators and increment the current epoch. It is the same operation that is also called when deploying the Auth contract and has the same **TransferData** struct as a parameter.
