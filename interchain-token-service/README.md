# Interchain Token Service (ITS) Contract

The ITS contract provides functionality to register tokens that can be transferred cross-chain through the Axelar network,
deploy token managers, do cross-chain token transfers as well as cross-chain call other ITS contracts from other chains.

The contract is made to be permissionless, to allow anyone to register an existing token for cross-chain transfers or to register
a new token, as well as register a token remotely for another chain.

## User callable endpoints
- **registerCanonicalToken** (token_identifier) - registers an existing token for cross chain transfers
  - it will deploy a new LockUnlock Token Manager if it wasn't already deployed
  - the caller does NOT have any permissions for the token or Token Manager
- **deployRemoteCanonicalToken** (token_id, destination_chain) - deploys an already registered token on another chain
  - on the other chain it will create a new token with the same data as the existing token on MultiversX and it will deploy a MintBurn Token Manager
  - it also takes EGLD payment to pay for cross-chain gas costs
  - the caller does NOT have any permissions for the token or Token Manager
- **deployCustomTokenManager** (token_identifier, token_manager_type, operator) - deploys a custom token manager for an existing token
  - the type and operator of the Token Manager can be specified
  - it will generate a different token id depending on the caller
- **deployRemoteCustomTokenManager** (token_identifier, destination_chain, token_manager_type, params) - deploys a custom token manager on another chain
  - **params** needs to be in the format accepted by the ITS Token Manager of the other chain
  - it also takes EGLD payment to pay for cross-chain gas costs
  - it will use the token id generated depending on the caller
- **deployAndRegisterStandardizedToken** (salt, name, symbol, decimals, mint_amount, minter) - deploys a new ESDT token and a Mint Burn Token Manager
  - the generated token id depends on the caller and the salt provided
  - it also takes EGLD payment to pay for ESDT issue cost
  - needs to be called twice, first time it will deploy the Token Manager and the second time the ESDT token through the Token Manager
- **deployAndRegisterRemoteStandardizedToken** (salt, name, symbol, decimals, minters, mint_to, mint_amount, operator, destination_chain) - deploys a new token and Mint Burn Token Manager on the specified chain
  - the generated token id depends on the caller and the salt provided
  - it also takes EGLD payment to pay for cross-chain gas costs
- **expressReceiveToken** (payload, command_id, source_chain) - can be called by anyone to complete a cross-chain call faster, if they provide the required tokens
  - the caller will get back his tokens after the cross-chain call is executed by the Axelar Validators and Relayer services
- **interchainTransfer** (token_id, destination_chain, destination_address, metadata) - initiates a new cross-chain transfer for the received token
  - it will call the appropriate token manager for the token id that will either burn or lock the tokens on MultiversX
  - it will then call the destination chain ITS contract execute receive token command using a cross chain call through the CGP Gateway contract
- **sendTokenWithData** (token_id, destination_chain, destination_address, data) - similar to **interchainTransfer**, but it will call a contract with token on the destination chain

## Token Manager callable endpoints
The token managers deployed by the ITS contract can call the following function:
- **transmitSendToken** (token_id, source_address, destination_chain, destination_address, amount, metadata) - is callable only by the appropriate Token Manager for the token id provided
  - it will only transmit a cross chain send token call through the CGP Gateway contract, since the Token Manager already locked or burned the tokens to be sent cross-chain

## Owner callable endpoints
The owner of the ITS contract can set flow limits for all token manager contracts that weren't deployed using the **deployCustomTokenManager** endpoint (have the operator the ITS contract):
- **setFlowLimit** (token_ids, flow_limits) - set flow limits for multiple token ids at a time

## Execute endpoint

The **execute** endpoint will be cross-chain called by other ITS contracts from other chain:
- **execute** (command_id, source_chain, source_address, payload)

The source address needs to correspond to the ITS contract of the source chain. This is verified by calling the [Remote Address Validator contract](../remote-address-validator).

The Gateway contract is called to validate that this cross-chain contract call was authorized by Axelar validators and then execute one of 4 commands:
- **SELECTOR_RECEIVE_TOKEN (1)** - received an already registered token from another chain
  - it will get the appropriate Token Manager for the respective id and give the token to the appropriate address
  - the Token Manager will either unlock already locked tokens or mint new tokens
- **SELECTOR_RECEIVE_TOKEN_WITH_DATA** - similar to above, but will also call a contract with the token
  - it will give the token to the ITS contract first, then it will call the contract with the token 
  - if the call was already express executed by someone that called the **expressReceiveToken** endpoint for this cross-chain command,
  then these 2 commands will give the token to the express caller
- **SELECTOR_DEPLOY_TOKEN_MANAGER** - it will deploy a custom Token Manager with the specified parameters
- **SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN** - it will deploy a Mint Burn Token Manager and then issue a new ESDT token
  - it also takes EGLD payment to pay for ESDT issue cost
  - needs to be called twice, first time it will deploy the Token Manager and NOT mark the Gateway cross-chain call as executed
  - the second time it will issue the ESDT token through the Token Manager and mark the Gateway cross-chain call as executed
