use token_manager::constants::{DeployTokenManagerParams, TokenManagerType};

use crate::constants::{Hash, TokenId};

multiversx_sc::imports!();
multiversx_sc::derive_imports!();

#[derive(TypeAbi, TopEncode)]
pub struct TokenManagerDeployedEventData<M: ManagedTypeApi> {
    token_manager: ManagedAddress<M>,
    token_manager_type: TokenManagerType,
    params: DeployTokenManagerParams<M>,
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
pub struct LinkTokenStartedEventData<'a, M: ManagedTypeApi> {
    destination_chain: &'a ManagedBuffer<M>,
    source_token_address: &'a ManagedBuffer<M>,
    destination_token_address: &'a ManagedBuffer<M>,
    token_manager_type: &'a TokenManagerType,
    params: &'a ManagedBuffer<M>,
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
        params: DeployTokenManagerParams<Self::Api>,
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

    fn emit_link_token_started_event<'a>(
        &self,
        token_id: &TokenId<Self::Api>,
        destination_chain: &'a ManagedBuffer,
        source_token_address: &ManagedBuffer,
        destination_token_address: &'a ManagedBuffer,
        token_manager_type: &'a TokenManagerType,
        params: &'a ManagedBuffer,
    ) {
        let data = LinkTokenStartedEventData {
            destination_chain,
            source_token_address,
            destination_token_address,
            token_manager_type,
            params,
        };

        self.link_token_started_event(token_id, data);
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
        deploy_salt: &Hash<Self::Api>,
    );

    #[event("token_metadata_registered_event")]
    fn token_metadata_registered_event(
        &self,
        #[indexed] token_identifier: &EgldOrEsdtTokenIdentifier,
        decimals: u8,
    );

    #[event("link_token_started_event")]
    fn link_token_started_event(
        &self,
        #[indexed] token_id: &TokenId<Self::Api>,
        data: LinkTokenStartedEventData<Self::Api>,
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

    #[event("deploy_remote_interchain_token_approval_event")]
    fn deploy_remote_interchain_token_approval_event(
        &self,
        #[indexed] minter: &ManagedAddress,
        #[indexed] deployer: &ManagedAddress,
        #[indexed] token_id: &Hash<Self::Api>,
        #[indexed] destination_chain: &ManagedBuffer,
        destination_minter: &ManagedBuffer,
    );

    #[event("revoked_deploy_remote_interchain_token_approval_event")]
    fn revoked_deploy_remote_interchain_token_approval_event(
        &self,
        #[indexed] minter: &ManagedAddress,
        #[indexed] deployer: &ManagedAddress,
        #[indexed] token_id: &Hash<Self::Api>,
        #[indexed] destination_chain: &ManagedBuffer,
    );
}
