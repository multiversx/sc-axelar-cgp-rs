#![no_std]

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait Operatable {
    #[endpoint]
    fn transfer_operatorship(&self, operator: ManagedAddress) {
        self.only_operator();

        self.set_operator(operator);
    }

    #[endpoint]
    fn propose_operatorship(&self, operator: ManagedAddress) {
        self.only_operator();

        self.operator_change_proposed_event(&operator);

        self.proposed_operator().set(operator);
    }

    #[endpoint]
    fn accept_operatorship(&self) {
        let caller = self.blockchain().get_caller();

        require!(
            caller == self.proposed_operator().take(),
            "Not proposed operator"
        );

        self.set_operator(caller);
    }

    fn set_operator(&self, operator: ManagedAddress) {
        self.operatorship_transferred_event(&operator);

        self.operator().set(operator);
    }

    fn only_operator(&self) {
        require!(
            self.blockchain().get_caller() == self.operator().get(),
            "Not operator"
        );
    }

    #[view]
    #[storage_mapper("operator")]
    fn operator(&self) -> SingleValueMapper<ManagedAddress>;

    #[view]
    #[storage_mapper("proposed_operator")]
    fn proposed_operator(&self) -> SingleValueMapper<ManagedAddress>;

    #[event("operatorship_transferred_event")]
    fn operatorship_transferred_event(&self, operator: &ManagedAddress);

    #[event("operator_change_proposed_event")]
    fn operator_change_proposed_event(&self, operator: &ManagedAddress);
}
