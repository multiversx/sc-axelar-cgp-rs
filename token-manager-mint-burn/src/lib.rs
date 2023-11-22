#![no_std]

pub mod distributable;

multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use token_manager::{DeployTokenManagerParams, TokenManagerType};

// If this needs updating, the TokenManagerMintBurn contract from which deployments are made can be upgraded
const DEFAULT_ESDT_ISSUE_COST: u64 = 50000000000000000; // 0.05 EGLD

#[multiversx_sc::contract]
pub trait TokenManagerMintBurnContract:
    token_manager::TokenManager
    + token_manager::proxy::ProxyModule
    + flow_limit::FlowLimit
    + operatable::Operatable
    + operatable::roles::AccountRoles
    + distributable::Distributable
{
    #[init]
    fn init(
        &self,
        interchain_token_service: ManagedAddress,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        operator: Option<ManagedAddress>,
        token_identifier: Option<EgldOrEsdtTokenIdentifier>,
    ) {
        require!(
            token_identifier.is_none() || token_identifier.clone().unwrap().is_esdt(),
            "Invalid token address"
        );

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
        let amount = self.interchain_transfer_raw(destination_chain, destination_address, metadata);

        self.take_token_raw(&amount);
    }

    #[payable("*")]
    #[endpoint(callContractWithInterchainToken)]
    fn call_contract_with_interchain_token(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        data: ManagedBuffer,
    ) {
        let amount = self.call_contract_with_interchain_token_raw(
            destination_chain,
            destination_address,
            data,
        );

        self.take_token_raw(&amount);
    }

    #[endpoint(giveToken)]
    fn give_token(
        &self,
        destination_address: &ManagedAddress,
        amount: BigUint,
    ) -> MultiValue2<EgldOrEsdtTokenIdentifier, BigUint> {
        self.give_token_endpoint(&amount);

        self.give_token_raw(destination_address, &amount).into()
    }

    #[payable("*")]
    #[endpoint(takeToken)]
    fn take_token(&self) -> BigUint {
        let amount = self.take_token_endpoint();

        self.take_token_raw(&amount)
    }

    #[payable("EGLD")]
    #[endpoint(deployInterchainToken)]
    fn deploy_interchain_token(
        &self,
        distributor: Option<ManagedAddress>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
    ) {
        require!(
            self.token_identifier().is_empty(),
            "Token address already exists"
        );

        let caller = self.blockchain().get_caller();

        // Also allow distributor to call this (if set) in case issue esdt fails
        require!(
            caller == self.interchain_token_service().get() || self.is_distributor(&caller),
            "Not service or distributor"
        );

        if distributor.is_some() {
            self.add_distributor(distributor.unwrap());
        }

        let issue_cost = BigUint::from(DEFAULT_ESDT_ISSUE_COST);

        self.send()
            .esdt_system_sc_proxy()
            .issue_and_set_all_roles(
                issue_cost,
                name,
                symbol,
                EsdtTokenType::Fungible,
                decimals as usize,
            )
            .async_call()
            .with_callback(self.callbacks().deploy_token_callback())
            .call_and_exit();
    }

    // TODO: Is it fine to handle the distributor like this? Or should we add a function to
    // change the ESDT owner from the TokenManager to the distributor?
    #[endpoint]
    fn mint(&self, address: ManagedAddress, amount: &BigUint) {
        self.only_distributor();

        require!(
            self.token_identifier().is_empty(),
            "Token address not yet set"
        );

        let token_identifier = self.token_identifier().get().into_esdt_option().unwrap();

        self.send().esdt_local_mint(&token_identifier, 0, amount);
        self.send()
            .direct_esdt(&address, &token_identifier, 0, amount)
    }

    #[payable("*")]
    #[endpoint]
    fn burn(&self) {
        self.only_distributor();

        require!(
            self.token_identifier().is_empty(),
            "Token address not yet set"
        );

        let amount = self.require_correct_token();

        let token_identifier = self.token_identifier().get().into_esdt_option().unwrap();

        self.send().esdt_local_burn(&token_identifier, 0, &amount);
    }

    fn take_token_raw(&self, amount: &BigUint) -> BigUint {
        self.send()
            .esdt_local_burn(&self.token_identifier().get().unwrap_esdt(), 0, amount);

        amount.clone()
    }

    fn give_token_raw(
        &self,
        destination_address: &ManagedAddress,
        amount: &BigUint,
    ) -> (EgldOrEsdtTokenIdentifier, BigUint) {
        let token_identifier = self.token_identifier().get();

        self.send()
            .esdt_local_mint(&token_identifier.clone().unwrap_esdt(), 0, amount);

        self.send().direct(
            destination_address,
            &self.token_identifier().get(),
            0,
            amount,
        );

        (token_identifier, amount.clone())
    }

    #[view(implementationType)]
    fn implementation_type(&self) -> TokenManagerType {
        TokenManagerType::MintBurn
    }

    // Mainly be used by frontends
    #[view(params)]
    fn params(
        &self,
        operator: Option<ManagedAddress>,
        token_identifier: Option<EgldOrEsdtTokenIdentifier>,
    ) -> DeployTokenManagerParams<Self::Api> {
        DeployTokenManagerParams {
            operator,
            token_identifier,
        }
    }

    #[callback]
    fn deploy_token_callback(
        &self,
        #[call_result] result: ManagedAsyncCallResult<TokenIdentifier>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(token_id_raw) => {
                let token_identifier = EgldOrEsdtTokenIdentifier::esdt(token_id_raw);

                self.deploy_interchain_token_success_event(&token_identifier);

                self.token_identifier().set(token_identifier);
            }
            ManagedAsyncCallResult::Err(_) => {
                self.deploy_interchain_token_failed_event();

                // Leave issue cost egld payment in contract for use when retrying deployInterchainToken
            }
        }
    }

    #[event("deploy_interchain_token_failed_event")]
    fn deploy_interchain_token_failed_event(&self);

    #[event("deploy_interchain_token_success_event")]
    fn deploy_interchain_token_success_event(
        &self,
        #[indexed] token_identifier: &EgldOrEsdtTokenIdentifier,
    );
}
