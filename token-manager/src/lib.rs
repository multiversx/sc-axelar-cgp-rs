#![no_std]

use multiversx_sc::api::KECCAK256_RESULT_LEN;

use constants::{DeployTokenManagerParams, TokenManagerType};
use operatable::roles::Roles;

use crate::constants::DEFAULT_ESDT_ISSUE_COST;

multiversx_sc::imports!();

pub mod constants;
pub mod flow_limit;
pub mod minter;

#[multiversx_sc::contract]
pub trait TokenManagerLockUnlockContract:
    flow_limit::FlowLimit + operatable::Operatable + operatable::roles::AccountRoles + minter::Minter
{
    #[init]
    fn init(
        &self,
        interchain_token_service: ManagedAddress,
        implementation_type: TokenManagerType,
        interchain_token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        params: DeployTokenManagerParams<Self::Api>,
    ) {
        require!(!interchain_token_service.is_zero(), "Zero address");

        self.interchain_token_service()
            .set_if_empty(interchain_token_service.clone());
        self.implementation_type().set_if_empty(implementation_type);
        self.interchain_token_id().set_if_empty(interchain_token_id);

        // From setup of TokenManager
        let operator = if params.operator.is_none() {
            ManagedAddress::zero()
        } else {
            params.operator.unwrap()
        };

        // If an operator is not provided, set zero address as the operator.
        // This allows anyone to easily check if a custom operator was set on the token manager.
        self.add_role(operator, Roles::FLOW_LIMITER | Roles::OPERATOR);
        // Add operator and flow limiter role to the service. The operator can remove the flow limiter role if they so chose and the service has no way to use the operator role for now.
        self.add_role(
            interchain_token_service,
            Roles::FLOW_LIMITER | Roles::OPERATOR,
        );

        match implementation_type {
            TokenManagerType::LockUnlock | TokenManagerType::LockUnlockFee => {
                require!(params.token_identifier.is_some(), "Invalid token address");
            }
            TokenManagerType::MintBurn | TokenManagerType::MintBurnFrom => {
                require!(
                    params.token_identifier.is_none()
                        || params.token_identifier.clone().unwrap().is_esdt(),
                    "Invalid token address"
                );
            }
        }

        if params.token_identifier.is_some() {
            self.token_identifier()
                .set_if_empty(params.token_identifier.unwrap());
        }
    }

    #[endpoint(addFlowLimiter)]
    fn add_flow_limiter(&self, flow_limiter: ManagedAddress) {
        self.only_operator();

        self.add_role(flow_limiter, Roles::FLOW_LIMITER);
    }

    #[endpoint(removeFlowLimiter)]
    fn remove_flow_limiter(&self, flow_limiter: ManagedAddress) {
        self.only_operator();

        self.remove_role(flow_limiter, Roles::FLOW_LIMITER);
    }

    #[endpoint(setFlowLimit)]
    fn set_flow_limit(&self, flow_limit: BigUint) {
        self.only_flow_limiter();

        self.set_flow_limit_raw(flow_limit, self.interchain_token_id().get());
    }

    #[endpoint(giveToken)]
    fn give_token(
        &self,
        destination_address: &ManagedAddress,
        amount: BigUint,
    ) -> MultiValue2<EgldOrEsdtTokenIdentifier, BigUint> {
        self.only_service();

        let token_identifier = self.token_identifier().get();

        self.add_flow_in_raw(&amount);

        let implementation_type = self.implementation_type().get();
        match implementation_type {
            TokenManagerType::MintBurn | TokenManagerType::MintBurnFrom => {
                self.give_token_mint_burn(&token_identifier, destination_address, &amount);
            }
            // nothing to do for lock/unlock, tokens remain in contract
            TokenManagerType::LockUnlock | TokenManagerType::LockUnlockFee => {
                self.give_token_lock_unlock(&token_identifier, destination_address, &amount);
            }
        }

        (token_identifier, amount).into()
    }

    #[payable("*")]
    #[endpoint(takeToken)]
    fn take_token(&self) -> BigUint {
        self.only_service();

        let (token_identifier, amount) = self.require_correct_token();

        self.add_flow_out_raw(&amount);

        let implementation_type = self.implementation_type().get();
        match implementation_type {
            TokenManagerType::MintBurn | TokenManagerType::MintBurnFrom => {
                self.take_token_mint_burn(token_identifier, &amount);
            }
            // nothing to do for lock/unlock, tokens remain in contract
            TokenManagerType::LockUnlock | TokenManagerType::LockUnlockFee => {}
        }

        amount
    }

    /// Mint/burn type only functions

    // Somewhat equivalent to Axelar InterchainToken init method
    #[payable("EGLD")]
    #[endpoint(deployInterchainToken)]
    fn deploy_interchain_token(
        &self,
        minter: Option<ManagedAddress>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
    ) {
        require!(
            self.implementation_type().get() == TokenManagerType::MintBurn,
            "Not mint burn token manager"
        );

        require!(
            self.token_identifier().is_empty(),
            "Token address already exists"
        );

        let caller = self.blockchain().get_caller();
        let interchain_token_service = self.interchain_token_service().get();

        // Also allow minter to call this (if set) in case issue esdt fails
        require!(
            caller == interchain_token_service || self.is_minter(&caller),
            "Not service or minter"
        );

        require!(!name.is_empty(), "Token name empty");
        require!(!symbol.is_empty(), "Token symbol empty");

        /*
         * Set the token service as a minter to allow it to mint and burn tokens.
         * Also add the provided address as a minter. If zero address was provided,
         * add it as a minter to allow anyone to easily check that no custom minter was set.
         */
        self.add_minter(interchain_token_service);
        if minter.is_some() {
            self.add_minter(minter.unwrap());
        } else {
            self.add_minter(ManagedAddress::zero());
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

    #[endpoint]
    fn mint(&self, address: ManagedAddress, amount: &BigUint) {
        require!(
            self.implementation_type().get() == TokenManagerType::MintBurn,
            "Not mint burn token manager"
        );

        self.only_minter();

        require!(
            !self.token_identifier().is_empty(),
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
        require!(
            self.implementation_type().get() == TokenManagerType::MintBurn,
            "Not mint burn token manager"
        );

        self.only_minter();

        require!(
            !self.token_identifier().is_empty(),
            "Token address not yet set"
        );

        let (token_identifier, amount) = self.require_correct_token();

        self.send()
            .esdt_local_burn(&token_identifier.unwrap_esdt(), 0, &amount);
    }

    fn only_service(&self) {
        require!(
            self.blockchain().get_caller() == self.interchain_token_service().get(),
            "Not service"
        );
    }

    fn only_flow_limiter(&self) {
        self.only_role(Roles::FLOW_LIMITER);
    }

    fn require_correct_token(&self) -> (EgldOrEsdtTokenIdentifier, BigUint) {
        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        let required_token_identifier = self.token_identifier().get();

        require!(
            token_identifier == required_token_identifier,
            "Wrong token sent"
        );

        (token_identifier, amount)
    }

    fn give_token_lock_unlock(
        &self,
        token_identifier: &EgldOrEsdtTokenIdentifier,
        destination_address: &ManagedAddress,
        amount: &BigUint,
    ) {
        self.send()
            .direct(destination_address, token_identifier, 0, amount);
    }

    fn give_token_mint_burn(
        &self,
        token_identifier: &EgldOrEsdtTokenIdentifier,
        destination_address: &ManagedAddress,
        amount: &BigUint,
    ) {
        self.send()
            .esdt_local_mint(&token_identifier.clone().unwrap_esdt(), 0, amount);

        self.send()
            .direct(destination_address, token_identifier, 0, amount);
    }

    fn take_token_mint_burn(&self, token_identifier: EgldOrEsdtTokenIdentifier, amount: &BigUint) {
        self.send()
            .esdt_local_burn(&token_identifier.unwrap_esdt(), 0, amount);
    }

    #[view(getImplementationTypeAndTokenIdentifier)]
    fn get_implementation_type_and_token_identifier(
        &self,
    ) -> MultiValue2<TokenManagerType, EgldOrEsdtTokenIdentifier> {
        MultiValue2::from((
            self.implementation_type().get(),
            self.token_identifier().get(),
        ))
    }

    #[view(isFlowLimiter)]
    fn is_flow_limiter(&self, address: &ManagedAddress) -> bool {
        self.has_role(address, Roles::FLOW_LIMITER)
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

    #[view(invalidTokenIdentifier)]
    fn invalid_token_identifier(&self) -> Option<EgldOrEsdtTokenIdentifier> {
        let token_identifier_mapper = self.token_identifier();

        if token_identifier_mapper.is_empty() {
            return None;
        }

        Some(token_identifier_mapper.get())
    }

    #[view(interchainTokenService)]
    #[storage_mapper("interchain_token_service")]
    fn interchain_token_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(implementationType)]
    #[storage_mapper("implementation_type")]
    fn implementation_type(&self) -> SingleValueMapper<TokenManagerType>;

    #[view(interchainTokenId)]
    #[storage_mapper("interchain_token_id")]
    fn interchain_token_id(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[view(tokenIdentifier)]
    #[storage_mapper("token_identifier")]
    fn token_identifier(&self) -> SingleValueMapper<EgldOrEsdtTokenIdentifier>;

    #[callback]
    fn deploy_token_callback(
        &self,
        #[call_result] result: ManagedAsyncCallResult<TokenIdentifier>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(token_id_raw) => {
                let token_identifier = EgldOrEsdtTokenIdentifier::esdt(token_id_raw);

                self.interchain_token_deployed_event(
                    self.interchain_token_id().get(),
                    &token_identifier,
                );

                self.token_identifier().set(token_identifier);
            }
            ManagedAsyncCallResult::Err(_) => {
                self.interchain_token_deployment_failed();

                // Leave issue cost egld payment in contract for use when retrying deployInterchainToken
            }
        }
    }

    #[event("interchain_token_deployment_failed")]
    fn interchain_token_deployment_failed(&self);

    #[event("interchain_token_deployed_event")]
    fn interchain_token_deployed_event(
        &self,
        #[indexed] token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[indexed] token_identifier: &EgldOrEsdtTokenIdentifier,
    );
}
