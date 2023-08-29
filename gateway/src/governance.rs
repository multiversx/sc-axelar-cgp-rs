multiversx_sc::imports!();

use core::ops::Deref;
use crate::{events, tokens};

#[multiversx_sc::module]
pub trait Governance: tokens::Tokens + events::Events {
    #[endpoint(transferMintLimiter)]
    fn transfer_mint_limiter(&self, new_mint_limiter: ManagedAddress) {
        self.only_mint_limiter();

        require!(!new_mint_limiter.is_zero(), "Invalid mint limiter");

        self.transfer_mint_limiter_raw(new_mint_limiter);
    }

    #[endpoint(setTokenMintLimits)]
    fn set_token_mint_limits(
        &self,
        symbols: MultiValueManagedVecCounted<ManagedBuffer>,
        limits: MultiValueManagedVecCounted<BigUint>,
    ) {
        self.only_mint_limiter();

        let symbols_vec = symbols.into_vec();
        let limits_vec = limits.into_vec();

        require!(
            symbols_vec.len() == limits_vec.len(),
            "Invalid set mint limits params"
        );

        for index in 0..symbols_vec.len() {
            let symbol_ref: ManagedRef<ManagedBuffer> = symbols_vec.get(index);
            let symbol = symbol_ref.deref();
            let limit_ref: ManagedRef<BigUint> = limits_vec.get(index);

            let supported_token_mapper = self.supported_tokens(&symbol);

            require!(!supported_token_mapper.is_empty(), "Token does not exist");

            let limit = limit_ref.clone_value();

            self.token_mint_limit_updated_event(&symbol, &limit);

            supported_token_mapper.update(|v| v.mint_limit = limit);
        }
    }

    fn transfer_mint_limiter_raw(&self, new_mint_limiter: ManagedAddress) {
        self.mint_limiter().set(&new_mint_limiter);

        self.mint_limiter_transferred_event(self.mint_limiter().get(), new_mint_limiter);
    }

    // @dev Reverts with an error if the sender is not the mint limiter or governance.
    fn only_mint_limiter(&self) {
        let caller = self.blockchain().get_caller();
        let owner = self.blockchain().get_owner_address();

        let mint_limiter = self.mint_limiter().get();

        require!(
            caller == mint_limiter || caller == owner,
            "Not mint limiter"
        );
    }

    #[view(mintLimiter)]
    #[storage_mapper("mint_limiter")]
    fn mint_limiter(&self) -> SingleValueMapper<ManagedAddress>;
}
