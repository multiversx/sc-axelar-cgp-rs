use crate::events;

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait OperatorModule: events::Events {
    #[endpoint(transferOperatorship)]
    fn transfer_operatorship(&self, new_operator: ManagedAddress) {
        self.only_operator_or_owner();

        require!(!new_operator.is_zero(), "Invalid operator");

        self.transfer_operatorship_raw(new_operator);
    }

    fn only_operator_or_owner(&self) {
        let caller = self.blockchain().get_caller();

        require!(
            caller == self.operator().get() || caller == self.blockchain().get_owner_address(),
            "Invalid sender"
        );
    }

    fn transfer_operatorship_raw(&self, new_operator: ManagedAddress) {
        self.operator().set(&new_operator);

        self.operatorship_transferred_event(new_operator);
    }

    #[view(operator)]
    #[storage_mapper("operator")]
    fn operator(&self) -> SingleValueMapper<ManagedAddress>;
}
