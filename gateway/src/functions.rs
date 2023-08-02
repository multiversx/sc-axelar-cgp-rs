multiversx_sc::imports!();

use crate::constants::{DeployTokenParams, TokenType, ESDT_ISSUE_COST, MintTokenParams, BurnTokenParams};
use crate::{events, tokens};

#[multiversx_sc::module]
pub trait Functions: tokens::Tokens + events::Events {
    fn deploy_token(&self, params_raw: &ManagedBuffer) -> bool {
        let params: DeployTokenParams<Self::Api> =
            DeployTokenParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        // TODO: Should we implement this
        // if !self.token_addresses(&params.symbol).is_empty() {
        //     return false;
        // }

        if params.token.is_none() {
            // If token address is no specified, it indicates a request to deploy one.

            // TODO: Store this issue cost in a mapper?
            let issue_cost = BigUint::from(ESDT_ISSUE_COST);

            // TODO: In the SOL implementation, the token deployer is called. What should we do here?
            // TODO: Also, the cap is not utilized here at all, since tokens can be minted and burned on MultiversX without a cap
            self.send()
                .esdt_system_sc_proxy()
                .issue_and_set_all_roles(
                    issue_cost,
                    params.symbol.clone(),
                    params.symbol.clone(),
                    EsdtTokenType::Fungible,
                    params.decimals as usize,
                )
                .async_call_promise() // TODO: Is this feature live on mainnet?
                .with_callback(self.callbacks().deploy_token_callback(params.symbol, params.mint_limit)) // TODO: The token issuance can fail async and we don't know this when executing the command
                .register_promise();
        } else {
            let token = params.token.unwrap();
            // If token address is specified, ensure that there is a valid token id provided
            if !token.is_valid() {
                self.token_does_not_exist_event(token);

                return false;
            }

            self.token_type(&token).set(TokenType::External);
            self.token_mint_limit(&token).set(params.mint_limit);

            self.token_deployed_event(params.symbol, token);
        }


        return true;
    }

    fn mint_token(&self, params_raw: &ManagedBuffer) -> bool {
        let params: MintTokenParams<Self::Api> =
            MintTokenParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        return self.mint_token_raw(&params.symbol, &params.account, &params.amount);
    }

    fn burn_token(&self, params_raw: &ManagedBuffer) -> bool {
        let params: BurnTokenParams<Self::Api> =
            BurnTokenParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        let token_type_mapper = self.token_type(&params.symbol);

        if token_type_mapper.is_empty() {
            return false;
        }

        if token_type_mapper.get() == TokenType::External {
            // TODO: The SOL logic here is complex, not sure what exactly we should do here.
            // Should we just leave the tokens inside this contract?
        } else {
            // TODO: What should we do here?
        }

        return true;
    }

    fn approve_contract_call(&self, params: &ManagedBuffer, command_id: &ManagedBuffer) -> bool {
        // TODO: Implement function

        return true;
    }

    fn approve_contract_call_with_mint(
        &self,
        params: &ManagedBuffer,
        command_id: &ManagedBuffer,
    ) -> bool {
        // TODO: Implement function

        return true;
    }

    fn transfer_operatorship(&self, params: &ManagedBuffer) -> bool {
        // TODO: Implement function

        return true;
    }

    #[promises_callback]
    fn deploy_token_callback(
        &self,
        #[call_result] result: ManagedAsyncCallResult<TokenIdentifier>,
        symbol: ManagedBuffer,
        mint_limit: BigUint,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(token_id_raw) => {
                let token_id = EgldOrEsdtTokenIdentifier::esdt(token_id_raw);

                self.token_type(&token_id).set(TokenType::InternalBurnableFrom);
                self.token_mint_limit(&token_id).set(mint_limit);

                self.token_deployed_event(symbol, token_id);
            }
            ManagedAsyncCallResult::Err(_) => {
                // TODO: To whom should we return tokens? How should we handle this exactly?
                self.token_deploy_failed_event(symbol);

                let caller = self.blockchain().get_owner_address();
                let returned = self.call_value().egld_or_single_esdt();
                if returned.token_identifier.is_egld() && returned.amount > 0 {
                    self.send()
                        .direct(&caller, &returned.token_identifier, 0, &returned.amount);
                }
            }
        }
    }
}
