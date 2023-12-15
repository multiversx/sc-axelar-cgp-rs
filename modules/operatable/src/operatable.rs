#![no_std]

multiversx_sc::imports!();

pub mod roles;

use roles::Roles;

#[multiversx_sc::module]
pub trait Operatable: roles::AccountRoles {
    #[endpoint(transferOperatorship)]
    fn transfer_operatorship(&self, operator: ManagedAddress) {
        self.only_operator();

        self.transfer_account_roles(self.blockchain().get_caller(), operator, Roles::OPERATOR);
    }

    #[endpoint(proposeOperatorship)]
    fn propose_operatorship(&self, operator: ManagedAddress) {
        self.only_operator();

        self.propose_account_roles(self.blockchain().get_caller(), operator, Roles::OPERATOR);
    }

    #[endpoint(acceptOperatorship)]
    fn accept_operatorship(&self, from_operator: ManagedAddress) {
        self.accept_account_roles(
            from_operator,
            self.blockchain().get_caller(),
            Roles::OPERATOR,
        );
    }

    fn add_operator(&self, operator: ManagedAddress) {
        self.add_account_roles(operator, Roles::OPERATOR);
    }

    fn only_operator(&self) {
        self.only_role(Roles::OPERATOR);
    }

    fn is_operator(&self, address: &ManagedAddress) -> bool {
        self.has_role(address, Roles::OPERATOR)
    }
}
