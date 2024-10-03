// Code generated by the multiversx-sc build system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Upgrade:                              1
// Endpoints:                           14
// Async Callback (empty):               1
// Promise callbacks:                    2
// Total number of exported functions:  19

#![no_std]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    governance
    (
        init => init
        upgrade => upgrade
        executeProposal => execute_proposal
        executeMultisigProposal => execute_multisig_proposal
        withdraw => withdraw
        transferMultisig => transfer_multisig
        execute => execute
        getProposalEta => get_proposal_eta
        isMultisigProposalApproved => is_multisig_proposal_approved
        gateway => gateway
        getMinimumTimeLockDelay => minimum_time_lock_delay
        getGovernanceChain => governance_chain
        getGovernanceAddress => governance_address
        getMultisig => multisig
        getTimeLockEta => time_lock_eta
        getMultisigApprovals => multisig_approvals
        execute_proposal_callback => execute_proposal_callback
        execute_multisig_proposal_callback => execute_multisig_proposal_callback
    )
}

multiversx_sc_wasm_adapter::async_callback_empty! {}
