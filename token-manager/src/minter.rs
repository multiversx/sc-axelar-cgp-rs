multiversx_sc::imports!();

use operatable::roles::Roles;

#[multiversx_sc::module]
pub trait Minter: operatable::roles::AccountRoles {
    #[endpoint(transferMintership)]
    fn transfer_mintership(&self, minter: ManagedAddress) {
        self.only_minter();

        self.transfer_role(self.blockchain().get_caller(), minter, Roles::MINTER);
    }

    #[endpoint(proposeMintership)]
    fn propose_mintership(&self, minter: ManagedAddress) {
        self.only_minter();

        self.propose_role(
            self.blockchain().get_caller(),
            minter,
            Roles::MINTER,
        );
    }

    #[endpoint(acceptMintership)]
    fn accept_mintership(&self, from_minter: ManagedAddress) {
        self.accept_role(
            from_minter,
            self.blockchain().get_caller(),
            Roles::MINTER,
        );
    }

    fn add_minter(&self, minter: ManagedAddress) {
        self.add_role(minter, Roles::MINTER);
    }

    fn only_minter(&self) {
        self.only_role(Roles::MINTER);
    }

    #[view(isMinter)]
    fn is_minter(&self, address: &ManagedAddress) -> bool {
        self.has_role(address, Roles::MINTER)
    }
}
