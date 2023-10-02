multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use crate::constants::TokenManagerType;
use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopEncode)]
struct RemoteStandardizedTokenAndManagerDeploymentInitializedEventData<M: ManagedTypeApi> {
    name: ManagedBuffer<M>,
    symbol: ManagedBuffer<M>,
    decimals: u8,
    distributor: ManagedBuffer<M>,
    mint_to: ManagedBuffer<M>,
    mint_amount: BigUint<M>,
    operator: ManagedBuffer<M>,
    destination_chain: ManagedBuffer<M>,
    gas_value: BigUint<M>,
}

#[derive(TypeAbi, TopEncode)]
struct RemoteTokenManagerDeploymentInitializedEventData<M: ManagedTypeApi> {
    destination_chain: ManagedBuffer<M>,
    gas_value: BigUint<M>,
    token_manager_type: TokenManagerType,
    params: ManagedBuffer<M>,
}

#[multiversx_sc::module]
pub trait Events {
    fn emit_remote_standardized_token_and_manager_deployment_initialized_event(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        distributor: ManagedBuffer,
        mint_to: ManagedBuffer,
        mint_amount: BigUint,
        operator: ManagedBuffer,
        destination_chain: ManagedBuffer,
        gas_value: BigUint,
    ) {
        let data = RemoteStandardizedTokenAndManagerDeploymentInitializedEventData {
            name,
            symbol,
            decimals,
            distributor,
            mint_to,
            mint_amount,
            operator,
            destination_chain,
            gas_value,
        };

        self.remote_standardized_token_and_manager_deployment_initialized_event(token_id, data);
    }

    fn emit_remote_token_manager_deployment_initialized(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        gas_value: BigUint,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) {
        let data = RemoteTokenManagerDeploymentInitializedEventData {
            destination_chain,
            gas_value,
            token_manager_type,
            params,
        };

        self.remote_token_manager_deployment_initialized_event(token_id, data);
    }

    #[event("token_manager_deployed_event")]
    fn token_manager_deployed_event(
        &self,
        #[indexed] token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] token_manager_type: TokenManagerType,
        data: ManagedArgBuffer<Self::Api>,
    );

    #[event("remote_standardized_token_and_manager_deployment_initialized_event")]
    fn remote_standardized_token_and_manager_deployment_initialized_event(
        &self,
        #[indexed] token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        data: RemoteStandardizedTokenAndManagerDeploymentInitializedEventData<Self::Api>,
    );

    #[event("custom_token_id_claimed_event")]
    fn custom_token_id_claimed_event(
        &self,
        #[indexed] token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] deployer: ManagedAddress,
        data: ManagedBuffer,
    );

    #[event("remote_token_manager_deployment_initialized_event")]
    fn remote_token_manager_deployment_initialized_event(
        &self,
        #[indexed] token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        data: RemoteTokenManagerDeploymentInitializedEventData<Self::Api>,
    );
}
