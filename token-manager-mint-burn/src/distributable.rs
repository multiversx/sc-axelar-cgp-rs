multiversx_sc::imports!();

use operatable::roles::Roles;

#[multiversx_sc::module]
pub trait Distributable: operatable::roles::AccountRoles {
    #[endpoint(transferDistributorship)]
    fn transfer_distributorship(&self, distributor: ManagedAddress) {
        self.only_distributor();

        self.transfer_account_roles(self.blockchain().get_caller(), distributor, Roles::DISTRIBUTOR);
    }

    #[endpoint(proposeDistributorship)]
    fn propose_distributorship(&self, distributor: ManagedAddress) {
        self.only_distributor();

        self.propose_account_roles(self.blockchain().get_caller(), distributor, Roles::DISTRIBUTOR);
    }

    #[endpoint(acceptDistributorship)]
    fn accept_distributorship(&self, from_distributor: ManagedAddress) {
        self.accept_account_roles(
            from_distributor,
            self.blockchain().get_caller(),
            Roles::DISTRIBUTOR,
        );
    }

    fn add_distributor(&self, distributor: ManagedAddress) {
        self.add_account_roles(distributor, Roles::DISTRIBUTOR);
    }

    fn only_distributor(&self) {
        self.only_role(Roles::DISTRIBUTOR);
    }

    fn is_distributor(&self, address: &ManagedAddress) -> bool {
        self.has_role(address, Roles::DISTRIBUTOR)
    }
}
