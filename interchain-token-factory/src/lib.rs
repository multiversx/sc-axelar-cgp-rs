#![no_std]

use core::ops::Deref;

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use token_manager::constants::{DeployTokenManagerParams, TokenManagerType};

use crate::constants::{
    DeployApproval, Hash, TokenId, PREFIX_CANONICAL_TOKEN_SALT, PREFIX_DEPLOY_APPROVAL,
    PREFIX_INTERCHAIN_TOKEN_SALT,
};
use crate::proxy::CallbackProxy as _;

multiversx_sc::imports!();

pub mod constants;
pub mod events;
pub mod proxy;

#[multiversx_sc::contract]
pub trait InterchainTokenFactoryContract: proxy::ProxyModule + events::EventsModule {
    #[init]
    fn init(&self, interchain_token_service: ManagedAddress) {
        require!(!interchain_token_service.is_zero(), "Zero address");
        require!(
            self.blockchain()
                .is_smart_contract(&interchain_token_service),
            "Not a smart contract address"
        );

        self.interchain_token_service()
            .set_if_empty(&interchain_token_service);

        self.chain_name_hash()
            .set_if_empty(self.crypto().keccak256(&self.its_chain_name()));
    }

    #[upgrade]
    fn upgrade(&self) {}

    // Needs to be payable because it issues ESDT token through the TokenManager
    #[payable("*")]
    #[endpoint(deployInterchainToken)]
    fn deploy_interchain_token(
        &self,
        salt: Hash<Self::Api>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        initial_supply: BigUint,
        minter: ManagedAddress,
    ) -> TokenId<Self::Api> {
        let sender = self.blockchain().get_caller();
        let salt = self.interchain_token_salt(&self.chain_name_hash().get(), &sender, &salt);

        let own_address = self.blockchain().get_sc_address();

        let mut minter_bytes = &ManagedBuffer::new();

        if initial_supply > 0 {
            minter_bytes = own_address.as_managed_buffer()
        } else if !minter.is_zero() {
            require!(
                minter != self.interchain_token_service().get(),
                "Invalid minter"
            );

            minter_bytes = minter.as_managed_buffer()
        };

        let token_id = self.its_interchain_token_id(&ManagedAddress::zero(), &salt);
        let token_manager = self.its_invalid_token_manager_address(&token_id);

        let egld_value = self.call_value().egld_value();

        // 1st transaction - deploy token manager
        // 2nd transaction - deploy token
        if token_manager.is_zero()
            || self
                .token_manager_invalid_token_identifier(token_manager.clone())
                .is_none()
        {
            let gas_value = if token_manager.is_zero() {
                require!(
                    egld_value.deref() == &BigUint::zero(),
                    "Can not send EGLD payment if not issuing ESDT"
                );

                BigUint::zero()
            } else {
                egld_value.clone_value()
            };

            self.its_deploy_interchain_token(
                salt,
                ManagedBuffer::new(),
                name,
                symbol,
                decimals,
                minter_bytes,
                gas_value,
            );

            return token_id;
        }

        require!(
            egld_value.deref() == &BigUint::zero(),
            "Can not send EGLD payment if not issuing ESDT"
        );

        // 3rd transaction - mint token if needed
        if initial_supply > 0 {
            self.token_manager_mint(token_manager.clone(), sender, initial_supply);

            self.token_manager_transfer_mintership(token_manager.clone(), minter.clone());
            self.token_manager_remove_flow_limiter(token_manager.clone(), own_address);

            // If minter is zero address, we still set it as a flow limiter for consistency with the remote token manager
            self.token_manager_add_flow_limiter(token_manager.clone(), minter.clone());

            self.token_manager_transfer_operatorship(token_manager, minter);
        }

        token_id
    }

    #[endpoint(approveDeployRemoteInterchainToken)]
    fn approve_deploy_remote_interchain_token(
        &self,
        deployer: ManagedAddress,
        salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_minter: ManagedBuffer,
    ) {
        let minter = self.blockchain().get_caller();
        let token_id = self.its_interchain_token_id(&deployer, &salt);
        let token_manager = self.its_invalid_token_manager_address(&token_id);

        require!(
            self.token_manager_is_minter(token_manager, &minter),
            "Invalid minter"
        );

        require!(
            !self.its_trusted_address(&destination_chain).is_empty(),
            "Invalid chain name"
        );

        self.deploy_remote_interchain_token_approval_event(
            &minter,
            &deployer,
            &token_id,
            &destination_chain,
            &destination_minter,
        );

        let approval_key = self.deploy_approval_key(DeployApproval {
            minter,
            token_id,
            destination_chain,
        });

        let destination_minter_hash = self.crypto().keccak256(destination_minter);

        self.approved_destination_minters(approval_key)
            .set(destination_minter_hash);
    }

    #[endpoint(revokeDeployRemoteInterchainToken)]
    fn revoke_deploy_remote_interchain_token(
        &self,
        deployer: ManagedAddress,
        salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
    ) {
        let minter = self.blockchain().get_caller();
        let token_id = self.its_interchain_token_id(&deployer, &salt);

        self.revoked_deploy_remote_interchain_token_approval_event(
            &minter,
            &deployer,
            &token_id,
            &destination_chain,
        );

        let approval_key = self.deploy_approval_key(DeployApproval {
            minter,
            token_id,
            destination_chain,
        });

        self.approved_destination_minters(approval_key).clear();
    }

    #[payable("EGLD")]
    #[endpoint(deployRemoteInterchainToken)]
    fn deploy_remote_interchain_token(
        &self,
        salt: Hash<Self::Api>,
        minter: ManagedAddress,
        destination_chain: ManagedBuffer,
        destination_minter: OptionalValue<ManagedBuffer>,
    ) -> TokenId<Self::Api> {
        let mut minter_raw = ManagedBuffer::new();

        let sender = self.blockchain().get_caller();
        let salt = self.interchain_token_salt(&self.chain_name_hash().get(), &sender, &salt);
        let token_id = self.its_interchain_token_id(&ManagedAddress::zero(), &salt);

        let token_manager = self.its_deployed_token_manager(&token_id);

        if !minter.is_zero() {
            require!(
                self.token_manager_is_minter(token_manager.clone(), &minter),
                "Not minter"
            );

            // Sanity check to prevent accidental use of the current ITS address as the destination minter
            require!(
                minter != self.interchain_token_service().get(),
                "Invalid minter"
            );

            if let OptionalValue::Some(destination_minter) = destination_minter {
                let approval = DeployApproval {
                    minter,
                    token_id: token_id.clone(),
                    destination_chain: destination_chain.clone(),
                };

                self.use_deploy_approval(approval, destination_minter.clone());

                minter_raw = destination_minter;
            } else {
                minter_raw = minter.as_managed_buffer().clone();
            }
        } else {
            // If a destinationMinter is provided, the minter must not be zero address
            require!(destination_minter.is_none(), "Invalid minter");
        }

        self.deploy_remote_interchain_token_raw(
            destination_chain,
            &minter_raw,
            sender,
            salt,
            token_manager,
        );

        token_id
    }

    #[endpoint(registerCanonicalInterchainToken)]
    fn register_canonical_interchain_token(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
    ) -> TokenId<Self::Api> {
        require!(token_identifier.is_valid(), "Invalid token identifier");

        let mut params = ManagedBuffer::new();

        DeployTokenManagerParams {
            operator: None,
            token_identifier: Some(token_identifier.clone()),
        }
        .top_encode(&mut params)
        .unwrap();

        let salt =
            self.canonical_interchain_token_salt(&self.chain_name_hash().get(), token_identifier);

        self.its_deploy_token_manager(
            salt,
            ManagedBuffer::new(),
            TokenManagerType::LockUnlock,
            params,
            BigUint::zero(),
        )
    }

    #[payable("EGLD")]
    #[endpoint(deployRemoteCanonicalInterchainToken)]
    fn deploy_remote_canonical_interchain_token(
        &self,
        original_token_identifier: EgldOrEsdtTokenIdentifier,
        destination_chain: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        require!(
            original_token_identifier.is_valid(),
            "Invalid token identifier"
        );

        let salt = self.canonical_interchain_token_salt(
            &self.chain_name_hash().get(),
            original_token_identifier,
        );
        let token_id = self.its_interchain_token_id(&ManagedAddress::zero(), &salt);

        let token_manager = self.its_deployed_token_manager(&token_id);

        let minter = ManagedBuffer::new(); // No additional minter is set on a canonical token deployment

        self.deploy_remote_interchain_token_raw(
            destination_chain,
            &minter,
            self.blockchain().get_caller(),
            salt,
            token_manager,
        );

        token_id
    }

    fn deploy_approval_key(&self, approval: DeployApproval<Self::Api>) -> Hash<Self::Api> {
        let prefix_deploy_approval = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_DEPLOY_APPROVAL));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_deploy_approval.as_managed_buffer());

        approval
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode approval"));

        self.crypto().keccak256(encoded)
    }

    fn use_deploy_approval(
        &self,
        approval: DeployApproval<Self::Api>,
        destination_minter: ManagedBuffer,
    ) {
        let approval_key = self.deploy_approval_key(approval);

        let destination_minter_hash = self.crypto().keccak256(destination_minter);

        require!(
            self.approved_destination_minters(approval_key).take() == destination_minter_hash,
            "Remote deployment not approved"
        );
    }

    fn deploy_remote_interchain_token_raw(
        &self,
        destination_chain: ManagedBuffer,
        minter_raw: &ManagedBuffer,
        sender: ManagedAddress,
        salt: Hash<Self::Api>,
        token_manager: ManagedAddress,
    ) {
        let token_identifier = self.token_manager_token_identifier(token_manager);

        let gas_value = self.call_value().egld_value().clone_value();

        // We can only fetch token properties from esdt contract if it is not EGLD token
        if token_identifier.is_egld() {
            self.its_deploy_interchain_token(
                salt,
                destination_chain,
                token_identifier.clone().into_name(),
                token_identifier.into_name(),
                18, // EGLD token has 18 decimals
                minter_raw,
                gas_value,
            );

            return;
        }

        let token_identifier_name = token_identifier.clone().into_name();
        // Leave the symbol be the beginning of the indentifier before `-`
        let token_symbol = token_identifier_name
            .copy_slice(0, token_identifier_name.len() - 7)
            .unwrap();

        self.esdt_get_token_properties(
            token_identifier,
            self.callbacks().deploy_remote_token_callback(
                salt,
                destination_chain,
                token_symbol,
                minter_raw,
                gas_value,
                sender,
            ),
        );
    }

    #[view(interchainTokenSalt)]
    fn interchain_token_salt(
        &self,
        chain_name_hash: &Hash<Self::Api>,
        deployer: &ManagedAddress,
        salt: &Hash<Self::Api>,
    ) -> Hash<Self::Api> {
        let prefix_interchain_token_salt = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_INTERCHAIN_TOKEN_SALT));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_interchain_token_salt.as_managed_buffer());
        encoded.append(chain_name_hash.as_managed_buffer());
        encoded.append(deployer.as_managed_buffer());
        encoded.append(salt.as_managed_buffer());

        self.crypto().keccak256(encoded)
    }

    #[view(canonicalInterchainTokenSalt)]
    fn canonical_interchain_token_salt(
        &self,
        chain_name_hash: &Hash<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
    ) -> Hash<Self::Api> {
        let prefix_canonical_token_salt = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_CANONICAL_TOKEN_SALT));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_canonical_token_salt.as_managed_buffer());
        encoded.append(chain_name_hash.as_managed_buffer());
        encoded.append(&token_identifier.into_name());

        self.crypto().keccak256(encoded)
    }

    #[view(interchainTokenId)]
    fn interchain_token_id(
        &self,
        deployer: &ManagedAddress,
        salt: &Hash<Self::Api>,
    ) -> TokenId<Self::Api> {
        self.its_interchain_token_id(
            &ManagedAddress::zero(),
            &self.interchain_token_salt(&self.chain_name_hash().get(), deployer, salt),
        )
    }

    #[view(canonicalInterchainTokenId)]
    fn canonical_interchain_token_id(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
    ) -> TokenId<Self::Api> {
        self.its_interchain_token_id(
            &ManagedAddress::zero(),
            &self.canonical_interchain_token_salt(&self.chain_name_hash().get(), token_identifier),
        )
    }

    // interchainTokenAddress - not implemented

    #[view(chainNameHash)]
    #[storage_mapper("chain_name_hash")]
    fn chain_name_hash(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[view(approvedDestinationMinters)]
    #[storage_mapper("approved_destination_minters")]
    fn approved_destination_minters(
        &self,
        approval_key: Hash<Self::Api>,
    ) -> SingleValueMapper<Hash<Self::Api>>;
}
