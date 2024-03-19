// Code generated by the multiversx-sc build system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Endpoints:                           11
// Async Callback:                       1
// Total number of exported functions:  13

#![no_std]
#![allow(internal_features)]
#![feature(lang_items)]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    interchain_token_factory
    (
        init => init
        upgrade => upgrade
        deployInterchainToken => deploy_interchain_token
        deployRemoteInterchainToken => deploy_remote_interchain_token
        registerCanonicalInterchainToken => register_canonical_interchain_token
        deployRemoteCanonicalInterchainToken => deploy_remote_canonical_interchain_token
        interchainTokenSalt => interchain_token_salt
        canonicalInterchainTokenSalt => canonical_interchain_token_salt
        interchainTokenId => interchain_token_id
        canonicalInterchainTokenId => canonical_interchain_token_id
        chainNameHash => chain_name_hash
        interchain_token_service => interchain_token_service
    )
}

multiversx_sc_wasm_adapter::async_callback! { interchain_token_factory }
