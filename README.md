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

## ITS (Interchain Token Service) Contracts

ITS is a comprised of a set of contracts which enable token transfers on top of the CGP protocol.

It is based on the Axelar ITS Solidity implementation available at the time of writing: (final specs TBD)
- https://github.com/axelarnetwork/interchain-token-service/tree/main

It consists of the following contracts:
- [Interchain Token Service](/interchain-token-service) - main contract which handles transfering of tokens, registering & deploying of token managers
- [Remote Address Validator](/remote-address-validator) - holds & validates addresses of other ITS contracts from other chains
- [Token Manager](/token-manager) - Token Manager implementation which either stores tokens in the contract or mints/burns them

There are also 3 modules used by the Token Manager contracts:
- [Flow Limit module](/modules/flow-limit) - used to manage in/out flow limit of tokens
- [Operatable module](/modules/operatable) - holds details regarding the operator (pseudo owner) of a contract
- [Token Manager module](/modules/token-manager) - base module implemented by Token Managers
