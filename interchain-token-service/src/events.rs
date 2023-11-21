multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use crate::constants::{TokenId, TokenManagerType};

use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopEncode)]
pub struct TokenManagerDeployedEventData<M: ManagedTypeApi> {
    token_manager_type: TokenManagerType,
    contract_address: ManagedAddress<M>,
    arguments: ManagedArgBuffer<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct InterchainTokenDeploymentStartedEventData<M: ManagedTypeApi> {
    name: ManagedBuffer<M>,
    symbol: ManagedBuffer<M>,
    decimals: u8,
    distributor: ManagedBuffer<M>,
    destination_chain: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct RemoteTokenManagerDeploymentInitializedEventData<M: ManagedTypeApi> {
    destination_chain: ManagedBuffer<M>,
    gas_value: BigUint<M>,
    token_manager_type: TokenManagerType,
    params: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct StandardizedTokenDeployedEventData<M: ManagedTypeApi> {
    name: ManagedBuffer<M>,
    symbol: ManagedBuffer<M>,
    decimals: u8,
    mint_amount: BigUint<M>,
    mint_to: ManagedAddress<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct TokenSentEventData<M: ManagedTypeApi> {
    destination_chain: ManagedBuffer<M>,
    destination_address: ManagedBuffer<M>,
    amount: BigUint<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct TokenSentWithDataEventData<M: ManagedTypeApi> {
    destination_chain: ManagedBuffer<M>,
    destination_address: ManagedBuffer<M>,
    amount: BigUint<M>,
    source_address: ManagedAddress<M>,
    metadata: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct TokenReceivedWithDataEventData<M: ManagedTypeApi> {
    amount: BigUint<M>,
    source_address: ManagedBuffer<M>,
    data: ManagedBuffer<M>,
}

#[multiversx_sc::module]
pub trait EventsModule {
    fn emit_token_manager_deployed_event(
        &self,
        token_id: &TokenId<Self::Api>,
        token_manager_type: TokenManagerType,
        contract_address: ManagedAddress,
        arguments: ManagedArgBuffer<Self::Api>,
    ) {
        self.token_manager_deployed_event(
            token_id,
            TokenManagerDeployedEventData {
                token_manager_type,
                contract_address,
                arguments,
            },
        );
    }

    fn emit_interchain_token_deployment_started_event(
        &self,
        token_id: TokenId<Self::Api>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        distributor: ManagedBuffer,
        destination_chain: ManagedBuffer,
    ) {
        let data = InterchainTokenDeploymentStartedEventData {
            name,
            symbol,
            decimals,
            distributor,
            destination_chain,
        };

        self.interchain_token_deployment_started_event(token_id, data);
    }

    fn emit_remote_token_manager_deployment_initialized(
        &self,
        token_id: &TokenId<Self::Api>,
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
        token_id: &TokenId<Self::Api>,
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
        token_id: TokenId<Self::Api>,
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
        token_id: TokenId<Self::Api>,
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

    fn emit_received_token_with_data_event(
        &self,
        token_id: &TokenId<Self::Api>,
        source_chain: &ManagedBuffer,
        destination_address: &ManagedAddress,
        amount: BigUint,
        source_address: ManagedBuffer,
        metadata: ManagedBuffer,
    ) {
        let data = TokenReceivedWithDataEventData {
            amount,
            source_address,
            data: metadata,
        };

        self.token_received_with_data_event(token_id, source_chain, destination_address, data);
    }

    #[event("token_manager_deployed_event")]
    fn token_manager_deployed_event(
        &self,
        #[indexed] token_id: &TokenId<Self::Api>,
        data: TokenManagerDeployedEventData<Self::Api>,
    );

    #[event("interchain_token_deployment_started_event")]
    fn interchain_token_deployment_started_event(
        &self,
        #[indexed] token_id: TokenId<Self::Api>,
        data: InterchainTokenDeploymentStartedEventData<Self::Api>,
    );

    #[event("interchain_token_id_claimed_event")]
    fn interchain_token_id_claimed_event(
        &self,
        #[indexed] token_id: &TokenId<Self::Api>,
        #[indexed] deployer: &ManagedAddress,
        data: &ManagedBuffer,
    );

    #[event("remote_token_manager_deployment_initialized_event")]
    fn remote_token_manager_deployment_initialized_event(
        &self,
        #[indexed] token_id: &TokenId<Self::Api>,
        data: RemoteTokenManagerDeploymentInitializedEventData<Self::Api>,
    );

    #[event("standardized_token_deployed_event")]
    fn standardized_token_deployed_event(
        &self,
        #[indexed] token_id: &TokenId<Self::Api>,
        #[indexed] distributor: ManagedAddress,
        data: StandardizedTokenDeployedEventData<Self::Api>,
    );

    #[event("token_sent_event")]
    fn token_sent_event(
        &self,
        #[indexed] token_id: TokenId<Self::Api>,
        data: TokenSentEventData<Self::Api>,
    );

    #[event("token_sent_with_data_event")]
    fn token_sent_with_data_event(
        &self,
        #[indexed] token_id: TokenId<Self::Api>,
        data: TokenSentWithDataEventData<Self::Api>,
    );

    #[event("token_received_event")]
    fn token_received_event(
        &self,
        #[indexed] token_id: TokenId<Self::Api>,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] destination_address: ManagedAddress,
        amount: BigUint,
    );

    #[event("token_received_with_data_event")]
    fn token_received_with_data_event(
        &self,
        #[indexed] token_id: &TokenId<Self::Api>,
        #[indexed] source_chain: &ManagedBuffer,
        #[indexed] destination_address: &ManagedAddress,
        data: TokenReceivedWithDataEventData<Self::Api>,
    );

    #[event("token_received_with_data_success_event")]
    fn token_received_with_data_success_event(
        &self,
        #[indexed] command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] token_id: TokenId<Self::Api>,
        #[indexed] token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
    );

    #[event("token_received_with_data_error_event")]
    fn token_received_with_data_error_event(
        &self,
        #[indexed] command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] token_id: &TokenId<Self::Api>,
        #[indexed] token_identifier: &EgldOrEsdtTokenIdentifier,
        amount: &BigUint,
    );

    #[event("express_token_received_with_data_success_event")]
    fn express_token_received_with_data_success_event(
        &self,
        #[indexed] caller: ManagedAddress,
        #[indexed] command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] token_id: TokenId<Self::Api>,
        #[indexed] token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
    );

    #[event("express_token_received_with_data_error_event")]
    fn express_token_received_with_data_error_event(
        &self,
        #[indexed] caller: &ManagedAddress,
        #[indexed] command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] token_id: &TokenId<Self::Api>,
        #[indexed] token_identifier: &EgldOrEsdtTokenIdentifier,
        amount: &BigUint,
    );
}
