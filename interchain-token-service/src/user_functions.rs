use core::convert::TryFrom;
use core::ops::Deref;

use multiversx_sc::api::KECCAK256_RESULT_LEN;

use token_manager::constants::{DeployTokenManagerParams, TokenManagerType};

use crate::abi::AbiEncodeDecode;
use crate::constants::{
    InterchainTransferPayload, MetadataVersion, TokenId, TransferAndGasTokens,
    ITS_HUB_ROUTING_IDENTIFIER, MESSAGE_TYPE_INTERCHAIN_TRANSFER, PREFIX_INTERCHAIN_TOKEN_ID,
};
use crate::{
    address_tracker, events, executable, express_executor_tracker, proxy_gmp, proxy_its, remote,
};

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait UserFunctionsModule:
    express_executor_tracker::ExpressExecutorTracker
    + proxy_gmp::ProxyGmpModule
    + proxy_its::ProxyItsModule
    + address_tracker::AddressTracker
    + events::EventsModule
    + remote::RemoteModule
    + multiversx_sc_modules::pause::PauseModule
    + executable::ExecutableModule
{
    // Payable with EGLD for cross chain calls gas
    #[payable("EGLD")]
    #[endpoint(deployTokenManager)]
    fn deploy_token_manager(
        &self,
        salt: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        require!(!params.is_empty(), "Empty params");

        // Custom token managers can't be deployed with Interchain token mint burn type, which is reserved for interchain tokens
        require!(
            token_manager_type != TokenManagerType::NativeInterchainToken,
            "Can not deploy"
        );

        self.require_not_paused();

        let mut deployer = self.blockchain().get_caller();

        if deployer == self.interchain_token_factory().get() {
            deployer = ManagedAddress::zero();
        } else if destination_chain.is_empty() {
            // Restricted on ITS contracts deployed to Amplifier chains until ITS Hub adds support
            require!(
                self.trusted_address(&self.chain_name().get()).get()
                    != *ITS_HUB_ROUTING_IDENTIFIER,
                "Not supported"
            );
        }

        let token_id = self.interchain_token_id(&deployer, &salt);

        self.interchain_token_id_claimed_event(&token_id, &deployer, &salt);

        let gas_value = self.call_value().egld_value().clone_value();

        if destination_chain.is_empty() {
            require!(
                gas_value == 0,
                "Can not accept EGLD if not cross chain call"
            );

            self.deploy_token_manager_raw(&token_id, token_manager_type, params);
        } else {
            require!(
                self.chain_name().get() != destination_chain,
                "Cannot deploy remotely to self",
            );

            self.deploy_remote_token_manager(
                &token_id,
                destination_chain,
                token_manager_type,
                params,
                EgldOrEsdtTokenIdentifier::egld(),
                gas_value,
            );
        }

        token_id
    }

    // Payable with EGLD for:
    // - ESDT token deploy (2nd transaction)
    // - cross chain calls gas
    #[payable("EGLD")]
    #[endpoint(deployInterchainToken)]
    fn deploy_interchain_token(
        &self,
        salt: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        minter: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();

        let mut deployer = self.blockchain().get_caller();

        if deployer == self.interchain_token_factory().get() {
            deployer = ManagedAddress::zero();
        }

        let token_id = self.interchain_token_id(&deployer, &salt);

        self.interchain_token_id_claimed_event(&token_id, &deployer, &salt);

        if destination_chain.is_empty() {
            let minter_raw = ManagedAddress::try_from(minter);
            let minter = if minter_raw.is_err() {
                None
            } else {
                Some(minter_raw.unwrap())
            };

            // On first transaction, deploy the token manager and on second transaction deploy ESDT through the token manager
            // This is because we can not deploy token manager and call it to deploy the token in the same transaction
            let token_manager_address_mapper = self.token_manager_address(&token_id);
            if token_manager_address_mapper.is_empty() {
                require!(
                    self.call_value().egld_value().deref() == &BigUint::zero(),
                    "Can not send EGLD payment if not issuing ESDT"
                );

                let mut params = ManagedBuffer::new();

                DeployTokenManagerParams {
                    operator: minter,
                    token_identifier: None,
                }
                .top_encode(&mut params)
                .unwrap();

                self.deploy_token_manager_raw(
                    &token_id,
                    TokenManagerType::NativeInterchainToken,
                    params,
                );

                return token_id;
            }

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
    #[endpoint(expressExecute)]
    fn express_execute_endpoint(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        source_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        self.require_not_paused();

        let interchain_transfer_payload =
            InterchainTransferPayload::<Self::Api>::abi_decode(payload.clone());

        require!(
            interchain_transfer_payload.message_type == MESSAGE_TYPE_INTERCHAIN_TRANSFER,
            "Invalid express message type"
        );

        require!(
            !self.gateway_is_message_executed(&source_chain, &message_id),
            "Already executed"
        );

        let express_executor = self.blockchain().get_caller();
        let payload_hash = self.crypto().keccak256(payload);

        self.express_executed_event(
            &source_chain,
            &message_id,
            &source_address,
            &payload_hash,
            &express_executor,
        );

        let express_hash = self.set_express_executor(
            &source_chain,
            &message_id,
            &source_address,
            &payload_hash,
            &express_executor,
        );

        self.express_execute_raw(
            source_chain,
            message_id,
            interchain_transfer_payload,
            express_executor,
            express_hash,
        );
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

    fn express_execute_raw(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        interchain_transfer_payload: InterchainTransferPayload<Self::Api>,
        express_executor: ManagedAddress,
        express_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) {
        let destination_address =
            ManagedAddress::try_from(interchain_transfer_payload.destination_address).unwrap();

        let token_identifier =
            self.registered_token_identifier(&interchain_transfer_payload.token_id);

        let (sent_token_identifier, sent_amount) = self.call_value().egld_or_single_fungible_esdt();

        require!(
            sent_token_identifier == token_identifier
                && sent_amount == interchain_transfer_payload.amount,
            "Wrong token or amount sent"
        );

        self.interchain_transfer_received_event(
            &interchain_transfer_payload.token_id,
            &source_chain,
            &message_id,
            &interchain_transfer_payload.source_address,
            &destination_address,
            if interchain_transfer_payload.data.is_empty() {
                ManagedByteArray::from(&[0; KECCAK256_RESULT_LEN])
            } else {
                self.crypto().keccak256(&interchain_transfer_payload.data)
            },
            &interchain_transfer_payload.amount,
        );

        if !interchain_transfer_payload.data.is_empty() {
            self.executable_contract_express_execute_with_interchain_token(
                destination_address,
                source_chain,
                message_id,
                interchain_transfer_payload.source_address,
                interchain_transfer_payload.data,
                interchain_transfer_payload.token_id,
                token_identifier,
                interchain_transfer_payload.amount,
                express_executor,
                express_hash,
            );

            // Not technically needed, the async call above will end the execution
            return;
        }

        self.send().direct(
            &destination_address,
            &token_identifier,
            0,
            &interchain_transfer_payload.amount,
        );
    }

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

                return TransferAndGasTokens {
                    transfer_token: token_identifier,
                    transfer_amount: amount,
                    gas_token: EgldOrEsdtTokenIdentifier::esdt(second_payment.token_identifier),
                    gas_amount,
                };
            }
        }
    }

    #[view(interchainTokenId)]
    fn interchain_token_id(
        &self,
        sender: &ManagedAddress,
        salt: &ManagedByteArray<KECCAK256_RESULT_LEN>,
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
