#![no_std]

multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use token_manager::{DeployTokenManagerParams, TokenManagerType};

#[multiversx_sc::contract]
pub trait TokenManagerLockUnlockContract:
    token_manager::TokenManager
    + token_manager::proxy::ProxyModule
    + flow_limit::FlowLimit
    + operatable::Operatable
    + operatable::roles::AccountRoles
{
    #[init]
    fn init(
        &self,
        interchain_token_service: ManagedAddress,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        operator: Option<ManagedAddress>,
        token_identifier: Option<EgldOrEsdtTokenIdentifier>,
    ) {
        require!(token_identifier.is_some(), "Invalid token address");

        self.init_raw(
            interchain_token_service,
            token_id,
            operator,
            token_identifier,
        );
    }

    #[payable("*")]
    #[endpoint(interchainTransfer)]
    fn interchain_transfer(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        metadata: ManagedBuffer,
    ) {
        let _ =
            self.interchain_transfer_raw(destination_chain, destination_address, metadata);

        // Nothing to do here, tokens remain in contract
    }

    #[payable("*")]
    #[endpoint(callContractWithInterchainToken)]
    fn call_contract_with_interchain_token(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        data: ManagedBuffer,
    ) {
        let _ = self.call_contract_with_interchain_token_raw(
            destination_chain,
            destination_address,
            data,
        );

        // Nothing to do here, tokens remain in contract
    }

    #[endpoint(giveToken)]
    fn give_token(&self, destination_address: &ManagedAddress, amount: BigUint) -> MultiValue2<EgldOrEsdtTokenIdentifier, BigUint> {
        self.give_token_endpoint(&amount);

        self.give_token_raw(destination_address, &amount).into()
    }

    #[payable("*")]
    #[endpoint(takeToken)]
    fn take_token(&self) -> BigUint {
        // Nothing to do here, tokens remain in contract

        self.take_token_endpoint()
    }

    fn give_token_raw(&self, destination_address: &ManagedAddress, amount: &BigUint) -> (EgldOrEsdtTokenIdentifier, BigUint) {
        let token_identifier = self.token_identifier().get();

        self.send().direct(
            destination_address,
            &token_identifier,
            0,
            amount,
        );

        (token_identifier, amount.clone())
    }

    #[view(implementationType)]
    fn implementation_type(&self) -> TokenManagerType {
        TokenManagerType::LockUnlock
    }


    // Mainly be used by frontends
    #[view(params)]
    fn params(
        &self,
        operator: Option<ManagedAddress>,
        token_identifier: EgldOrEsdtTokenIdentifier,
    ) -> DeployTokenManagerParams<Self::Api> {
        DeployTokenManagerParams {
            operator,
            token_identifier: Some(token_identifier),
        }
    }
}
