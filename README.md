# Axelar Contracts MultiversX

Before diving into these contracts, it is important to have a basic high level understanding of how the Axelar protocol works by first checking the below resources:
- https://docs.axelar.dev/learn
- https://docs.axelar.dev/learn/network/flow

## CGP Contracts

The MultiversX CGP contracts are based on the Axelar CGP (Cross-Chain Gateway Protocol) spec:
- https://github.com/axelarnetwork/cgp-spec

The following contracts were written starting from the referance Solidity implementation:
- [Auth Contract](/auth) - handles validation of messages signed by Axelar Validators using ed25519 signatures
- [Gateway Contract](/gateway) - main CGP which handles inbound execution of cross-chain commands from Axelar Validators and outbound cross-chain transactions
- [Gas Service Contract](/gas-service) - handles cross-chain gas payments

Also take a look at the full [Axelar Cross-Chain Gateway Protocol Specification MultiversX](https://docs.google.com/document/d/1hrMicw1I4tFHHAITNtmuxlyfqTkC--Pq7XmXBCRPAxU/edit?usp=sharing) if interested,
although the README files in this project should contain most of the information from there.
