// Code generated by the multiversx-sc build system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Upgrade:                              1
// Endpoints:                           18
// Async Callback (empty):               1
// Total number of exported functions:  21

#![no_std]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    gateway
    (
        init => init
        upgrade => upgrade
        approveMessages => approve_messages
        rotateSigners => rotate_signers
        callContract => call_contract
        validateMessage => validate_message
        isMessageApproved => is_message_approved
        isMessageExecuted => is_message_executed
        messages => messages
        validateProof => validate_proof
        timeSinceRotation => time_since_rotation
        epoch => epoch
        lastRotationTimestamp => last_rotation_timestamp
        signerHashByEpoch => signer_hash_by_epoch
        epochBySignerHash => epoch_by_signer_hash
        previous_signers_retention => previous_signers_retention
        domain_separator => domain_separator
        minimum_rotation_delay => minimum_rotation_delay
        transferOperatorship => transfer_operatorship
        operator => operator
    )
}

multiversx_sc_wasm_adapter::async_callback_empty! {}
