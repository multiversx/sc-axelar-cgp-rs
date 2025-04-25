# Interchain Token Service (ITS) Contract

The ITS contract provides functionality to register tokens that can be transferred cross-chain through the Axelar network,
deploy token managers, do cross-chain token transfers as well as cross-chain call other ITS contracts from other chains.

The contract is made to be permissionless, to allow anyone to register an existing token for cross-chain transfers or to register
a new token, as well as register a token remotely for another chain.

This contract is based on version v2.1.0 of the [Interchain Token Service implementation in Solidity](https://github.com/axelarnetwork/interchain-token-service/blob/v/contracts/InterchainTokenService.sol).
It also includes merges the **Interchain Token Factory** contract from Solidity into this same contract for easier management. 

Keep in mind that when executing cross-chain transfers through the MultiversX Axelar ITS contract from another chain, only contracts **on the same Shard** as the Axelar ITS contract are supported.
See the [Interchain Token Service Proxy](../interchain-token-service-proxy) for more details.

## User callable endpoints
- **registerTokenMetadata** (token_identifier) - registers metadata (decimals) for a token identifier with the ITS Hub
  - should be used in case of custom tokens when wanting to link an existing token on MultiversX with an existing token on another blockchain
- **interchainTransfer** (token_id, destination_chain, destination_address, metadata, gas_value) - initiates a new cross-chain transfer for the received token
  - it will call the appropriate token manager for the token id that will either burn or lock the tokens on MultiversX
  - it will then call the destination chain ITS contract execute receive token command using a cross chain call through the CGP Gateway contract
  - accepts up to two ESDT tokens, with the 2nd one being used for gas, also supporting EGLD as ESDT to pay for cross chain gas
- **callContractWithInterchainToken** (token_id, destination_chain, destination_address, data, gas_value) - similar to **interchainTransfer**, but it will call a contract with token on the destination chain
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
 
## Owner callable endpoints
The owner of the ITS contract can set flow limits for all token manager contracts that have the operator the ITS contract:
- **setFlowLimits** (token_ids, flow_limits) - set flow limits for multiple token ids at a time

The owner can also add or remove other ITS chains as trusted:
- **setTrustedChain** (chain)
- **removeTrustedChain** (chain)

## Execute endpoint

The **execute** endpoint will be cross-chain called by other ITS contracts from other chains:
- **execute** (source_chain, message_id, source_address, payload)

The source address needs to correspond to the ITS contract of the source chain, which will be checked against an internal stored mapping of ITS addresses from other supported chains. 

The Gateway contract is called to validate that this cross-chain contract call was authorized by Axelar Validators and then execute one of 5 commands:
- **MESSAGE_TYPE_INTERCHAIN_TRANSFER (0)** - received an already registered token from another chain
  - it will get the appropriate Token Manager for the respective id and give the token to the appropriate address
  - the Token Manager will either unlock already locked tokens or mint new tokens
  - if the call was already express executed by someone that called the **expressExecute** endpoint for this cross-chain command,
    then this will give the token back to the express caller
  - it can also async call a contract with the token if the payload includes any data
    - it will give the token to the ITS contract first, then it will call the contract with the token
- **MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN (1)** - it will deploy a Mint Burn Token Manager and then issue a new ESDT token
  - it also takes EGLD payment to pay for ESDT issue cost
  - **needs to be called twice**, first time it will deploy the Token Manager and NOT mark the Gateway cross-chain call as executed
  - the second time it will issue the ESDT through the Token Manager and mark the Gateway cross-chain call as executed
- **MESSAGE_TYPE_SEND_TO_HUB (3)** - this message is used to route an ITS message via the ITS Hub. The ITS Hub applies certain security checks, and then routes it to the true destination chain.
- **MESSAGE_TYPE_RECEIVE_FROM_HUB (4)** - this message is used to receive an ITS message from the ITS Hub. The ITS Hub applies certain security checks, and then routes it to the ITS contract.
- **MESSAGE_TYPE_LINK_TOKEN (5)** - used to link an existing token with an existing one on another blockchain
- **MESSAGE_TYPE_REGISTER_TOKEN_METADATA (6)** - register metadata (decimals) for a ESDT on MultiversX with the ITS Hub
