// Code generated by the multiversx-sc build system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Upgrade:                              1
// Endpoints:                           18
// Async Callback:                       1
// Total number of exported functions:  21

#![no_std]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    interchain_token_factory
    (
        init => init
        upgrade => upgrade
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
        interchain_token_service => interchain_token_service
    )
}

multiversx_sc_wasm_adapter::async_callback! { interchain_token_factory }
