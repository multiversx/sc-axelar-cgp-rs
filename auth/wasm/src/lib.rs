// Code generated by the multiversx-sc build system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Endpoints:                            6
// Async Callback (empty):               1
// Total number of exported functions:   8

#![no_std]
#![allow(internal_features)]
#![feature(lang_items)]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    auth
    (
        init => init
        upgrade => upgrade
        validateProof => validate_proof
        transferOperatorship => transfer_operatorship
        epoch_for_hash => epoch_for_hash
        hash_for_epoch => hash_for_epoch
        current_epoch => current_epoch
    )
}

multiversx_sc_wasm_adapter::async_callback_empty! {}
