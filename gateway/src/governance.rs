multiversx_sc::imports!();

use crate::{events, tokens};
use core::ops::Deref;

#[multiversx_sc::module]
pub trait Governance: tokens::Tokens + events::Events {
    #[endpoint(transferGovernance)]
    fn transfer_governance(&self, new_governance: ManagedAddress) {
        self.only_governance();

        require!(!new_governance.is_zero(), "Invalid governance");

        self.transfer_governance_raw(new_governance);
    }

    #[endpoint(transferMintLimiter)]
    fn transfer_mint_limiter(&self, new_mint_limiter: ManagedAddress) {
        self.only_mint_limiter();

        require!(!new_mint_limiter.is_zero(), "Invalid mint limiter");

        self.transfer_mint_limiter_raw(new_mint_limiter);
    }

    #[endpoint(setTokenMintLimits)]
    fn set_token_mint_limits(
        &self,
        symbols: MultiValueManagedVecCounted<EgldOrEsdtTokenIdentifier>,
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
            let symbol: EgldOrEsdtTokenIdentifier = symbols_vec.get(index);
            let limit_ref: ManagedRef<BigUint> = limits_vec.get(index);

            // TODO: Should we implement `tokenAddresses` instead?
            require!(!self.token_type(&symbol).is_empty(), "Token does not exist");

            self.set_token_mint_limit(&symbol, limit_ref.deref());
        }
    }

    fn transfer_governance_raw(&self, new_governance: ManagedAddress) {
        self.governance().set(&new_governance);

        self.governance_transferred_event(self.governance().get(), new_governance);
    }

    fn transfer_mint_limiter_raw(&self, new_mint_limiter: ManagedAddress) {
        self.mint_limiter().set(&new_mint_limiter);

        self.mint_limiter_transferred_event(self.mint_limiter().get(), new_mint_limiter);
    }

    fn only_governance(&self) {
        let caller = self.blockchain().get_caller();

        require!(caller == self.governance().get(), "Not governance");
    }

    // @dev Reverts with an error if the sender is not the mint limiter or governance.
    fn only_mint_limiter(&self) {
        let caller = self.blockchain().get_caller();

        let mint_limiter = self.mint_limiter().get();
        let governance = self.governance().get();

        require!(
            caller == mint_limiter || caller == governance,
            "Not mint limiter"
        );
    }

    #[view(governance)]
    #[storage_mapper("governance")]
    fn governance(&self) -> SingleValueMapper<ManagedAddress>; // TODO: Nothing related to governance is used currently because native upgrades on MultiversX. Is this correct?

    #[view(mintLimiter)]
    #[storage_mapper("mint_limiter")]
    fn mint_limiter(&self) -> SingleValueMapper<ManagedAddress>;
}
