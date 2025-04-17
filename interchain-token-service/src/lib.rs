#![no_std]

use core::ops::Deref;

use crate::constants::{
    TokenId, MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN, MESSAGE_TYPE_INTERCHAIN_TRANSFER,
    MESSAGE_TYPE_LINK_TOKEN,
};

multiversx_sc::imports!();

pub mod abi;
pub mod abi_types;
pub mod address_tracker;
pub mod constants;
pub mod events;
pub mod executable;
pub mod factory;
pub mod proxy_gmp;
pub mod proxy_its;
pub mod remote;
pub mod user_functions;

#[multiversx_sc::contract]
pub trait InterchainTokenServiceContract:
    user_functions::UserFunctionsModule
    + operatable::Operatable
    + operatable::roles::AccountRoles
    + address_tracker::AddressTracker
    + proxy_gmp::ProxyGmpModule
    + proxy_its::ProxyItsModule
    + executable::ExecutableModule
    + events::EventsModule
    + remote::RemoteModule
    + factory::FactoryModule
    + multiversx_sc_modules::pause::PauseModule
{
    #[allow_multiple_var_args]
    #[init]
    fn init(
        &self,
        gateway: ManagedAddress,
        gas_service: ManagedAddress,
        token_manager_implementation: ManagedAddress,
        operator: ManagedAddress,
        chain_name: ManagedBuffer,
        its_hub_address: ManagedBuffer,
        trusted_chain_names: MultiValueManagedVecCounted<ManagedBuffer>,
    ) {
        require!(
            !gateway.is_zero() && !gas_service.is_zero() && !token_manager_implementation.is_zero(),
            "Zero address"
        );

        self.gateway().set_if_empty(gateway);
        self.gas_service().set_if_empty(gas_service);
        self.token_manager()
            .set_if_empty(token_manager_implementation);

        require!(!operator.is_zero(), "Zero address");
        require!(!chain_name.is_empty(), "Invalid chain name");
        require!(!its_hub_address.is_empty(), "Invalid its hub address");

        self.add_operator(operator);
        self.set_chain_name(chain_name.clone());
        self.its_hub_address().set(its_hub_address);

        for name in trusted_chain_names.into_vec().iter() {
            self.set_trusted_chain(name.clone_value());
        }

        self.chain_name_hash()
            .set(self.crypto().keccak256(chain_name));
    }

    #[upgrade]
    fn upgrade(&self) {}

    /// Owner functions
    #[allow_multiple_var_args]
    #[endpoint(setFlowLimits)]
    fn set_flow_limits(
        &self,
        token_ids: MultiValueManagedVecCounted<TokenId<Self::Api>>,
        flow_limits: MultiValueManagedVecCounted<Option<BigUint>>,
    ) {
        self.only_operator();

        require!(token_ids.len() == flow_limits.len(), "Length mismatch");

        for (token_id, flow_limit) in token_ids
            .into_vec()
            .iter()
            .zip(flow_limits.into_vec().iter())
        {
            self.token_manager_set_flow_limit(token_id.deref(), flow_limit);
        }
    }

    /// Internal Functions

    // Needs to be payable because it can issue ESDT token through the TokenManager
    #[payable("EGLD")]
    #[endpoint]
    fn execute(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        source_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        self.require_not_paused();
        self.only_its_hub(&source_chain, &source_address);

        let payload_hash = self.crypto().keccak256(&payload);

        let (message_type, original_source_chain, payload) = self.get_execute_params(payload);

        match message_type {
            MESSAGE_TYPE_INTERCHAIN_TRANSFER => {
                require!(
                    self.call_value().egld_value().deref() == &BigUint::zero(),
                    "Can not send EGLD payment if not issuing ESDT"
                );

                let valid = self.gateway_validate_message(
                    &source_chain,
                    &message_id,
                    &source_address,
                    &payload_hash,
                );

                require!(valid, "Not approved by gateway");

                self.process_interchain_transfer_payload(
                    original_source_chain,
                    message_id,
                    payload,
                );
            }
            MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN => {
                self.process_deploy_interchain_token_payload(
                    source_chain,
                    message_id,
                    source_address,
                    payload_hash,
                    payload,
                );
            }
            MESSAGE_TYPE_LINK_TOKEN => {
                require!(
                    self.call_value().egld_value().deref() == &BigUint::zero(),
                    "Can not send EGLD payment if not issuing ESDT"
                );

                let valid = self.gateway_validate_message(
                    &source_chain,
                    &message_id,
                    &source_address,
                    &payload_hash,
                );

                require!(valid, "Not approved by gateway");

                self.process_link_token_payload(payload);
            }
            _ => {
                sc_panic!("Invalid message type");
            }
        }
    }
}
