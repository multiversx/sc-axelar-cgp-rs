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

#[derive(TypeAbi, TopEncode)]
struct StandardizedTokenDeployedEventData<M: ManagedTypeApi> {
    name: ManagedBuffer<M>,
    symbol: ManagedBuffer<M>,
    decimals: u8,
    mint_amount: BigUint<M>,
    mint_to: ManagedAddress<M>,
}

#[derive(TypeAbi, TopEncode)]
struct TokenSentEventData<M: ManagedTypeApi> {
    destination_chain: ManagedBuffer<M>,
    destination_address: ManagedBuffer<M>,
    amount: BigUint<M>,
}

#[derive(TypeAbi, TopEncode)]
struct TokenSentWithDataEventData<M: ManagedTypeApi> {
    destination_chain: ManagedBuffer<M>,
    destination_address: ManagedBuffer<M>,
    amount: BigUint<M>,
    source_address: ManagedAddress<M>,
    metadata: ManagedBuffer<M>,
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

    fn emit_standardized_token_deployed_event(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        distributor: ManagedAddress,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        mint_amount: BigUint,
        mint_to: ManagedAddress,
    ) {
        let data = StandardizedTokenDeployedEventData {
            name,
            symbol,
            decimals,
            mint_amount,
            mint_to,
        };

        self.standardized_token_deployed_event(token_id, distributor, data);
    }

    fn emit_token_sent_event(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        amount: BigUint,
    ) {
        let data = TokenSentEventData {
            destination_chain,
            destination_address,
            amount,
        };

        self.token_sent_event(token_id, data);
    }

    fn emit_token_sent_with_data_event(
        &self,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        amount: BigUint,
        source_address: ManagedAddress,
        metadata: ManagedBuffer,
    ) {
        let data = TokenSentWithDataEventData {
            destination_chain,
            destination_address,
            amount,
            source_address,
            metadata,
        };

        self.token_sent_with_data_event(token_id, data);
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

    #[event("standardized_token_deployed_event")]
    fn standardized_token_deployed_event(
        &self,
        #[indexed] token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] distributor: ManagedAddress,
        data: StandardizedTokenDeployedEventData<Self::Api>,
    );

    #[event("express_receive_event")]
    fn express_receive_event(
        &self,
        #[indexed] command_id: &ManagedBuffer,
        #[indexed] express_caller: &ManagedAddress,
        payload: &ManagedBuffer,
    );

    #[event("token_sent_event")]
    fn token_sent_event(
        &self,
        #[indexed] token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        data: TokenSentEventData<Self::Api>,
    );

    #[event("token_sent_with_data_event")]
    fn token_sent_with_data_event(
        &self,
        #[indexed] token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        data: TokenSentWithDataEventData<Self::Api>,
    );
}
