// Code generated by the multiversx-sc build system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Upgrade:                              1
// Endpoints:                           35
// Async Callback:                       1
// Total number of exported functions:  38

#![no_std]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    interchain_token_service
    (
        init => init
        upgrade => upgrade
        setInterchainTokenFactory => set_interchain_token_factory
        setFlowLimits => set_flow_limits
        execute => execute
        contractCallValue => contract_call_value
        deployTokenManager => deploy_token_manager
        deployInterchainToken => deploy_interchain_token
        expressExecute => express_execute_endpoint
        interchainTransfer => interchain_transfer
        callContractWithInterchainToken => call_contract_with_interchain_token
        interchainTokenId => interchain_token_id
        interchainTokenFactory => interchain_token_factory
        transferOperatorship => transfer_operatorship
        proposeOperatorship => propose_operatorship
        acceptOperatorship => accept_operatorship
        isOperator => is_operator
        getAccountRoles => account_roles
        getProposedRoles => proposed_roles
        getExpressExecutor => get_express_executor
        setTrustedAddress => set_trusted_address
        removeTrustedAddress => remove_trusted_address
        chainName => chain_name
        trustedAddress => trusted_address
        gateway => gateway
        gasService => gas_service
        flowLimit => flow_limit
        flowOutAmount => flow_out_amount
        flowInAmount => flow_in_amount
        deployedTokenManager => deployed_token_manager
        registeredTokenIdentifier => registered_token_identifier
        invalidTokenManagerAddress => invalid_token_manager_address
        tokenManagerAddress => token_manager_address
        tokenManagerImplementation => token_manager
        pause => pause_endpoint
        unpause => unpause_endpoint
        isPaused => paused_status
    )
}

multiversx_sc_wasm_adapter::async_callback! { interchain_token_service }
