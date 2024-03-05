# Token Manager Lock Unlock

This is an implementation of a Token Manager which locks/unlocks tokens or mints/burns them, depending on the type specified when it was deployed.

The Lock/Unlock type is generally used for tokens which are native to MultiversX that should be transferable cross-chain.
The Mint/Burn type is generally used for tokens which come from other chains (wrapped tokens).

It is deployed by the [Interchain Token Service contract](../interchain-token-service) when appropriate.

The ITS contract can call these endpoints to give or take tokens from the Token Manager:
- **giveToken** (destination_address, amount) - unlocks or mints tokens and sends them to the destination address
- **takeToken** - locks or burns the received tokens

The Token Manager also has functionality regarding flow limit. By default any number of tokens can be sent or received from other chains.
But this can be configured by the operator (the ITS contract or other address for custom token managers) by calling the **setFlowLimit** endpoint.

Whenever a token is "given" or "taken" using the ITS contract, the flow limit for the last **6 hours** is saved and if it goes
over the set threshold, then the token transfer is blocked.

If the token manager is of type Mint/Burn, an ESDT can be issued directly by the Token Manager contract using the **deployInterchainToken** which is callable by the ITS contract or the minter.
