// Code generated by the multiversx-sc build system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Upgrade:                              1
// Endpoints:                           20
// Async Callback (empty):               1
// Promise callbacks:                    2
// Total number of exported functions:  25

#![no_std]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    governance
    (
        init => init
        upgrade => upgrade
        executeProposal => execute_proposal
        executeOperatorProposal => execute_operator_proposal
        withdraw => withdraw
        transferOperatorship => transfer_operatorship
        execute => execute
        withdrawRefundToken => withdraw_refund_token
        getProposalEta => get_proposal_eta
        isOperatorProposalApproved => is_operator_proposal_approved
        gateway => gateway
        getMinimumTimeLockDelay => minimum_time_lock_delay
        getGovernanceChain => governance_chain
        getGovernanceAddress => governance_address
        getOperator => operator
        getTimeLockEta => time_lock_eta
        getOperatorApprovals => operator_approvals
        getRefundToken => refund_token
        getTimelockProposalsSubmitted => time_lock_proposals_submitted
        getOperatorProposalsSubmitted => operator_proposals_submitted
        getTimelockProposalsBeingExecuted => time_lock_proposals_being_executed
        getOperatorProposalsBeingExecuted => operator_proposals_being_executed
        execute_proposal_callback => execute_proposal_callback
        execute_operator_proposal_callback => execute_operator_proposal_callback
    )
}

multiversx_sc_wasm_adapter::async_callback_empty! {}
