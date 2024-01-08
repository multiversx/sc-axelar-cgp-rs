# Interchain Token Service (ITS) Contract

The ITS contract provides functionality to register tokens that can be transferred cross-chain through the Axelar network,
deploy token managers, do cross-chain token transfers as well as cross-chain call other ITS contracts from other chains.

The contract is made to be permissionless, to allow anyone to register an existing token for cross-chain transfers or to register
a new token, as well as register a token remotely for another chain. The [Interchain Token Factory](../interchain-token-factory) contract exists
to abstract some functionality regarding deployment of tokens.  

## User callable endpoints
- **deployTokenManager** (salt, destination_chain, token_manager_type, params) - deploys a custom token manager on MultiversX or another chain
  - **params** needs to be in the format accepted by the ITS Token Manager of the appropriate chain
  - it also takes EGLD payment to pay for cross-chain gas costs (if applicable)
  - the generated token id depends on the caller and the salt provided
- **deployInterchainToken** (salt, destination_chain, name, symbol, decimals, minter) - deploys a new token and a Mint Burn Token Manager on MultiversX or another chain
  - the generated token id depends on the caller and the salt provided
  - it also takes EGLD payment to pay for cross-chain gas costs (if applicable) OR pay for ESDT issue
  - if deploying on MultiversX, it needs to be called twice, first time it will deploy the Token Manager and the second time it will issue the ESDT through the Token Manager
- **expressExecute** (command_id, source_chain, source_address, payload) - can be called by anyone to complete a cross-chain call faster, if they provide the required tokens
  - the caller will get back his tokens after the cross-chain call is fully executed by the Axelar Validators and Relayer services
- **interchainTransfer** (token_id, destination_chain, destination_address, metadata, gas_value) - initiates a new cross-chain transfer for the received token
  - it will call the appropriate token manager for the token id that will either burn or lock the tokens on MultiversX
  - it will then call the destination chain ITS contract execute receive token command using a cross chain call through the CGP Gateway contract
- **callContractWithInterchainToken** (token_id, destination_chain, destination_address, data, gas_value) - similar to **interchainTransfer**, but it will call a contract with token on the destination chain

## Owner callable endpoints
The owner of the ITS contract can set flow limits for all token manager contracts that have the operator the ITS contract:
- **setFlowLimits** (token_ids, flow_limits) - set flow limits for multiple token ids at a time

The owner can also add or remove other ITS address for other chains as trusted:
- **setTrustedAddress** (chain, address)
- **removeTrustedAddress** (source_chain)

## Execute endpoint

The **execute** endpoint will be cross-chain called by other ITS contracts from other chain:
- **execute** (command_id, source_chain, source_address, payload)

The source address needs to correspond to the ITS contract of the source chain.
There is an internal mapping stored of ITS addresses from other supported chains. 

The Gateway contract is called to validate that this cross-chain contract call was authorized by Axelar validators and then execute one of 3 commands:
- **MESSAGE_TYPE_INTERCHAIN_TRANSFER (0)** - received an already registered token from another chain
  - it will get the appropriate Token Manager for the respective id and give the token to the appropriate address
  - the Token Manager will either unlock already locked tokens or mint new tokens
  - if the call was already express executed by someone that called the **expressExecute** endpoint for this cross-chain command,
    then this will give the token back to the express caller
  - it can also async call a contract with the token if the payload includes any data
    - it will give the token to the ITS contract first, then it will call the contract with the token
- **MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN (1)** - it will deploy a Mint Burn Token Manager and then issue a new ESDT token
  - it also takes EGLD payment to pay for ESDT issue cost
  - needs to be called twice, first time it will deploy the Token Manager and NOT mark the Gateway cross-chain call as executed
  - the second time it will issue the ESDT token through the Token Manager and mark the Gateway cross-chain call as executed
- **MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER (2)** - it will deploy a custom Token Manager with the specified parameters
