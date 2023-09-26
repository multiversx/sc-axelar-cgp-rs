multiversx_sc::imports!();

use crate::constants::*;
use crate::events;

#[multiversx_sc::module]
pub trait Tokens: events::Events {
    fn burn_token_from(
        &self,
        _caller: &ManagedAddress,
        symbol: &ManagedBuffer,
        token: EgldOrEsdtTokenIdentifier,
        amount: &BigUint,
    ) {
        require!(amount > &BigUint::zero(), "Invalid amount");

        let supported_token_mapper = self.supported_tokens(symbol);

        require!(!supported_token_mapper.is_empty(), "Token does not exist");

        let supported_token: SupportedToken<Self::Api> = supported_token_mapper.get();

        require!(supported_token.identifier == token, "Invalid token sent");

        match supported_token.token_type {
            TokenType::InternalBurnableFrom => {
                self.send().esdt_local_burn(&token.unwrap_esdt(), 0, amount);
            }
            TokenType::External => {} // Nothing to do, tokens remain locked in contract
        }
    }

    // This function was transformed to return bool because we don't want it to halt the whole contract execution in case of `execute` endpoint
    fn mint_token_raw(
        &self,
        symbol: &ManagedBuffer,
        account: &ManagedAddress,
        amount: &BigUint,
    ) -> bool {
        let supported_token_mapper = self.supported_tokens(symbol);

        if supported_token_mapper.is_empty() {
            self.token_does_not_exist_event(symbol);

            return false;
        }

        let supported_token: SupportedToken<Self::Api> = supported_token_mapper.get();

        if !self.set_token_mint_amount(symbol, amount, &supported_token.mint_limit) {
            self.exceed_mint_limit_event(symbol);

            return false;
        }

        let token = supported_token.identifier;

        match supported_token.token_type {
            TokenType::External => {} // Nothing to do, tokens are already in contract
            TokenType::InternalBurnableFrom => {
                self.send()
                    .esdt_local_mint(&token.clone().unwrap_esdt(), 0, amount);
            }
        }

        self.send().direct(account, &token, 0, amount);

        return true;
    }

    fn set_token_mint_amount(
        &self,
        symbol: &ManagedBuffer,
        extra_amount: &BigUint,
        mint_limit: &BigUint,
    ) -> bool {
        let timestamp = self.blockchain().get_block_timestamp();
        let token_mint_amount_mapper =
            self.token_mint_amount(symbol, timestamp / HOURS_6_TO_SECONDS);

        let total_amount = token_mint_amount_mapper.get() + extra_amount;

        if mint_limit > &BigUint::zero() && &total_amount > mint_limit {
            return false;
        }

        token_mint_amount_mapper.set(total_amount);

        return true;
    }

    #[view(tokenMintAmount)]
    fn get_token_mint_amount(&self, symbol: &ManagedBuffer) -> BigUint {
        let timestamp = self.blockchain().get_block_timestamp();

        self.token_mint_amount(symbol, timestamp / HOURS_6_TO_SECONDS)
            .get()
    }

    #[storage_mapper("token_mint_amount")]
    fn token_mint_amount(
        &self,
        symbol: &ManagedBuffer,
        day: u64, // TODO: Why is the 'day' needed here which is not really a day but 6 hours?
    ) -> SingleValueMapper<BigUint>;

    #[view(getSupportedTokens)]
    #[storage_mapper("supported_tokens")]
    fn supported_tokens(
        &self,
        token: &ManagedBuffer,
    ) -> SingleValueMapper<SupportedToken<Self::Api>>;
}
