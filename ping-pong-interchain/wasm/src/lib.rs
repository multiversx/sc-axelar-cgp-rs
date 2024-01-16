// Code generated by the multiversx-sc build system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Endpoints:                           13
// Async Callback (empty):               1
// Total number of exported functions:  15

#![no_std]
#![allow(internal_features)]
#![feature(lang_items)]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    ping_ping_interchain
    (
        init => init
        executeWithInterchainToken => execute_with_interchain_token
        expressExecuteWithInterchainToken => express_execute_with_interchain_token
        ping => ping
        pong => pong
        pongAll => pong_all
        getUserAddresses => get_user_addresses
        getInterchainTokenService => interchain_token_service
        getPingAmount => ping_amount
        getDeadline => deadline
        getActivationTimestamp => activation_timestamp
        getMaxFunds => max_funds
        getUserStatus => user_status
        pongAllLastUser => pong_all_last_user
    )
}

multiversx_sc_wasm_adapter::async_callback_empty! {}