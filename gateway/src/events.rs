multiversx_sc::imports!();
multiversx_sc::derive_imports!();

#[derive(TypeAbi, TopEncode)]
pub struct ContractCallData<M: ManagedTypeApi> {
    pub hash: ManagedByteArray<M, 32>,
    pub payload: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct ContractCallWithTokenData<M: ManagedTypeApi> {
    pub hash: ManagedByteArray<M, 32>,
    pub payload: ManagedBuffer<M>,
    pub symbol: EgldOrEsdtTokenIdentifier<M>,
    pub amount: BigUint<M>,
}

#[multiversx_sc::module]
pub trait Events {
    #[event("token_sent_event")]
    fn token_sent_event(
        &self,
        #[indexed] sender: ManagedAddress,
        #[indexed] destination_chain: ManagedBuffer,
        #[indexed] destination_address: ManagedBuffer,
        #[indexed] symbol: EgldOrEsdtTokenIdentifier,
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

    #[event("governance_transferred_event")]
    fn governance_transferred_event(
        &self,
        #[indexed] previous_governance: ManagedAddress,
        #[indexed] new_governance: ManagedAddress,
    );

    #[event("mint_limiter_transferred_event")]
    fn mint_limiter_transferred_event(
        &self,
        #[indexed] previous_mint_limiter: ManagedAddress,
        #[indexed] new_mint_limiter: ManagedAddress,
    );

    #[event("token_mint_limit_updated_event")]
    fn token_mint_limit_updated_event(&self, #[indexed] symbol: EgldOrEsdtTokenIdentifier, limit: &BigUint);
}
