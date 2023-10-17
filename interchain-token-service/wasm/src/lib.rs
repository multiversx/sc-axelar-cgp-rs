// Code generated by the multiversx-sc multi-contract system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Endpoints:                           24
// Async Callback:                       1
// Total number of exported functions:  26

#![no_std]
#![allow(internal_features)]
#![feature(lang_items)]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    interchain_token_service
    (
        init => init
        registerCanonicalToken => register_canonical_token
        deployRemoteCanonicalToken => deploy_remote_canonical_token
        deployCustomTokenManager => deploy_custom_token_manager
        deployRemoteCustomTokenManager => deploy_remote_custom_token_manager
        deployAndRegisterStandardizedToken => deploy_and_register_standardized_token
        deployAndRegisterRemoteStandardizedToken => deploy_and_register_remote_standardized_token
        expressReceiveToken => express_receive_token
        interchainTransfer => interchain_transfer
        sendTokenWithData => send_token_with_data
        transmitSendToken => transmit_send_token
        setFlowLimit => set_flow_limit
        execute => execute
        get_canonical_token_id => get_canonical_token_id
        get_custom_token_id => get_custom_token_id
        get_flow_limit => get_flow_limit
        get_flow_out_amount => get_flow_out_amount
        get_flow_in_amount => get_flow_in_amount
        get_token_identifier => get_token_identifier
        get_valid_token_manager_address => get_valid_token_manager_address
        token_manager_address => token_manager_address
        get_implementation => get_implementation
        pause => pause_endpoint
        unpause => unpause_endpoint
        isPaused => paused_status
    )
}

multiversx_sc_wasm_adapter::async_callback! { interchain_token_service }
