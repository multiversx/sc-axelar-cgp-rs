multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopEncode)]
pub struct ContractCallData<M: ManagedTypeApi> {
    pub hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub payload: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct ContractCallWithTokenData<M: ManagedTypeApi> {
    pub hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub payload: ManagedBuffer<M>,
    pub symbol: ManagedBuffer<M>,
    pub amount: BigUint<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct ContractCallApprovedData<M: ManagedTypeApi> {
    pub source_tx_hash: ManagedBuffer<M>,
    pub source_event_index: BigUint<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct ContractCallApprovedWithMintData<M: ManagedTypeApi> {
    pub symbol: ManagedBuffer<M>,
    pub amount: BigUint<M>,
    pub source_tx_hash: ManagedBuffer<M>,
    pub source_event_index: BigUint<M>,
}

#[multiversx_sc::module]
pub trait Events {
    #[event("token_sent_event")]
    fn token_sent_event(
        &self,
        #[indexed] sender: ManagedAddress,
        #[indexed] destination_chain: ManagedBuffer,
        #[indexed] destination_address: ManagedBuffer,
        #[indexed] symbol: ManagedBuffer,
        amount: BigUint,
    );

    #[event("contract_call_event")]
    fn contract_call_event(
        &self,
        #[indexed] sender: ManagedAddress,
        #[indexed] destination_chain: ManagedBuffer,
        #[indexed] destination_contract_address: ManagedBuffer,
        data: ContractCallData<Self::Api>,
    );

    #[event("contract_call_with_token_event")]
    fn contract_call_with_token_event(
        &self,
        #[indexed] sender: ManagedAddress,
        #[indexed] destination_chain: ManagedBuffer,
        #[indexed] destination_contract_address: ManagedBuffer,
        data: ContractCallWithTokenData<Self::Api>,
    );

    #[event("mint_limiter_transferred_event")]
    fn mint_limiter_transferred_event(
        &self,
        #[indexed] previous_mint_limiter: ManagedAddress,
        #[indexed] new_mint_limiter: ManagedAddress,
    );

    #[event("token_mint_limit_updated_event")]
    fn token_mint_limit_updated_event(
        &self,
        #[indexed] symbol: &ManagedBuffer,
        limit: &BigUint,
    );

    #[event("executed_event")]
    fn executed_event(&self, #[indexed] command_id: &ManagedBuffer);

    #[event("token_deployed_event")]
    fn token_deployed_event(&self, #[indexed] symbol: &ManagedBuffer, token_id: &EgldOrEsdtTokenIdentifier);

    #[event("token_already_exists_event")]
    fn token_already_exists_event(&self, #[indexed] symbol: ManagedBuffer);

    #[event("token_deploy_failed_event")]
    fn token_deploy_failed_event(&self, #[indexed] symbol: ManagedBuffer);

    #[event("token_deploy_failed_not_enough_balance_event")]
    fn token_deploy_failed_not_enough_balance_event(&self, #[indexed] symbol: ManagedBuffer);

    #[event("token_does_not_exist_event")]
    fn token_does_not_exist_event(&self, #[indexed] symbol: &ManagedBuffer);

    #[event("exceed_mint_limit_event")]
    fn exceed_mint_limit_event(&self, #[indexed] symbol: &ManagedBuffer);

    #[event("token_id_does_not_exist_event")]
    fn token_id_does_not_exist_event(&self, #[indexed] token: EgldOrEsdtTokenIdentifier);

    #[event("contract_call_approved_event")]
    fn contract_call_approved_event(
        &self,
        #[indexed] command_id: &ManagedBuffer,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] source_address: ManagedBuffer,
        #[indexed] contract_address: ManagedAddress,
        #[indexed] payload_hash: ManagedBuffer,
        data: ContractCallApprovedData<Self::Api>,
    );

    #[event("contract_call_approved_with_mint_event")]
    fn contract_call_approved_with_mint_event(
        &self,
        #[indexed] command_id: &ManagedBuffer,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] source_address: ManagedBuffer,
        #[indexed] contract_address: ManagedAddress,
        #[indexed] payload_hash: ManagedBuffer,
        data: ContractCallApprovedWithMintData<Self::Api>,
    );

    #[event("operatorship_transferred_event")]
    fn operatorship_transferred_event(&self, params: &ManagedBuffer);

    #[event("set_esdt_issue_cost_event")]
    fn set_esdt_issue_cost_event(&self, issue_cost: BigUint);
}
