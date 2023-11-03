# Remote Address Validator contract

This contract stores trusted chain names with their corresponding ITS (Interchain Token Service) contract.

Is used to verify that an address is the ITS of the other chain, and that the chain is trusted.

It is mostly used by the [Interchain Token Service contract](../interchain-token-service) to verify that a cross-chain call comes from
the correct ITS contract from the other chain.

The owner can add/remove trusted chains with their ITS addresses.

The ITS contract calls the following views:
- **chainName** - gets the current chain name of the chain the ITS is one
- **validateSender** (source_chain, source_address) - validates that the address is of an ITS contract from the supported chain
- **getRemoteAddress** (destination_chain) - get the ITS address of the destination chain
