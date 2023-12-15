# Token Manager Lock Unlock

This is an implementation of a Token Manager which locks and unlocks tokens, storing them in the contract.

It is used for tokens which are native to MultiversX that should be transferable cross-chain.

It is deployed by the [Interchain Token Service contract](../interchain-token-service) when appropriate.

It has the following endpoints callable by anyone:
- **interchainTransfer** (destination_chain, destination_address, metadata) - initiates a new cross-chain transfer by calling the ITS **transmitSendToken** endpoint 
and locks the received token in the contract
- **callContractWithInterchainToken** (destination_chain, destination_address, data) - similar to above, but calls a contract with the token on the destination chain

The ITS service can call these endpoints to give or take tokens from the Token Manager:
- **giveToken** (destination_address, amount) - unlocks tokens from this Token Manager and sends them to the destination address
- **takeToken** - locks the received tokens into the contract

The Token Manager also has functionality regarding flow limit. By default any number of tokens can be sent or received from other chains.
But this can be configured by the operator (the ITS contract or other address for custom token managers) by calling the **setFlowLimit** endpoint.

Whenever a token is locked or unlocked in the contract through the various endpoints, the flow limit for the last **6 hours** is saved and if it goes
over the set threshold, then the token transfer is blocked.
