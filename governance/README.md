# MultiversX Governance Smart Contract

This contract is used to manage cross-chain governance proposals. It is built on top of the CGP (Cross-chain Gateway Protocol).

It is based on the [Axelar Service Governance Solidity implementation](https://github.com/axelarnetwork/axelar-gmp-sdk-solidity/blob/v6.0.4/contracts/governance/AxelarServiceGovernance.sol) available at the time of writing: (v6.0.4)

For a general design of the contract check this document:
https://github.com/axelarnetwork/axelar-gmp-sdk-solidity/blob/main/contracts/governance/DESIGN.md

You can also check here to see how it broadly works:
https://bright-ambert-2bd.notion.site/Axelar-Gateway-Governance-EXTERNAL-3242da44ef7a4b87a3e0da0b7737ff3f

## Deployment of Governance contract & general information
This contract will be used instead of a multisig to manage the Gateway contract.

- Governance contract will be owner of Gateway contract and itself (similar to multisig)
- upgrading of Gateway will be done through this contract
- it is based on Axelar General Message Passing, Axelar Validators need to first approve an execute call for this contract which comes from a trusted Governance Chain (the Axelar Network chain)
- after a proposal is approved, there is at least a minimum time delay so validators can action and cancel the proposal if something is not right
- after the time delay has passed, anyone can call the executeProposal with the appropriate arguments to actually execute the proposal

## Important endpoints

The most used endpoints are:
- **executeProposal** (target, call_data, native_value) - can be called by anyone (most likely a Relayer) to execute a proposal after it was approved
- **executeOperatorProposal** (target, call_data, native_value) - can be called by an operator (most likely a Multisig contract) to execute operator proposals, which can be executed without timelock
- **execute** (source_chain, message_id, source_address, payload) - can be called only cross-chain from the source chain and source contract configured on deployment

These endpoints look like this:
```rust
#[payable("*")]
#[endpoint(executeProposal)]
fn execute_proposal(
    &self,
    target: ManagedAddress,
    call_data: ManagedBuffer,
    native_value: BigUint,
);
```

```rust
#[payable("*")]
#[endpoint(executeOperatorProposal)]
fn execute_operator_proposal(
    &self,
    target: ManagedAddress,
    call_data: ManagedBuffer,
    native_value: BigUint,
);
```

Where **call_data** is of type **DecodedCallData** as **top encoded bytes**:
```rust
#[derive(TypeAbi, TopDecode)]
pub struct DecodedCallData<M: ManagedTypeApi> {
    pub endpoint_name: ManagedBuffer<M>,
    pub arguments: ManagedVec<M, ManagedBuffer<M>>,
    pub min_gas_limit: u64,
}
```
This contains all the information needed to Async call the **target** contract on MultiversX.

The **execute** endpoint looks like this:
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
Where **payload** is of type **ExecutePayload** as **top encoded bytes**:
```rust
#[derive(TypeAbi, TopDecode)]
pub struct ExecutePayload<M: ManagedTypeApi> {
    pub command: GovernanceCommand,
    pub target: ManagedAddress<M>,
    pub call_data: ManagedBuffer<M>,
    pub native_value: BigUint<M>,
    pub eta: u64,
}
```
And **GovernanceCommand** is an enum currently with 2 types of commands supported:
```rust
#[derive(TypeAbi, TopDecode, NestedDecode)]
pub enum ServiceGovernanceCommand {
    ScheduleTimeLockProposal,
    CancelTimeLockProposal,
    ApproveOperatorProposal,
    CancelOperatorApproval,
}
```
