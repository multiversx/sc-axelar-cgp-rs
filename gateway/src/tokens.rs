multiversx_sc::imports!();

use crate::constants::*;

#[multiversx_sc::module]
pub trait Tokens {
    #[view]
    fn token_mint_limit(&self, symbol: &EgldOrEsdtTokenIdentifier) -> BigUint {
        self.get_biguint(self.get_token_mint_limit_key(symbol)).get()
    }

    #[view]
    fn token_mint_amount(&self, symbol: &EgldOrEsdtTokenIdentifier) -> BigUint {
        let timestamp = self.blockchain().get_block_timestamp();

        self.get_biguint(self.get_token_mint_amount_key(symbol, timestamp / HOURS_TO_SECONDS_6)).get()
    }

    fn burn_token_from(
        &self,
        _caller: &ManagedAddress,
        symbol: &EgldOrEsdtTokenIdentifier,
        amount: &BigUint,
    ) {
        require!(amount > &BigUint::zero(), "Invalid amount");

        let token_type_mapper = self.get_token_type(symbol);

        require!(!token_type_mapper.is_empty(), "Token does not exist");

        let token_type: TokenType = token_type_mapper.get();

        match token_type {
            TokenType::External => {} // nothing to do, tokens remain in contract
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

    fn mint_token(&self, symbol: &EgldOrEsdtTokenIdentifier, account: &ManagedAddress, amount: &BigUint) {
        let token_type_mapper = self.get_token_type(symbol);

        require!(!token_type_mapper.is_empty(), "Token does not exist");

        let token_type: TokenType = token_type_mapper.get();

        self.set_token_mint_amount(symbol, &self.token_mint_amount(symbol) + amount);

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
    }

    fn get_token_mint_limit_key(&self, symbol: &EgldOrEsdtTokenIdentifier) -> ManagedByteArray<32> {
        let mut encoded = ManagedBuffer::new();

        encoded.append(&ManagedBuffer::new_from_bytes(PREFIX_TOKEN_MINT_LIMIT));
        encoded.append(&symbol.clone().into_name());

        self.crypto().keccak256(encoded)
    }

    fn get_token_mint_amount_key(&self, symbol: &EgldOrEsdtTokenIdentifier, day: u64) -> ManagedByteArray<32> {
        let mut encoded = ManagedBuffer::new();

        encoded.append(&ManagedBuffer::new_from_bytes(PREFIX_TOKEN_MINT_AMOUNT));
        encoded.append(&symbol.clone().into_name());
        encoded.append(&BigUint::from(day).to_bytes_be_buffer());

        self.crypto().keccak256(encoded)
    }

    fn set_token_mint_amount(&self, symbol: &EgldOrEsdtTokenIdentifier, amount: BigUint) {
        let limit = self.token_mint_limit(symbol);

        require!(limit == 0 || limit >= amount, "Exceed mint limit");

        let timestamp = self.blockchain().get_block_timestamp();

        self.get_biguint(self.get_token_mint_amount_key(symbol, timestamp / HOURS_TO_SECONDS_6)).set(amount);
    }

    // TODO: Modify this to independent storages?
    #[storage_mapper("get_biguint")]
    fn get_biguint(&self, key: ManagedByteArray<32>) -> SingleValueMapper<BigUint>;

    #[storage_mapper("token_type")]
    fn get_token_type(&self, token: &EgldOrEsdtTokenIdentifier) -> SingleValueMapper<TokenType>;
}
