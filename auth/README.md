# MultiversX Auth Smart Contract

The Auth contract acts like a form of multi sig, making sure that a required number of Axelar network validators approved
a cross-chain command that is about to be executed in a transaction call to the **execute** endpoint of the [Gateway Contract](../gateway).

Internally, the validators are called operators, and they have an associated **weight** to them.
There is also a **threshold** weight set to make sure that commands are valid only if signed by a minimum number of validators for which their combined weights exceed this threshold.

A hash of the operators, their weights and the threshold is then stored in the contract at a specific internal **epoch** (note: this has nothing to do with the MultiversX epoch).
The epoch is just an incrementing id that is modified whenever the set of operators changes.

The contract provides 2 endpoints:
- **validateProof** (message_hash, proof_data) - used to validate that the message that is about to be executed by the Gateway contract above was signed by at least the minimum number of validators depending on their weights and thresholds
- **transferOperatorship** (transfer_data) - can only be called by the contract owner, which will be the Gateway contract (more details below); used to add new operators with their associated weights and threshold whenever the validators on the Axelar network are changed

## Deployment of Auth contract
When the contract is first deployed, multiple sets of recent operators with their associated weights and thresholds need to be sent:
```rust
#[init]
fn init(&self, recent_operators: MultiValueEncoded<TransferData<Self::Api>>) {
    for operator in recent_operators.into_iter() {
        self.transfer_operatorship(operator);
    }
}
```

This **TransferData** struct has the following fields:
```rust
#[derive(TypeAbi, TopDecode, TopEncode, Debug)]
pub struct TransferData<M: ManagedTypeApi> {
    pub new_operators: ManagedVec<M, ManagedAddress<M>>,
    pub new_weights: ManagedVec<M, BigUint<M>>,
    pub new_threshold: BigUint<M>,
}
```

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
) -> bool
```

The **ProofData** struct has the following fields:
```rust
#[derive(TypeAbi, TopDecode, Debug)]
pub struct ProofData<M: ManagedTypeApi> {
    pub operators: ManagedVec<M, ManagedAddress<M>>,
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
