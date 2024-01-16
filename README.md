# Axelar Contracts MultiversX

Before diving into these contracts, it is important to have a basic high level understanding of how the Axelar protocol works by first checking the below resources:
- https://docs.axelar.dev/learn
- https://docs.axelar.dev/learn/network/flow

## CGP (Cross-chain Gateway Protocol) Contracts

The MultiversX CGP contracts are based on the Axelar CGP (Cross-Chain Gateway Protocol) spec:
- https://github.com/axelarnetwork/cgp-spec

The following contracts were written starting from the referance Solidity implementation:
- [Auth Contract](/auth) - handles validation of messages signed by Axelar Validators using ed25519 signatures
- [Gateway Contract](/gateway) - main CGP which handles inbound execution of cross-chain commands from Axelar Validators and outbound cross-chain transactions
- [Gas Service Contract](/gas-service) - handles cross-chain gas payments

Also take a look at the full [Axelar Cross-Chain Gateway Protocol Specification MultiversX](https://docs.google.com/document/d/1hrMicw1I4tFHHAITNtmuxlyfqTkC--Pq7XmXBCRPAxU/edit?usp=sharing) if interested,
although the README files in this project should contain most of the information from there.

## Interchain Token Service (ITS) Contracts

ITS is a comprised of a set of contracts which enable token transfers on top of the CGP protocol.

It is based on the Axelar ITS Solidity implementation available at the time of writing: (v1.2.1)
- https://github.com/axelarnetwork/interchain-token-service/tree/v1.2.1

It consists of the following contracts:
- [Interchain Token Service](/interchain-token-service) - main contract which handles transferring of tokens, registering & deploying of token managers
- [Interchain Token Factory](/interchain-token-factory) - a wrapper over the Interchain Token Service which allows easier deployment of tokens
- [Token Manager](/token-manager) - Token Manager implementation which either stores tokens in the contract or mints/burns them

There is also a module used by the Token Manager & Interchain Token Service contracts:
- [Operatable module](/modules/operatable) - holds details regarding the operator (pseudo owner) of a contract as well as roles management

For testing there is also the [Ping Pong Interchain](/ping-pong-interchain) contract, which is an implementation of the Ping Pong contract compatible with ITS.
