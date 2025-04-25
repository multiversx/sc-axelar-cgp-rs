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
- [Token Manager](/token-manager) - Token Manager implementation which either locks/unlocks tokens from the contract or mints/burns them directly

There is also a module used by the Token Manager & Interchain Token Service contracts:
- [Operatable module](/modules/operatable) - holds details regarding the operator (pseudo owner) of a contract as well as roles management

For testing there is also the [Ping Pong Interchain](/ping-pong-interchain) contract, which is an implementation of the Ping Pong contract compatible with ITS.

Aditionally, the Axelar ITS contract only allows calling contracts from the same shard!
To aid with this, there is also a provided ITS [Proxy Contract](/interchain-token-service-proxy) contract, which is a reference implementation of a contract which needs to reside
on the same Shard as the Axelar ITS contract, and will forward the call to a contract on a different Shard.

# Axelar Amplifier

These contracts work together with the [Axelar Amplifier](https://docs.axelar.dev/dev/amplifier/introduction) in order to facilitate
GMP (General Message Passing) calls between MultiversX and other chains.

The Axelar Amplifier require multiple CosmWASM contracts to be deployed on Axelar network:
- **Voting Verifier contract**
- **Gateway contract**
- **Multisig Prover contract**

### Testing

**Avalanche Fuji HelloWorld contract:** - `0xC993dBcdC94E2115C7C1526D2Dec78B384Bb826D` ([code](https://github.com/axelarnetwork/axelar-examples/blob/main/examples/multiversx/call-contract/contracts/HelloWorld.sol))

`npm run interact:devnet helloWorldSetRemoteValue avalanche-fuji 0xC993dBcdC94E2115C7C1526D2Dec78B384Bb826D "Hello world!"`
`npm run interact:devnet helloWorldReceivedValue`
