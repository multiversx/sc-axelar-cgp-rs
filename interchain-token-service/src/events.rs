use token_manager::constants::TokenManagerType;

use crate::constants::{Hash, TokenId};

multiversx_sc::imports!();
multiversx_sc::derive_imports!();

#[derive(TypeAbi, TopEncode)]
pub struct TokenManagerDeployedEventData<M: ManagedTypeApi> {
    token_manager: ManagedAddress<M>,
    token_manager_type: TokenManagerType,
    params: ManagedBuffer<M>, // Should actually be of type DeployTokenManagerParams
}

#[derive(TypeAbi, TopEncode)]
pub struct InterchainTokenDeploymentStartedEventData<M: ManagedTypeApi> {
    name: ManagedBuffer<M>,
    symbol: ManagedBuffer<M>,
    decimals: u8,
    minter: ManagedBuffer<M>,
    destination_chain: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopEncode)]
pub struct TokenManagerDeploymentStartedEventData<M: ManagedTypeApi> {
    destination_chain: ManagedBuffer<M>,
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
pub struct InterchainTransferEventData<M: ManagedTypeApi> {
    destination_chain: ManagedBuffer<M>,
    destination_address: ManagedBuffer<M>,
    amount: BigUint<M>,
}

#[multiversx_sc::module]
pub trait EventsModule {
    fn emit_token_manager_deployed_event(
        &self,
        token_id: &TokenId<Self::Api>,
        token_manager: ManagedAddress,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) {
        self.token_manager_deployed_event(
            token_id,
            TokenManagerDeployedEventData {
                token_manager,
                token_manager_type,
                params,
            },
        );
    }

    fn emit_interchain_token_deployment_started_event(
        &self,
        token_id: &TokenId<Self::Api>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        minter: ManagedBuffer,
        destination_chain: ManagedBuffer,
    ) {
        let data = InterchainTokenDeploymentStartedEventData {
            name,
            symbol,
            decimals,
            minter,
            destination_chain,
        };

        self.interchain_token_deployment_started_event(token_id, data);
    }

    fn emit_token_manager_deployment_started(
        &self,
        token_id: &TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) {
        let data = TokenManagerDeploymentStartedEventData {
            destination_chain,
            token_manager_type,
            params,
        };

        self.token_manager_deployment_started_event(token_id, data);
    }

    fn emit_standardized_token_deployed_event(
        &self,
        token_id: &TokenId<Self::Api>,
        minter: ManagedAddress,
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

        self.standardized_token_deployed_event(token_id, minter, data);
    }

    fn emit_interchain_transfer_event(
        &self,
        token_id: TokenId<Self::Api>,
        source_address: ManagedAddress,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        amount: BigUint,
        data_hash: Hash<Self::Api>,
    ) {
        let data = InterchainTransferEventData {
            destination_chain,
            destination_address,
            amount,
        };

        self.interchain_transfer_event(token_id, source_address, data_hash, data);
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
        #[indexed] token_id: &TokenId<Self::Api>,
        data: InterchainTokenDeploymentStartedEventData<Self::Api>,
    );

    #[event("interchain_token_id_claimed_event")]
    fn interchain_token_id_claimed_event(
        &self,
        #[indexed] token_id: &TokenId<Self::Api>,
        #[indexed] deployer: &ManagedAddress,
        salt: &Hash<Self::Api>,
    );

    #[event("token_manager_deployment_started_event")]
    fn token_manager_deployment_started_event(
        &self,
        #[indexed] token_id: &TokenId<Self::Api>,
        data: TokenManagerDeploymentStartedEventData<Self::Api>,
    );

    #[event("standardized_token_deployed_event")]
    fn standardized_token_deployed_event(
        &self,
        #[indexed] token_id: &TokenId<Self::Api>,
        #[indexed] minter: ManagedAddress,
        data: StandardizedTokenDeployedEventData<Self::Api>,
    );

    #[event("interchain_transfer_event")]
    fn interchain_transfer_event(
        &self,
        #[indexed] token_id: TokenId<Self::Api>,
        #[indexed] source_address: ManagedAddress,
        #[indexed] data_hash: Hash<Self::Api>,
        data: InterchainTransferEventData<Self::Api>,
    );

    #[event("interchain_transfer_received_event")]
    fn interchain_transfer_received_event(
        &self,
        #[indexed] token_id: &TokenId<Self::Api>,
        #[indexed] source_chain: &ManagedBuffer,
        #[indexed] message_id: &ManagedBuffer,
        #[indexed] source_address: &ManagedBuffer,
        #[indexed] destination_address: &ManagedAddress,
        #[indexed] data_hash: Hash<Self::Api>,
        amount: &BigUint,
    );

    #[event("execute_with_interchain_token_success_event")]
    fn execute_with_interchain_token_success_event(
        &self,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] message_id: ManagedBuffer,
    );

    #[event("execute_with_interchain_token_failed_event")]
    fn execute_with_interchain_token_failed_event(
        &self,
        #[indexed] source_chain: ManagedBuffer,
        #[indexed] message_id: ManagedBuffer,
    );
}
