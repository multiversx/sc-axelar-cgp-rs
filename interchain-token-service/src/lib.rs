#![no_std]

use core::ops::Deref;

use crate::abi::AbiEncodeDecode;
use crate::constants::{
    InterchainTransferPayload, TokenId, MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
    MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER, MESSAGE_TYPE_INTERCHAIN_TRANSFER,
};

multiversx_sc::imports!();

pub mod abi;
pub mod address_tracker;
pub mod constants;
pub mod events;
pub mod executable;
pub mod express_executor_tracker;
pub mod proxy_gmp;
pub mod proxy_its;
pub mod remote;
pub mod user_functions;

#[multiversx_sc::contract]
pub trait InterchainTokenServiceContract:
    user_functions::UserFunctionsModule
    + operatable::Operatable
    + operatable::roles::AccountRoles
    + express_executor_tracker::ExpressExecutorTracker
    + address_tracker::AddressTracker
    + proxy_gmp::ProxyGmpModule
    + proxy_its::ProxyItsModule
    + executable::ExecutableModule
    + events::EventsModule
    + remote::RemoteModule
    + multiversx_sc_modules::pause::PauseModule
{
    #[allow_multiple_var_args]
    #[init]
    fn init(
        &self,
        gateway: ManagedAddress,
        gas_service: ManagedAddress,
        token_manager_implementation: ManagedAddress,
        // from _setup function below
        operator: ManagedAddress,
        chain_name: ManagedBuffer,
        trusted_chain_names: MultiValueManagedVecCounted<ManagedBuffer>,
        trusted_addresses: MultiValueManagedVecCounted<ManagedBuffer>,
    ) {
        require!(
            !gateway.is_zero() && !gas_service.is_zero() && !token_manager_implementation.is_zero(),
            "Zero address"
        );

        self.gateway().set_if_empty(gateway);
        self.gas_service().set_if_empty(gas_service);
        self.token_manager()
            .set_if_empty(token_manager_implementation);

        // from _setup function below
        require!(!operator.is_zero(), "Zero address");
        require!(!chain_name.is_empty(), "Invalid chain name");
        require!(
            trusted_chain_names.len() == trusted_addresses.len(),
            "Length mismatch"
        );

        self.add_operator(operator);
        self.set_chain_name(chain_name.clone());

        for (name, address) in trusted_chain_names
            .into_vec()
            .iter()
            .zip(trusted_addresses.into_vec().iter())
        {
            self.set_trusted_address(name.deref(), address.deref());
        }
    }

    #[upgrade]
    fn upgrade(&self) {}

    #[only_owner]
    #[endpoint(setInterchainTokenFactory)]
    fn set_interchain_token_factory(&self, interchain_token_factory: ManagedAddress) {
        self.interchain_token_factory()
            .set_if_empty(interchain_token_factory)
    }

    /// Owner functions
    #[allow_multiple_var_args]
    #[endpoint(setFlowLimits)]
    fn set_flow_limits(
        &self,
        token_ids: MultiValueManagedVecCounted<TokenId<Self::Api>>,
        flow_limits: MultiValueManagedVecCounted<BigUint>,
    ) {
        self.only_operator();

        require!(token_ids.len() == flow_limits.len(), "Length mismatch");

        for (token_id, flow_limit) in token_ids
            .into_vec()
            .iter()
            .zip(flow_limits.into_vec().iter())
        {
            self.token_manager_set_flow_limit(token_id.deref(), flow_limit.deref());
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
        self.only_remote_service(&source_chain, &source_address);

        let payload_hash = self.crypto().keccak256(&payload);

        let (message_type, original_source_chain, payload) =
            self.get_execute_params(source_chain.clone(), payload);

        match message_type {
            MESSAGE_TYPE_INTERCHAIN_TRANSFER | MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER => {
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
            }
            MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN => {
                // This is checked inside process_deploy_interchain_token_payload function
            }
            _ => {
                sc_panic!("Invalid message type");
            }
        }

        match message_type {
            MESSAGE_TYPE_INTERCHAIN_TRANSFER => {
                let express_executor = self.pop_express_executor(
                    &source_chain,
                    &message_id,
                    &source_address,
                    &payload_hash,
                );

                if !express_executor.is_zero() {
                    self.express_execution_fulfilled_event(
                        &source_chain,
                        &message_id,
                        &source_address,
                        &payload_hash,
                        &express_executor,
                    );
                }

                self.process_interchain_transfer_payload(
                    express_executor,
                    original_source_chain,
                    message_id,
                    payload,
                );
            }
            MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER => {
                self.process_deploy_token_manager_payload(payload);
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
            _ => {
                sc_panic!("Invalid message type");
            }
        }
    }

    #[view(contractCallValue)]
    fn contract_call_value(
        &self,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) -> MultiValue2<EgldOrEsdtTokenIdentifier, BigUint> {
        self.only_remote_service(&source_chain, &source_address);
        self.require_not_paused();

        // Using the same struct as in the `expressExecute` endpoint for consistency,
        // even though in the Solidity implementation this decoding is slightly different
        let interchain_transfer_payload = InterchainTransferPayload::abi_decode(payload);

        require!(
            interchain_transfer_payload.message_type == MESSAGE_TYPE_INTERCHAIN_TRANSFER,
            "Invalid express message type"
        );

        (
            self.registered_token_identifier(&interchain_transfer_payload.token_id),
            interchain_transfer_payload.amount,
        )
            .into()
    }
}
