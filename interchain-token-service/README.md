# Interchain Token Service (ITS) Contract

The ITS contract provides functionality to register tokens that can be transferred cross-chain through the Axelar network,
deploy token managers, do cross-chain token transfers as well as cross-chain call other ITS contracts from other chains.

The contract is made to be permissionless, to allow anyone to register an existing token for cross-chain transfers or to register
a new token, as well as register a token remotely for another chain. The [Interchain Token Factory](../interchain-token-factory) contract exists
to abstract some functionality regarding deployment of tokens.  

This contract is based on version v2.1.0 of the [Interchain Token Service implementation in Solidity](https://github.com/axelarnetwork/interchain-token-service/blob/v/contracts/InterchainTokenService.sol).

## User callable endpoints
- **registerTokenMetadata** (token_identifier) - registers metadata (decimals) for a token identifier with the ITS Hub
  - should be used in case of custom tokens when wanting to link an existing token on MultiversX with an existing token on another blockchain
- **linkToken** (salt, destination_chain, destination_token_address, token_manager_type, link_params) - links an existing token on MultiversX with an existing token on another chain
  - in practice this is called only be the factory 
  - **link_params** needs to be in the format accepted by the ITS Token Manager of the appropriate chain
  - it also takes EGLD payment to pay for cross-chain gas costs (if applicable)
  - the generated token id depends on the caller and the salt provided
- **interchainTransfer** (token_id, destination_chain, destination_address, metadata, gas_value) - initiates a new cross-chain transfer for the received token
  - it will call the appropriate token manager for the token id that will either burn or lock the tokens on MultiversX
  - it will then call the destination chain ITS contract execute receive token command using a cross chain call through the CGP Gateway contract
  - accepts up to two ESDT tokens, with the 2nd one being used for gas, also supporting EGLD as ESDT to pay for cross chain gas
- **callContractWithInterchainToken** (token_id, destination_chain, destination_address, data, gas_value) - similar to **interchainTransfer**, but it will call a contract with token on the destination chain

## Owner callable endpoints
The owner of the ITS contract can set flow limits for all token manager contracts that have the operator the ITS contract:
- **setFlowLimits** (token_ids, flow_limits) - set flow limits for multiple token ids at a time

The owner can also add or remove other ITS addresses for other chains as trusted:
- **setTrustedAddress** (chain, address)
- **removeTrustedAddress** (source_chain)

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
