use core::ops::Deref;

use token_manager::constants::{ManagedBufferAscii as _, TokenManagerType};

use crate::constants::{
    DeployApproval, Hash, InterchainTokenStatus, ManagedBufferAscii, TokenId, EGLD_DECIMALS,
    PREFIX_CANONICAL_TOKEN_SALT, PREFIX_CUSTOM_TOKEN_SALT, PREFIX_DEPLOY_APPROVAL,
    PREFIX_INTERCHAIN_TOKEN_SALT,
};
use crate::proxy_its::{
    ESDT_PROPERTIES_DECIMALS_BUFFER_INDEX, ESDT_PROPERTIES_TOKEN_NAME_INDEX,
    ESDT_PROPERTIES_TOKEN_TYPE_INDEX,
};
use crate::{address_tracker, events, executable, proxy_gmp, proxy_its, remote, user_functions};

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait FactoryModule:
    user_functions::UserFunctionsModule
    + proxy_gmp::ProxyGmpModule
    + proxy_its::ProxyItsModule
    + address_tracker::AddressTracker
    + events::EventsModule
    + remote::RemoteModule
    + multiversx_sc_modules::pause::PauseModule
    + executable::ExecutableModule
{
    // Needs to be payable because it issues ESDT token through the TokenManager
    #[payable("EGLD")]
    #[endpoint(deployInterchainToken)]
    fn deploy_interchain_token(
        &self,
        salt: Hash<Self::Api>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        initial_supply: BigUint,
        minter_opt: OptionalValue<ManagedAddress>,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();

        require!(
            name == name.to_normalized_token_name(),
            "Invalid token name"
        );
        require!(
            symbol == symbol.to_normalized_token_ticker(),
            "Invalid token symbol"
        );

        let sender = self.blockchain().get_caller();
        let deploy_salt = self.interchain_token_deploy_salt(&sender, &salt);

        let token_id = self.interchain_token_id_raw(&deploy_salt);

        let current_chain = ManagedBuffer::new();
        let own_address = self.blockchain().get_sc_address();

        let minter_bytes = if initial_supply > 0 {
            require!(
                self.interchain_token_status(&token_id).is_empty()
                    || self.interchain_token_status(&token_id).get()
                        == InterchainTokenStatus::NeedsMint,
                "Token already initialized"
            );

            self.interchain_token_status(&token_id)
                .set(InterchainTokenStatus::NeedsMint);

            own_address.as_managed_buffer().clone()
        } else if minter_opt.is_some() {
            let minter = minter_opt.clone().into_option().unwrap();

            require!(minter != own_address, "Invalid minter");
            require!(
                self.interchain_token_status(&token_id).is_empty()
                    || self.interchain_token_status(&token_id).get()
                        == InterchainTokenStatus::NoMint,
                "Token already initialized"
            );

            self.interchain_token_status(&token_id)
                .set(InterchainTokenStatus::NoMint);

            minter.as_managed_buffer().clone()
        } else {
            sc_panic!("Zero supply token");
        };

        let token_manager = self.get_opt_token_manager_address(&token_id);

        let egld_value = self.call_value().egld_value();

        // 1st transaction - deploy token manager
        if token_manager.is_none() {
            require!(
                egld_value.deref() == &BigUint::zero(),
                "Can not send EGLD payment if not issuing ESDT"
            );

            self.deploy_interchain_token_raw(
                deploy_salt,
                current_chain,
                name,
                symbol,
                decimals,
                minter_bytes.clone(),
                BigUint::zero(),
                sender,
            );

            return token_id;
        }

        let token_manager = token_manager.unwrap();

        // 2nd transaction - deploy token
        if self
            .token_manager_get_opt_token_identifier(token_manager.clone())
            .is_none()
        {
            self.deploy_interchain_token_raw(
                deploy_salt,
                current_chain,
                name,
                symbol,
                decimals,
                minter_bytes,
                egld_value.clone_value(),
                sender,
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

            let minter = minter_opt.into_option().unwrap_or(ManagedAddress::zero());

            self.token_manager_transfer_mintership(token_manager.clone(), minter.clone());
            self.token_manager_remove_flow_limiter(token_manager.clone(), own_address);

            // If minter is zero address, we still set it as a flow limiter for consistency with the remote token manager
            self.token_manager_add_flow_limiter(token_manager.clone(), minter.clone());

            self.token_manager_transfer_operatorship(token_manager, minter);

            self.interchain_token_status(&token_id)
                .set(InterchainTokenStatus::AlreadyMinted);
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
        let token_id = self.interchain_token_id(&deployer, &salt);

        self.check_token_minter(&token_id, &minter);

        require!(
            self.is_trusted_chain(&destination_chain),
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

        self.approved_destination_minters(&approval_key)
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
        let token_id = self.interchain_token_id(&deployer, &salt);

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

        self.approved_destination_minters(&approval_key).clear();
    }

    #[payable("EGLD")]
    #[endpoint(deployRemoteInterchainToken)]
    fn deploy_remote_interchain_token(
        &self,
        salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        self.deploy_remote_interchain_token_with_minter(
            salt,
            None,
            destination_chain,
            OptionalValue::None,
        )
    }

    // Payable with EGLD for cross chain calls gas
    #[payable("EGLD")]
    #[endpoint(deployRemoteInterchainTokenWithMinter)]
    fn deploy_remote_interchain_token_with_minter(
        &self,
        salt: Hash<Self::Api>,
        minter_opt: Option<ManagedAddress>,
        destination_chain: ManagedBuffer,
        destination_minter: OptionalValue<ManagedBuffer>,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();

        let sender = self.blockchain().get_caller();
        let deploy_salt = self.interchain_token_deploy_salt(&sender, &salt);

        let mut destination_minter_raw = ManagedBuffer::new();

        if let Some(minter) = minter_opt {
            let deployed_token_id = self.interchain_token_id_raw(&deploy_salt);

            self.check_token_minter(&deployed_token_id, &minter);

            // Sanity check to prevent accidental use of the current ITS address as the destination minter
            require!(
                minter != self.blockchain().get_sc_address(),
                "Invalid minter"
            );

            if let OptionalValue::Some(destination_minter) = destination_minter {
                let approval = DeployApproval {
                    minter,
                    token_id: deployed_token_id.clone(),
                    destination_chain: destination_chain.clone(),
                };

                self.use_deploy_approval(approval, destination_minter.clone());

                destination_minter_raw = destination_minter;
            }
        } else {
            // If a destinationMinter is provided, the minter must not be zero address
            require!(destination_minter.is_none(), "Invalid minter");
        }

        self.deploy_remote_interchain_token_raw(
            deploy_salt,
            destination_chain,
            destination_minter_raw,
            sender,
        )
    }

    #[endpoint(registerCanonicalInterchainToken)]
    fn register_canonical_interchain_token(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
    ) -> TokenId<Self::Api> {
        require!(token_identifier.is_valid(), "Invalid token identifier");

        let deploy_salt = self.canonical_interchain_token_deploy_salt(token_identifier.clone());

        // No custom operator is set for canonical token registration
        let link_params = ManagedBuffer::new();

        self.register_custom_token_raw(
            deploy_salt,
            token_identifier,
            TokenManagerType::LockUnlock,
            link_params,
        )
    }

    // Payable with EGLD for cross chain calls gas
    #[payable("EGLD")]
    #[endpoint(deployRemoteCanonicalInterchainToken)]
    fn deploy_remote_canonical_interchain_token(
        &self,
        original_token_identifier: EgldOrEsdtTokenIdentifier,
        destination_chain: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();

        require!(
            original_token_identifier.is_valid(),
            "Invalid token identifier"
        );

        let minter = ManagedBuffer::new(); // No additional minter is set on a canonical token deployment
        let deploy_salt = self.canonical_interchain_token_deploy_salt(original_token_identifier);

        self.deploy_remote_interchain_token_raw(
            deploy_salt,
            destination_chain,
            minter,
            self.blockchain().get_caller(),
        )
    }

    #[endpoint(registerCustomToken)]
    fn register_custom_token(
        &self,
        salt: Hash<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        token_manager_type: TokenManagerType,
        operator_opt: OptionalValue<ManagedAddress>,
    ) -> TokenId<Self::Api> {
        require!(token_identifier.is_valid(), "Invalid token identifier");

        let deploy_salt = self.linked_token_deploy_salt(&self.blockchain().get_caller(), &salt);
        let mut link_params = ManagedBuffer::new();

        if let Some(operator) = operator_opt.into_option() {
            link_params.append(operator.as_managed_buffer());
        }

        self.register_custom_token_raw(
            deploy_salt,
            token_identifier,
            token_manager_type,
            link_params,
        )
    }

    // Payable with EGLD for cross chain calls gas
    #[payable("EGLD")]
    #[endpoint(linkToken)]
    fn link_token(
        &self,
        salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_token_address: ManagedBuffer,
        token_manager_type: TokenManagerType,
        link_params: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        let deploy_salt = self.linked_token_deploy_salt(&self.blockchain().get_caller(), &salt);

        let gas_value = self.call_value().egld_value().clone_value();

        self.link_token_raw(
            deploy_salt,
            destination_chain,
            destination_token_address,
            token_manager_type,
            link_params,
            gas_value,
        )
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
            !self.approved_destination_minters(&approval_key).is_empty()
                && self.approved_destination_minters(&approval_key).take()
                    == destination_minter_hash,
            "Remote deployment not approved"
        );
    }

    fn check_token_minter(&self, token_id: &Hash<Self::Api>, minter: &ManagedAddress) {
        let token_manager = self.get_opt_token_manager_address(token_id);

        require!(
            token_manager.is_some() && self.token_manager_is_minter(token_manager.unwrap(), minter),
            "Not minter"
        );
    }

    fn deploy_remote_interchain_token_raw(
        &self,
        deploy_salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_minter: ManagedBuffer,
        sender: ManagedAddress,
    ) -> TokenId<Self::Api> {
        // Ensure that a token is registered locally for the tokenId before allowing a remote deployment
        let expected_token_id = self.interchain_token_id_raw(&deploy_salt);
        let token_identifier = self.registered_token_identifier(&expected_token_id);

        require!(token_identifier.is_valid(), "Invalid token identifier");

        let gas_value = self.call_value().egld_value().clone_value();

        // We can only fetch token properties from esdt contract if it is not EGLD token
        if token_identifier.is_egld() {
            self.deploy_interchain_token_raw(
                deploy_salt,
                destination_chain,
                token_identifier.clone().into_name(),
                token_identifier.into_name(),
                EGLD_DECIMALS,
                destination_minter,
                gas_value,
                sender,
            );

            return expected_token_id;
        }

        let token_identifier = token_identifier.unwrap_esdt();

        let token_symbol = token_identifier.ticker();

        require!(
            self.chain_name().get() != destination_chain,
            "Cannot deploy remotely to self",
        );
        require!(self.is_trusted_chain(&destination_chain), "Untrusted chain");

        self.esdt_get_token_properties(
            token_identifier,
            <Self as FactoryModule>::callbacks(self).deploy_remote_token_callback(
                deploy_salt,
                destination_chain,
                token_symbol,
                destination_minter,
                gas_value,
                sender,
            ),
        );

        expected_token_id
    }

    #[view(interchainTokenDeploySalt)]
    fn interchain_token_deploy_salt(
        &self,
        deployer: &ManagedAddress,
        salt: &Hash<Self::Api>,
    ) -> Hash<Self::Api> {
        let prefix_interchain_token_salt = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_INTERCHAIN_TOKEN_SALT));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_interchain_token_salt.as_managed_buffer());
        encoded.append(self.chain_name_hash().get().as_managed_buffer());
        encoded.append(deployer.as_managed_buffer());
        encoded.append(salt.as_managed_buffer());

        self.crypto().keccak256(encoded)
    }

    #[view(canonicalInterchainTokenDeploySalt)]
    fn canonical_interchain_token_deploy_salt(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
    ) -> Hash<Self::Api> {
        let prefix_canonical_token_salt = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_CANONICAL_TOKEN_SALT));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_canonical_token_salt.as_managed_buffer());
        encoded.append(self.chain_name_hash().get().as_managed_buffer());
        encoded.append(&token_identifier.into_name());

        self.crypto().keccak256(encoded)
    }

    #[view(linkedTokenDeploySalt)]
    fn linked_token_deploy_salt(
        &self,
        deployer: &ManagedAddress,
        salt: &Hash<Self::Api>,
    ) -> Hash<Self::Api> {
        let prefix_custom_token_salt = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_CUSTOM_TOKEN_SALT));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_custom_token_salt.as_managed_buffer());
        encoded.append(self.chain_name_hash().get().as_managed_buffer());
        encoded.append(deployer.as_managed_buffer());
        encoded.append(salt.as_managed_buffer());

        self.crypto().keccak256(encoded)
    }

    #[view(interchainTokenId)]
    fn interchain_token_id(
        &self,
        deployer: &ManagedAddress,
        salt: &Hash<Self::Api>,
    ) -> TokenId<Self::Api> {
        let deploy_salt = self.interchain_token_deploy_salt(deployer, salt);

        self.interchain_token_id_raw(&deploy_salt)
    }

    #[view(canonicalInterchainTokenId)]
    fn canonical_interchain_token_id(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
    ) -> TokenId<Self::Api> {
        let deploy_salt = self.canonical_interchain_token_deploy_salt(token_identifier);

        self.interchain_token_id_raw(&deploy_salt)
    }

    #[view(linkedTokenId)]
    fn linked_token_id(
        &self,
        deployer: &ManagedAddress,
        salt: &Hash<Self::Api>,
    ) -> TokenId<Self::Api> {
        let deploy_salt = self.linked_token_deploy_salt(deployer, salt);

        self.interchain_token_id_raw(&deploy_salt)
    }

    #[view(chainNameHash)]
    #[storage_mapper("chain_name_hash")]
    fn chain_name_hash(&self) -> SingleValueMapper<Hash<Self::Api>>;

    #[view(approvedDestinationMinters)]
    #[storage_mapper("approved_destination_minters")]
    fn approved_destination_minters(
        &self,
        approval_key: &Hash<Self::Api>,
    ) -> SingleValueMapper<Hash<Self::Api>>;

    #[view(interchainTokenStatus)]
    #[storage_mapper("interchain_token_status")]
    fn interchain_token_status(
        &self,
        token_id: &TokenId<Self::Api>,
    ) -> SingleValueMapper<InterchainTokenStatus>;

    // This was tested on devnet and worked fine
    #[callback]
    fn deploy_remote_token_callback(
        &self,
        deploy_salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
        token_symbol: ManagedBuffer,
        destination_minter: ManagedBuffer,
        gas_value: BigUint,
        caller: ManagedAddress,
        #[call_result] result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(values) => {
                // Send back paid gas value to initial caller in case chain is no longer trusted
                if !self.is_trusted_chain(&destination_chain) {
                    self.send().direct_non_zero_egld(&caller, &gas_value);
                    return;
                }

                let vec: ManagedVec<ManagedBuffer> = values.into_vec_of_buffers();

                let token_name = vec.get(ESDT_PROPERTIES_TOKEN_NAME_INDEX).clone_value();
                let token_type = vec.get(ESDT_PROPERTIES_TOKEN_TYPE_INDEX);
                let decimals_buffer_ref = vec.get(ESDT_PROPERTIES_DECIMALS_BUFFER_INDEX);

                if token_type.deref() != EsdtTokenType::Fungible.as_type_name() {
                    // Send back paid cross chain gas value to initial caller if token is non fungible
                    self.send().direct_non_zero_egld(&caller, &gas_value);

                    return;
                }

                let decimals_buffer = decimals_buffer_ref.deref();
                // num decimals is in format string NumDecimals-DECIMALS
                // skip `NumDecimals-` part and convert to number
                let token_decimals_buf: ManagedBuffer = decimals_buffer
                    .copy_slice(12, decimals_buffer.len() - 12)
                    .unwrap();
                let token_decimals = token_decimals_buf.ascii_to_u8();

                self.deploy_interchain_token_raw(
                    deploy_salt,
                    destination_chain,
                    token_name,
                    token_symbol,
                    token_decimals,
                    destination_minter,
                    gas_value,
                    caller,
                );
            }
            ManagedAsyncCallResult::Err(_) => {
                // Send back paid gas value to initial caller
                self.send().direct_non_zero_egld(&caller, &gas_value);
            }
        }
    }
}
