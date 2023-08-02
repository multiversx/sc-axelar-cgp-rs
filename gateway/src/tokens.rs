multiversx_sc::imports!();

use crate::constants::*;
use crate::events;

#[multiversx_sc::module]
pub trait Tokens: events::Events {
    fn burn_token_from(
        &self,
        _caller: &ManagedAddress,
        symbol: &EgldOrEsdtTokenIdentifier,
        amount: &BigUint,
    ) {
        require!(amount > &BigUint::zero(), "Invalid amount");

        let token_type_mapper = self.token_type(symbol);

        require!(!token_type_mapper.is_empty(), "Token does not exist");

        let token_type: TokenType = token_type_mapper.get();

        match token_type {
            TokenType::External => {} // TODO: What to do here? Keep the tokens in contract?
            TokenType::InternalBurnableFrom => {
                self.send()
                    .esdt_local_burn(&symbol.clone().unwrap_esdt(), 0, amount);
            }
            TokenType::InternalBurnable => {
                // TODO: What should we do with the tokens in this case? Since ESDTs don't have any external contract to call
                self.send()
                    .esdt_local_burn(&symbol.clone().unwrap_esdt(), 0, amount);
            }
        }
    }

    fn mint_token_raw(
        &self,
        symbol: &EgldOrEsdtTokenIdentifier,
        account: &ManagedAddress,
        amount: &BigUint,
    ) -> bool {
        let token_type_mapper = self.token_type(symbol);

        // This function was transformed to return bool because we don't want it to halt the whole contract execution in case of `execute` function
        if !token_type_mapper.is_empty() {
            return false;
        }

        let token_type: TokenType = token_type_mapper.get();

        self.set_token_mint_amount(symbol, &self.get_token_mint_amount(symbol) + amount);

        match token_type {
            TokenType::External => {
                self.send().direct(account, symbol, 0, amount);
            }
            _ => {
                // TODO: What should we do with the tokens in this case? Since ESDTs don't have any external contract to call
                self.send()
                    .esdt_local_mint(&symbol.clone().unwrap_esdt(), 0, amount);
            }
        }

        return true;
    }

    fn set_token_mint_limit(&self, symbol: EgldOrEsdtTokenIdentifier, limit: &BigUint) {
        self.token_mint_limit(&symbol).set(limit);

        self.token_mint_limit_updated_event(symbol, limit);
    }

    fn set_token_mint_amount(&self, symbol: &EgldOrEsdtTokenIdentifier, amount: BigUint) {
        let token_mint_limit_storage = self.token_mint_limit(symbol);

        require!(
            token_mint_limit_storage.is_empty() || token_mint_limit_storage.get() >= amount,
            "Exceed mint limit"
        );

        let timestamp = self.blockchain().get_block_timestamp();

        self.token_mint_amount(symbol, timestamp / HOURS_6_TO_SECONDS)
            .set(amount);
    }

    #[view(tokenMintAmount)]
    fn get_token_mint_amount(&self, symbol: &EgldOrEsdtTokenIdentifier) -> BigUint {
        let timestamp = self.blockchain().get_block_timestamp();

        self.token_mint_amount(symbol, timestamp / HOURS_6_TO_SECONDS)
            .get()
    }

    #[view(tokenMintLimit)]
    #[storage_mapper("token_mint_limit")]
    fn token_mint_limit(&self, symbol: &EgldOrEsdtTokenIdentifier) -> SingleValueMapper<BigUint>;

    #[storage_mapper("token_mint_amount")]
    fn token_mint_amount(
        &self,
        symbol: &EgldOrEsdtTokenIdentifier,
        day: u64,
    ) -> SingleValueMapper<BigUint>;

    #[view(getTokenType)]
    #[storage_mapper("token_type")]
    fn token_type(&self, token: &EgldOrEsdtTokenIdentifier) -> SingleValueMapper<TokenType>;

    // TODO: Do we need this? Currently the `symbol` above is considered to be a valid ESDT token identifier,
    // but it can also be considered to be just the token ticker, and the 'address' from SOL could be equivalent to the ESDT token identifier,
    // which we could store using this storage
    // #[view(tokenAddresses)]
    // #[storage_mapper("token_addresses")]
    // fn token_addresses(&self, token: &EgldOrEsdtTokenIdentifier) -> SingleValueMapper<ManagedAddress>;
}
