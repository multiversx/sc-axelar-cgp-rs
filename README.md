# Axelar Contracts MultiversX

Before diving into these contracts, it is important to have a basic high level understanding of how the Axelar protocol works by first checking the below resources:
- https://docs.axelar.dev/learn
- https://docs.axelar.dev/learn/network/flow

## CGP (Cross-chain Gateway Protocol) Contracts

The MultiversX CGP contracts are based on the Axelar CGP (Cross-Chain Gateway Protocol) spec:
- https://github.com/axelarnetwork/cgp-spec

The following contracts were written starting from the referance Solidity implementation:
- [Gateway Contract](/gateway) - main GMP contract which handles inbound execution of cross-chain commands from Axelar Network Validators and outbound cross-chain transactions
- [Gas Service Contract](/gas-service) - handles cross-chain gas payments

Also take a look at the full [Axelar Cross-Chain Gateway Protocol Specification MultiversX](https://docs.google.com/document/d/1hrMicw1I4tFHHAITNtmuxlyfqTkC--Pq7XmXBCRPAxU/edit?usp=sharing) if interested,
although the README files in this project should contain most of the information from there.

## Interchain Governance Contract

The [Governance](/governance) contract enables cross-chain governance proposals on top of the CGP protocol.

This contract will be used instead of a multisig to manage the other contracts, so they can remain upgradable but will be managed only by cross-chain governance proposals.

## Interchain Token Service (ITS) Contracts

ITS is a comprised of a set of contracts which enable token transfers on top of the CGP protocol.

It is based on the Axelar ITS Solidity implementation available at the time of writing: (v1.2.4)
- https://github.com/axelarnetwork/interchain-token-service/blob/v1.2.4/DESIGN.md

It consists of the following contracts:
- [Interchain Token Service](/interchain-token-service) - main contract which handles transferring of tokens, registering & deploying of token managers
- [Interchain Token Factory](/interchain-token-factory) - a wrapper over the Interchain Token Service which allows easier deployment of interchain tokens
- [Token Manager](/token-manager) - Token Manager implementation which either locks/unlocks tokens from the contract or mints/burns them directly

There is also a module used by the Token Manager & Interchain Token Service contracts:
- [Operatable module](/modules/operatable) - holds details regarding the operator (pseudo owner) of a contract as well as roles management

For testing there is also the [Ping Pong Interchain](/ping-pong-interchain) contract, which is an implementation of the Ping Pong contract compatible with ITS.

# Axelar Amplifier

These contracts work together with the [Axelar Amplifier](https://docs.axelar.dev/dev/amplifier/introduction) in order to facilitate
GMP (General Message Passing) calls between MultiversX and other chains.

The Axelar Amplifier require multiple CosmWASM contracts to be deployed on Axelar network:
- **Voting Verifier contract**
- **Gateway contract**
- **Multisig Prover contract**

## Axelar Devnet

- source chain - `multiversx`
- **Voting Verifier contract** - `axelar1sejw0v7gmw3fv56wqr2gy00v3t23l0hwa4p084ft66e8leap9cqq9qlw4t`
- **Gateway contract** - `axelar1gzlxntvtkatgnf3shfcgc8alqqljjtmx75vezqrt97cpw5mpeasqlc0j84`
- **Multisig Prover contract** - `axelar1x3wz8zzretn0dp5qxf0p8qynkpczv6hc2x0r8v2guray3t3573hqflslxd`

### Testing

**Ethereum Sepolia HelloWorld contract:** - `0x8b77c570ba9edf17d2d24a99602f645adaeb3ff8` ([code](https://github.com/axelarnetwork/axelar-examples/blob/main/examples/multiversx/call-contract/contracts/HelloWorld.sol))