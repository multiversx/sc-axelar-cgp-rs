# Token Manager Mint Burn

This is an implementation of a Token Manager which mints and burns.

It is used for tokens which are non-native to MultiversX that should be transferable cross-chain.

It is deployed by the [Interchain Token Service contract](../interchain-token-service) when appropriate.

It has the following endpoints callable by anyone:
- **interchainTransfer** (destination_chain, destination_address, metadata) - initiates a new cross-chain transfer by calling the ITS **transmitSendToken** endpoint 
and burns the received tokens
- **callContractWithInterchainToken** (destination_chain, destination_address, data) - similar to above, but calls a contract with the token on the destination chain

The ITS service can call these endpoints to mint or burn tokens from the Token Manager:
- **giveToken** (destination_address, amount) - mints tokens and sends them to the destination address
- **takeToken** - burns the received tokens

The Token Manager also has functionality regarding flow limit. By default any number of tokens can be sent or received from other chains.
But this can be configured by the operator (the ITS contract or other address for custom token managers) by calling the **setFlowLimit** endpoint.

Whenever a token is minted or burned in the contract through the various endpoints, the flow limit for the last **6 hours** is saved and if it goes
over the set threshold, then the token transfer is blocked.

## Deploy standardized token

This Token Manager has an endpoint **deployStandardizedToken** that is exclusive to it. It is used by the ITS contract to deploy new ESDT tokens
which will have the Token Manager as owner and the Token Manager will get the burn and mint roles for the token.
