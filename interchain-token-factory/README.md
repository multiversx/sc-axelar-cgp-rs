# Interchain Token Factory Contract

This is a wrapper over the [Interchain Token Service](../interchain-token-service) contract that allows easier registering and deployment
of canonical tokens, both on MultiversX and cross-chain.

## User callable endpoints
- **deployInterchainToken** (salt, name, symbol, decimals, initial_supply, minter) - deploys a new Token Manager, issues an ESDT and optionally mints the initial supply of tokens to the minter; needs to be called 2 or 3 times
  - 1st time it is called it will deploy a token manager 
  - 2nd time it will issue an ESDT
  - an optional 3rd time should be called if the initial supply is greater than 0
- **deployRemoteInterchainToken** (original_chain_name, salt, minter, destination_chain) - deploys an already registered token and Token Manager on the destination chain
  - the token (referenced by the salt and the sender) needs to have been registered to the MultiversX ITS contract beforehand
  - if the minter is specified, the Token Manager of the token should have the minter the specified address
- **registerCanonicalInterchainToken** (token_identifier) - registers an existing token for cross chain transfers as a canonical token
  - supports native EGLD as well as ESDTs 
  - it will deploy a new LockUnlock Token Manager if it wasn't already deployed
  - the caller does NOT have any permissions for the token or Token Manager
- **deployRemoteCanonicalInterchainToken** (original_chain_name, original_token_identifier, destination_chain) - deploys an already registered token and Token Manager on another chain as a canonical token
  - on the other chain it will create a new token with the same data as the existing token on MultiversX and it will deploy a MintBurn Token Manager
  - it also takes EGLD payment to pay for cross-chain gas costs
  - the caller does NOT have any permissions for the token or Token Manager
