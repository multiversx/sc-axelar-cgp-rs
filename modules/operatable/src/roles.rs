multiversx_sc::imports!();

use bitflags::bitflags;
bitflags! {
    #[derive(PartialEq, Copy, Clone)]
    pub struct Roles: u32 {
        const MINTER = 0b00000001;
        const OPERATOR = 0b00000010;
        const FLOW_LIMITER = 0b00000100;
    }
}

impl TopEncode for Roles {
    fn top_encode<O>(&self, output: O) -> Result<(), multiversx_sc::codec::EncodeError>
    where
        O: multiversx_sc::codec::TopEncodeOutput,
    {
        u32::top_encode(&self.bits(), output)
    }
}

impl TopDecode for Roles {
    fn top_decode<I>(input: I) -> Result<Self, multiversx_sc::codec::DecodeError>
    where
        I: multiversx_sc::codec::TopDecodeInput,
    {
        let bits = u32::top_decode(input)?;
        Roles::from_bits(bits).ok_or(DecodeError::INVALID_VALUE)
    }
}

impl TypeAbi for Roles {
    fn type_name() -> multiversx_sc::abi::TypeName {
        core::any::type_name::<u32>().into()
    }
}

#[multiversx_sc::module]
pub trait AccountRoles {
    fn only_role(&self, roles: Roles) {
        let caller = self.blockchain().get_caller();
        let caller_roles = self.account_roles(&caller).get();

        require!(caller_roles.intersects(roles), "Missing any of roles");
    }

    fn with_every_role(&self, roles: Roles) {
        let caller = self.blockchain().get_caller();
        let caller_roles = self.account_roles(&caller).get();

        require!(caller_roles.contains(roles), "Missing all roles");
    }

    fn has_role(&self, address: &ManagedAddress, roles: Roles) -> bool {
        if self.account_roles(address).is_empty() {
            return false;
        }

        let caller_roles = self.account_roles(address).get();

        caller_roles.intersects(roles)
    }

    fn set_proposed_roles(
        &self,
        from_address: ManagedAddress,
        to_address: ManagedAddress,
        proposed_roles: Roles,
    ) {
        self.proposed_roles(&from_address, &to_address)
            .set(proposed_roles);
    }

    fn add_role(&self, address: ManagedAddress, new_roles: Roles) {
        self.roles_added_event(&address, new_roles);

        self.account_roles(&address).update(|roles| {
            roles.insert(new_roles);
        });
    }

    fn remove_role(&self, address: ManagedAddress, new_roles: Roles) {
        self.roles_removed_event(&address, new_roles);

        self.account_roles(&address).update(|roles| {
            roles.remove(new_roles);
        });
    }

    fn propose_role(
        &self,
        from_address: ManagedAddress,
        to_address: ManagedAddress,
        proposed_roles: Roles,
    ) {
        let from_roles = self.account_roles(&from_address).get();

        require!(from_roles.contains(proposed_roles), "Missing all roles");

        self.roles_proposed_event(&from_address, &to_address, proposed_roles);

        self.set_proposed_roles(from_address, to_address, proposed_roles);
    }

    fn accept_role(
        &self,
        from_address: ManagedAddress,
        to_address: ManagedAddress,
        proposed_roles: Roles,
    ) {
        let proposed_roles_mapper = self.proposed_roles(&from_address, &to_address);

        require!(
            !proposed_roles_mapper.is_empty() && proposed_roles_mapper.get() == proposed_roles,
            "Invalid proposed roles"
        );

        proposed_roles_mapper.clear();

        self.transfer_role(from_address, to_address, proposed_roles);
    }

    fn transfer_role(
        &self,
        from_address: ManagedAddress,
        to_address: ManagedAddress,
        roles: Roles,
    ) {
        let from_roles = self.account_roles(&from_address).get();

        require!(from_roles.contains(roles), "Missing all roles");

        self.remove_role(from_address, roles);
        self.add_role(to_address, roles);
    }

    #[view(getAccountRoles)]
    #[storage_mapper("account_roles")]
    fn account_roles(&self, address: &ManagedAddress) -> SingleValueMapper<Roles>;

    #[view(getProposedRoles)]
    #[storage_mapper("proposed_roles")]
    fn proposed_roles(
        &self,
        from_address: &ManagedAddress,
        to_address: &ManagedAddress,
    ) -> SingleValueMapper<Roles>;

    #[event("roles_proposed_event")]
    fn roles_proposed_event(
        &self,
        #[indexed] from_address: &ManagedAddress,
        #[indexed] to_address: &ManagedAddress,
        roles: Roles,
    );

    #[event("roles_added_event")]
    fn roles_added_event(&self, #[indexed] address: &ManagedAddress, roles: Roles);

    #[event("roles_removed_event")]
    fn roles_removed_event(&self, #[indexed] address: &ManagedAddress, roles: Roles);
}
