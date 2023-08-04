// Code generated by the multiversx-sc multi-contract system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Endpoints:                           20
// Async Callback (empty):               1
// Total number of exported functions:  22

#![no_std]
#![feature(lang_items)]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    gateway
    (
        init => init
        sendToken => send_token
        callContract => call_contract
        callContractWithToken => call_contract_with_token
        validateContractCall => validate_contract_call
        validateContractCallAndMint => validate_contract_call_and_mint
        execute => execute
        isContractCallApproved => is_contract_call_approved
        isContractCallAndMintApproved => is_contract_call_and_mint_approved
        isCommandExecuted => is_command_executed
        contractId => contract_id
        authModule => auth_module
        tokenDeployer => token_deployer_implementation
        tokenMintAmount => get_token_mint_amount
        tokenMintLimit => token_mint_limit
        getTokenType => token_type
        transferGovernance => transfer_governance
        transferMintLimiter => transfer_mint_limiter
        setTokenMintLimits => set_token_mint_limits
        governance => governance
        mintLimiter => mint_limiter
    )
}

multiversx_sc_wasm_adapter::async_callback_empty! {}
