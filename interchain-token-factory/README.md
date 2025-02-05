# Interchain Token Factory Contract

This is a wrapper over the [Interchain Token Service](../interchain-token-service) contract that allows easier registering and deployment
of canonical tokens, both on MultiversX and cross-chain.

This contract is based on version v2.1.0 of the [Interchain Token Factory implementation in Solidity](https://github.com/axelarnetwork/interchain-token-service/blob/v/contracts/InterchainTokenFactory.sol).

## User callable endpoints
- **deployInterchainToken** (salt, name, symbol, decimals, initial_supply, minter) - deploys a new Token Manager, issues an ESDT and optionally mints the initial supply of tokens to the minter; **needs to be called 2 or 3 times**
  - 1st time it is called it will deploy a Mint/Burn Token Manager 
  - 2nd time it will issue ESDT
  - an optional 3rd time should be called if the initial supply is greater than 0
- **approveDeployRemoteInterchainToken** (deployer, salt, destination_chain, destination_minter)
  - can be used by the minter of an existing deployed token to approve a destination minter address
- **revokeDeployRemoteInterchainToken** (deployer, salt, destination_chain)
  - can be used by the minter of an existing deployed token to revoke a destination minter already approved address
- **deployRemoteInterchainToken** (salt, destination_chain) - deploys an already registered token and Token Manager on the destination chain
  - the token (referenced by the salt and the sender) needs to have been registered to the MultiversX ITS contract beforehand (by calling **deployInterchainToken** endpoint)
- **deployRemoteInterchainTokenWithMinter** (salt, minter, destination_chain, destination_minter)
  - similar with **deployRemoteInterchainToken** but a minter must be specified and the Token Manager of the token should have the minter the specified address
  - in case the **destination_minter** is specified, it must have been previously approved by using **approveDeployRemoteInterchainToken**
- **registerCanonicalInterchainToken** (token_identifier) - registers an existing token for cross chain transfers as a canonical token
  - supports native EGLD as well as ESDTs 
  - it will deploy a new Lock/Unlock Token Manager if it wasn't already deployed
  - the caller does NOT have any permissions for the token or Token Manager
- **deployRemoteCanonicalInterchainToken** (original_token_identifier, destination_chain) - deploys an already registered token and Token Manager on another chain as a canonical token
  - on the other chain it will create a new token with the same data as the existing token on MultiversX and it will deploy a Native Interchain Token Manager (which uses Mint/Burn mechanism)
  - it also takes EGLD payment to pay for cross-chain gas costs
  - the caller does NOT have any permissions for the token or Token Manager
- **registerCustomToken** (salt, token_identifier, token_manager_type, operator) - registers an existing token for cross chain transfers as a custom token
  - the token manager type can be specified; if Mint/Burn, it is the job of the caller to give the appropriate roles to the Token Manager
  - an operator can be specified which will be the operator of the Token Manager
- **linkToken** (salt, destination_chain, destination_token_address, token_manager_type, link_params) - used to link an existing token on MultiversX with an existing token on another chain
  - the **link_params** need to be in the format that the destination chain Token Manager understands
  - the linked token on MultiversX should have it's metadata (decimals) registered on the ITS Hub before the first token is linked with it by calling the ITS contract **registerTokenMetadata** endpoint
