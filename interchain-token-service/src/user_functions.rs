multiversx_sc::imports!();

use core::convert::TryFrom;
use core::ops::Deref;

use token_manager::constants::TokenManagerType;

use crate::abi::AbiEncodeDecode;
use crate::abi_types::LinkTokenPayload;
use crate::constants::{
    Hash, MetadataVersion, TokenId, TransferAndGasTokens, ESDT_EGLD_IDENTIFIER,
    MESSAGE_TYPE_LINK_TOKEN, PREFIX_INTERCHAIN_TOKEN_ID,
};
use crate::{address_tracker, events, executable, proxy_gmp, proxy_its, remote};

#[multiversx_sc::module]
pub trait UserFunctionsModule:
    proxy_gmp::ProxyGmpModule
    + proxy_its::ProxyItsModule
    + address_tracker::AddressTracker
    + events::EventsModule
    + remote::RemoteModule
    + multiversx_sc_modules::pause::PauseModule
    + executable::ExecutableModule
{
    #[payable("EGLD")]
    #[endpoint(registerTokenMetadata)]
    fn register_token_metadata(&self, token_identifier: TokenIdentifier) {
        require!(
            token_identifier.is_valid_esdt_identifier(),
            "Invalid token identifier"
        );

        let gas_value = self.call_value().egld_value().clone_value();

        self.register_token_metadata_async_call(token_identifier, gas_value);
    }

    #[endpoint(registerCustomToken)]
    fn register_custom_token(
        &self,
        salt: Hash<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        token_manager_type: TokenManagerType,
        link_params: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();
        self.only_token_factory();

        // Custom token managers can't be deployed with native interchain token type, which is reserved for interchain tokens
        require!(
            token_manager_type != TokenManagerType::NativeInterchainToken,
            "Can not deploy native interchain token"
        );

        let deployer = ManagedAddress::zero();

        let token_id = self.interchain_token_id(&deployer, &salt);

        self.interchain_token_id_claimed_event(&token_id, &deployer, &salt);

        self.deploy_token_manager_raw(
            &token_id,
            token_manager_type,
            Some(token_identifier),
            link_params,
        );

        token_id
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
        self.require_not_paused();

        require!(!destination_token_address.is_empty(), "Empty token address");

        // Custom token managers can't be deployed with Interchain token mint burn type, which is reserved for interchain tokens
        require!(
            token_manager_type != TokenManagerType::NativeInterchainToken,
            "Can not deploy native interchain token"
        );

        // Cannot deploy to this chain using linkToken anymore
        require!(!destination_chain.is_empty(), "Not supported");

        // Cannot deploy to this chain using linkToken anymore
        require!(
            destination_chain != self.chain_name().get(),
            "Cannot deploy remotely to self"
        );

        let mut deployer = self.blockchain().get_caller();

        if deployer == self.interchain_token_factory().get() {
            deployer = ManagedAddress::zero();
        }

        let token_id = self.interchain_token_id(&deployer, &salt);

        self.interchain_token_id_claimed_event(&token_id, &deployer, &salt);

        let gas_value = self.call_value().egld_value().clone_value();

        let source_token_address = self.registered_token_identifier(&token_id).into_name();

        self.emit_link_token_started_event(
            &token_id,
            &destination_chain,
            &source_token_address,
            &destination_token_address,
            &token_manager_type,
            &link_params,
        );

        let data = LinkTokenPayload {
            message_type: BigUint::from(MESSAGE_TYPE_LINK_TOKEN),
            token_id: token_id.clone(),
            token_manager_type,
            source_token_address,
            destination_token_address,
            link_params,
        };
        let payload = data.abi_encode();

        self.route_message(
            destination_chain,
            payload,
            MetadataVersion::ContractCall,
            EgldOrEsdtTokenIdentifier::egld(),
            gas_value,
        );

        token_id
    }

    // Payable with EGLD for:
    // - ESDT token deploy (2nd transaction)
    // - cross chain calls gas
    #[payable("EGLD")]
    #[endpoint(deployInterchainToken)]
    fn deploy_interchain_token(
        &self,
        salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        minter: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();
        self.only_token_factory();

        let deployer = ManagedAddress::zero();

        let token_id = self.interchain_token_id(&deployer, &salt);

        self.interchain_token_id_claimed_event(&token_id, &deployer, &salt);

        if destination_chain.is_empty() {
            // On first transaction, deploy the token manager and on second transaction deploy ESDT through the token manager
            // This is because we can not deploy token manager and call it to deploy the token in the same transaction
            let token_manager_address_mapper = self.token_manager_address(&token_id);
            if token_manager_address_mapper.is_empty() {
                require!(
                    self.call_value().egld_value().deref() == &BigUint::zero(),
                    "Can not send EGLD payment if not issuing ESDT"
                );

                self.deploy_token_manager_raw(
                    &token_id,
                    TokenManagerType::NativeInterchainToken,
                    None,
                    minter,
                );

                return token_id;
            }

            let minter = if minter.is_empty() {
                None
            } else {
                Some(
                    ManagedAddress::try_from(minter)
                        .unwrap_or_else(|_| sc_panic!("Invalid MultiversX address")),
                )
            };

            self.token_manager_deploy_interchain_token(&token_id, minter, name, symbol, decimals);
        } else {
            let gas_value = self.call_value().egld_value().clone_value();

            require!(
                self.chain_name().get() != destination_chain,
                "Cannot deploy remotely to self",
            );

            self.deploy_remote_interchain_token(
                &token_id,
                name,
                symbol,
                decimals,
                minter,
                destination_chain,
                EgldOrEsdtTokenIdentifier::egld(),
                gas_value,
            );
        }

        token_id
    }

    #[payable("*")]
    #[endpoint(interchainTransfer)]
    fn interchain_transfer(
        &self,
        token_id: TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        metadata: ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.require_not_paused();

        let transfer_and_gas_tokens = self.get_transfer_and_gas_tokens(gas_value);

        self.token_manager_take_token(
            &token_id,
            transfer_and_gas_tokens.transfer_token.clone(),
            transfer_and_gas_tokens.transfer_amount.clone(),
        );

        let (metadata_version, data) = self.decode_metadata(metadata);

        self.transmit_interchain_transfer_raw(
            token_id,
            self.blockchain().get_caller(),
            destination_chain,
            destination_address,
            transfer_and_gas_tokens,
            metadata_version,
            data,
        );
    }

    #[payable("*")]
    #[endpoint(callContractWithInterchainToken)]
    fn call_contract_with_interchain_token(
        &self,
        token_id: TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        data: ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.require_not_paused();

        require!(!data.is_empty(), "Empty data");

        let transfer_and_gas_tokens = self.get_transfer_and_gas_tokens(gas_value);

        self.token_manager_take_token(
            &token_id,
            transfer_and_gas_tokens.transfer_token.clone(),
            transfer_and_gas_tokens.transfer_amount.clone(),
        );

        self.transmit_interchain_transfer_raw(
            token_id,
            self.blockchain().get_caller(),
            destination_chain,
            destination_address,
            transfer_and_gas_tokens,
            MetadataVersion::ContractCall,
            data,
        );
    }

    /// Private Functions

    fn get_transfer_and_gas_tokens(&self, gas_amount: BigUint) -> TransferAndGasTokens<Self::Api> {
        let payments = self.call_value().any_payment();

        match payments {
            EgldOrMultiEsdtPayment::Egld(value) => {
                require!(value > gas_amount, "Invalid gas value");

                return TransferAndGasTokens {
                    transfer_token: EgldOrEsdtTokenIdentifier::egld(),
                    transfer_amount: &value - &gas_amount,
                    gas_token: EgldOrEsdtTokenIdentifier::egld(),
                    gas_amount,
                };
            }
            EgldOrMultiEsdtPayment::MultiEsdt(esdts) => {
                require!(
                    esdts.len() <= 2,
                    "A maximum of two esdt payments are supported"
                );

                let first_payment = esdts.get(0);

                require!(
                    first_payment.token_nonce == 0,
                    "Only fungible esdts are supported"
                );

                let token_identifier =
                    EgldOrEsdtTokenIdentifier::esdt(first_payment.token_identifier);
                let amount = first_payment.amount;

                let second_payment = esdts.try_get(1);

                // If only one ESDT is set, substract gas amount from amount sent
                if second_payment.is_none() {
                    require!(amount > gas_amount, "Invalid gas value");

                    return TransferAndGasTokens {
                        transfer_token: token_identifier.clone(),
                        transfer_amount: &amount - &gas_amount,
                        gas_token: token_identifier,
                        gas_amount,
                    };
                }

                let second_payment = second_payment.unwrap();

                require!(
                    second_payment.token_nonce == 0,
                    "Only fungible esdts are supported"
                );
                require!(second_payment.amount == gas_amount, "Invalid gas value");

                // If two ESDTs were sent, check if EGLD was sent in MultiESDT and convert to EGLD identifier
                let gas_token = if second_payment.token_identifier.as_managed_buffer()
                    == &ManagedBuffer::from(ESDT_EGLD_IDENTIFIER)
                {
                    EgldOrEsdtTokenIdentifier::egld()
                } else {
                    EgldOrEsdtTokenIdentifier::esdt(second_payment.token_identifier)
                };

                return TransferAndGasTokens {
                    transfer_token: token_identifier,
                    transfer_amount: amount,
                    gas_token,
                    gas_amount,
                };
            }
        }
    }

    fn only_token_factory(&self) {
        require!(
            self.blockchain().get_caller() == self.interchain_token_factory().get(),
            "Not interchain token factory"
        );
    }

    #[view(interchainTokenId)]
    fn interchain_token_id(
        &self,
        sender: &ManagedAddress,
        salt: &Hash<Self::Api>,
    ) -> TokenId<Self::Api> {
        let prefix_interchain_token_id = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_INTERCHAIN_TOKEN_ID));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_interchain_token_id.as_managed_buffer());
        encoded.append(sender.as_managed_buffer());
        encoded.append(salt.as_managed_buffer());

        self.crypto().keccak256(encoded)
    }

    #[view(interchainTokenFactory)]
    #[storage_mapper("interchain_token_factory")]
    fn interchain_token_factory(&self) -> SingleValueMapper<ManagedAddress>;
}
