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
    #[indexed] payload_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
    payload: ManagedBuffer,
);
```

## Other blockchain transactions → MultiversX

To facilitate cross-chain communication with MultiversX, there is the `approveMessages` endpoint, which can handle multiple cross-chain messages that were authorized by the Axelar network and then sent to the MultiversX blockchain by a Relayer in one transaction.

The **validateMessage** endpoint needs to be used by supported smart contracts to validate that they have been cross-chain called successfully.
- **approveMessages** (messages, proof)
- **validateMessage** (source_chain, message_id, source_address, payload_hash)
```rust
#[endpoint(approveMessages)]
fn approve_messages(&self, messages: ManagedVec<Message<Self::Api>>, proof: Proof<Self::Api>);
```
The **messages** argument contains the **Message** struct which has the following fields:
```rust
pub struct Message<M: ManagedTypeApi> {
    pub source_chain: ManagedBuffer<M>,
    pub message_id: ManagedBuffer<M>,
    pub source_address: ManagedBuffer<M>,
    pub contract_address: ManagedAddress<M>,
    pub payload_hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
}
```
And the **proof* is of type **Proof** with the following fields:
```rust
pub struct WeightedSigner<M: ManagedTypeApi> {
    pub signer: ManagedByteArray<M, ED25519_KEY_BYTE_LEN>,
    pub weight: BigUint<M>,
}

pub struct WeightedSigners<M: ManagedTypeApi> {
    pub signers: ManagedVec<M, WeightedSigner<M>>,
    pub threshold: BigUint<M>,
    pub nonce: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
}

pub struct Proof<M: ManagedTypeApi> {
    pub signers: WeightedSigners<M>,
    pub signatures: ManagedVec<M, Option<ManagedByteArray<M, ED25519_SIGNATURE_BYTE_LEN>>>,
}
```

Calls need to be approved by the required Axelar Network Validators before this endpoint will be executed by a Relayer.

The signers and signatures are ordered since only a partial subset of the signers can sign a payload. Because of this, the signatures can also have the value None,
indicating that a particular signer has not signed this payload and should be ignored. As long as the total weights of all the signers which signed the payload
is greater than the configured threshold, then the system works as expected.

All messages are guaranteed to have a unique combination of `source_chain` and `message_id`. This is actually used to create an internal `commandId` that is used to keep track
of the state of a message:
```rust
pub enum MessageState<M: ManagedTypeApi> {
    #[default]
    NonExistent,
    Approved(ManagedByteArray<M, KECCAK256_RESULT_LEN>),
    Executed,
}
```

After a message is approved, the appropriate call can then be executed by a Relayer later, which will pay the gas for that contract call.
The `message_approved_event` is dispatched to help with this, which has the following information:
```rust
#[event("message_approved_event")]
fn message_approved_event(
    &self,
    #[indexed] command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    #[indexed] source_chain: ManagedBuffer,
    #[indexed] message_id: ManagedBuffer,
    #[indexed] source_address: ManagedBuffer,
    #[indexed] contract_address: ManagedAddress,
    #[indexed] payload_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
);
```

It is important to note that only specific **supported** contracts can be called cross chain, which implement the following endpoint so they can be called by Relayers.
They will also need to call back the Gateway contract `validateMessage` endpoint to check that the cross chain call was actually properly authorized.
The endpoint to be implemented is called `execute` and should look like this:
```rust
#[endpoint]
fn execute(
    &self,
    source_chain: ManagedBuffer,
    message_id: ManagedBuffer,
    source_address: ManagedBuffer,
    payload: ManagedBuffer,
);
```

### Validating messages
3rd party contracts that support cross chain calls need to call back the Axelar gateway contract on the **validateMessage** endpoint in order to validate that the call happened successfully.
The endpoint has the following arguments:
```rust
#[endpoint(validateMessage)]
fn validate_message(
    &self,
    source_chain: &ManagedBuffer,
    message_id: &ManagedBuffer,
    source_address: &ManagedBuffer,
    payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
) -> bool;
```
The endpoint **can only be called** by the 3rd party contract that has a previously approved call.
This is done by generating the contract call approved key hash by using the address of the caller, which in this case is the actual 3rd party contract address.
If the validation passes, then the endpoint will return **true** and the message will be marked as executed so no other Relayer will try to re-do the call and even if they try the approval of the a message already executed will be ignored.

The **message_executed_event** is also emitted to help Relayers know that this call was successfully executed and it should not be retried:
```rust
#[event("message_executed_event")]
fn message_executed_event(
    &self,
    #[indexed] command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    #[indexed] source_chain: &ManagedBuffer,
    #[indexed] message_id: &ManagedBuffer,
);
```

## Signers rotation
The endpoint **rotateSigners** is used to manage the set of signers that can authorize cross chain message on the Gateway, which can be updated by Axelar validators.

This will add a new set of operators and increment the current epoch.

The endpoint looks like this:
```rust
#[endpoint(rotateSigners)]
fn rotate_signers(&self, new_signers: WeightedSigners<Self::Api>, proof: Proof<Self::Api>);
```

After signers were successfully rotated, an `signers_rotated_event` is emitted, which will need to be handled by Relayers to inform the Axelar Network that the new signers can be used to sign new proofs.
```rust
#[event("signers_rotated_event")]
fn signers_rotated_event(
    &self,
    #[indexed] epoch: BigUint, // This has nothing to do with the blockchain epoch
    #[indexed] signers_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
    signers: WeightedSigners<Self::Api>,
);
```
