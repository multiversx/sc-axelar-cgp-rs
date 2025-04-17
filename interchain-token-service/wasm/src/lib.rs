// Code generated by the multiversx-sc build system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Upgrade:                              1
// Endpoints:                           46
// Async Callback:                       1
// Total number of exported functions:  49

#![no_std]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    interchain_token_service
    (
        init => init
        upgrade => upgrade
        setFlowLimits => set_flow_limits
        execute => execute
        registerTokenMetadata => register_token_metadata
        interchainTransfer => interchain_transfer
        transferOperatorship => transfer_operatorship
        proposeOperatorship => propose_operatorship
        acceptOperatorship => accept_operatorship
        isOperator => is_operator
        getAccountRoles => account_roles
        getProposedRoles => proposed_roles
        setTrustedChain => set_trusted_chain
        removeTrustedChain => remove_trusted_chain
        chainName => chain_name
        trustedChains => trusted_chains
        itsHubAddress => its_hub_address
        gateway => gateway
        gasService => gas_service
        flowLimit => flow_limit
        flowOutAmount => flow_out_amount
        flowInAmount => flow_in_amount
        deployedTokenManager => deployed_token_manager
        registeredTokenIdentifier => registered_token_identifier
        invalidTokenManagerAddress => get_opt_token_manager_address
        tokenManagerAddress => token_manager_address
        tokenManagerImplementation => token_manager
        deployInterchainToken => deploy_interchain_token
        approveDeployRemoteInterchainToken => approve_deploy_remote_interchain_token
        revokeDeployRemoteInterchainToken => revoke_deploy_remote_interchain_token
        deployRemoteInterchainToken => deploy_remote_interchain_token
        deployRemoteInterchainTokenWithMinter => deploy_remote_interchain_token_with_minter
        registerCanonicalInterchainToken => register_canonical_interchain_token
        deployRemoteCanonicalInterchainToken => deploy_remote_canonical_interchain_token
        registerCustomToken => register_custom_token
        linkToken => link_token
        interchainTokenDeploySalt => interchain_token_deploy_salt
        canonicalInterchainTokenDeploySalt => canonical_interchain_token_deploy_salt
        linkedTokenDeploySalt => linked_token_deploy_salt
        interchainTokenId => interchain_token_id
        canonicalInterchainTokenId => canonical_interchain_token_id
        linkedTokenId => linked_token_id
        chainNameHash => chain_name_hash
        approvedDestinationMinters => approved_destination_minters
        interchainTokenStatus => interchain_token_status
        pause => pause_endpoint
        unpause => unpause_endpoint
        isPaused => paused_status
    )
}

multiversx_sc_wasm_adapter::async_callback! { interchain_token_service }
