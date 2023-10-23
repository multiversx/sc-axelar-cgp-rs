#![no_std]

multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

// If this needs updating, the TokenManagerMintBurn contract from which deployments are made can be upgraded
const DEFAULT_ESDT_ISSUE_COST: u64 = 5000000000000000;

#[multiversx_sc::contract]
pub trait TokenManagerMintBurnContract:
    token_manager::TokenManager
    + token_manager::proxy::ProxyModule
    + flow_limit::FlowLimit
    + operatable::Operatable
{
    #[init]
    fn init(
        &self,
        interchain_token_service: ManagedAddress,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        operator: ManagedAddress,
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
        let amount =
            self.interchain_transfer_raw(destination_chain, destination_address, metadata);

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
    fn give_token(&self, destination_address: &ManagedAddress, amount: BigUint) -> BigUint {
        self.give_token_endpoint(&amount);

        self.give_token_raw(destination_address, &amount)
    }

    #[payable("*")]
    #[endpoint(takeToken)]
    fn take_token(&self) -> BigUint {
        let amount = self.take_token_endpoint();

        self.take_token_raw(&amount)
    }

    #[payable("EGLD")]
    #[endpoint(deployStandardizedToken)]
    fn deploy_standardized_token(
        &self,
        _distributor: ManagedAddress, // TODO: Should we set this address as ESDT token owner?
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        mint_amount: BigUint,
        mint_to: ManagedAddress,
    ) {
        require!(
            self.token_identifier().is_empty(),
            "Token address already exists"
        );

        let caller = self.blockchain().get_caller();

        require!(
            caller == self.interchain_token_service().get(),
            "Not service"
        );

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
            .with_callback(self.callbacks().deploy_token_callback(mint_amount, mint_to))
            .call_and_exit();
    }

    fn take_token_raw(&self, amount: &BigUint) -> BigUint {
        self.send()
            .esdt_local_burn(&self.token_identifier().get().unwrap_esdt(), 0, amount);

        amount.clone()
    }

    fn give_token_raw(&self, destination_address: &ManagedAddress, amount: &BigUint) -> BigUint {
        self.send()
            .esdt_local_mint(&self.token_identifier().get().unwrap_esdt(), 0, amount);

        self.send().direct(
            destination_address,
            &self.token_identifier().get(),
            0,
            amount,
        );

        amount.clone()
    }

    #[callback]
    fn deploy_token_callback(
        &self,
        #[call_result] result: ManagedAsyncCallResult<TokenIdentifier>,
        mint_amount: BigUint,
        mint_to: ManagedAddress,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(token_id_raw) => {
                let token_identifier = EgldOrEsdtTokenIdentifier::esdt(token_id_raw);

                self.standardized_token_deployed(&token_identifier);

                self.token_identifier().set(token_identifier);

                if mint_amount > 0 && mint_to != ManagedAddress::zero() {
                    self.give_token_raw(&mint_to, &mint_amount);
                }
            }
            ManagedAsyncCallResult::Err(_) => {
                self.standardized_token_deployment_failed_event();

                // Leave issue cost egld payment in contract for use when retrying deployStandardizedToken
            }
        }
    }

    #[event("standardized_token_deployment_failed_event")]
    fn standardized_token_deployment_failed_event(&self);

    #[event("standardized_token_deployed")]
    fn standardized_token_deployed(&self, #[indexed] token_identifier: &EgldOrEsdtTokenIdentifier);
}
