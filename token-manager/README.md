# Token Manager

This is an implementation of a Token Manager which locks/unlocks tokens or mints/burns them, depending on the type specified when it was deployed.

The Lock/Unlock type is generally used for tokens which are native to MultiversX that should be transferable cross-chain.
The Mint/Burn type is generally used for tokens which come from other chains (wrapped tokens).

It is deployed by the [Interchain Token Service contract](../interchain-token-service) when appropriate.

It is lousily based on the ITS Solidity implementation of the following 3 contracts:
- https://github.com/axelarnetwork/interchain-token-service/blob/v/contracts/TokenHandler.sol
- https://github.com/axelarnetwork/interchain-token-service/blob/v/contracts/token-manager/TokenManager.sol
- https://github.com/axelarnetwork/interchain-token-service/blob/v/contracts/interchain-token/InterchainToken.sol

Because of architectural differences between MultiversX and EVM, it was simpler to create one contract on MultiversX which has similar functionality
and works together with the ITS contract to facilitate cross-chain token transfers.

## Endpoints
The ITS contract can call these endpoints to give or take tokens from the Token Manager:
- **giveToken** (destination_address, amount) - unlocks or mints tokens and sends them to the destination address
- **takeToken** - locks or burns the received tokens

### Flow Limit
The Token Manager also has functionality regarding flow limit. By default any number of tokens can be sent or received from other chains.
But this can be configured by the operator (the ITS contract or other address for custom token managers) by calling the **setFlowLimit** endpoint.

Other accounts that can manage the flow limit can be added or removed using the **addFlowLimiter** or **removeFlowLimiter** endpoints

Whenever a token is "given" or "taken" using the ITS contract, the flow limit for the last **6 hours** is saved and if it goes
over the set threshold, then the token transfer is blocked.

### Native Interchain Token Manager

If the token manager is of type Native Interchain, an ESDT can be issued directly by the Token Manager contract using the **deployInterchainToken** which is callable by the ITS contract or the minter.

The registered Minter can also use the endpoint **mint** and **burn** to manage the supply of tokens if this functionality is enabled.

The Minter role can be transferred to another address using the **transferMintership** or the **proposeMintership** and **acceptMintership** endpoints.
