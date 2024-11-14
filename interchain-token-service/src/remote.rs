use multiversx_sc::api::KECCAK256_RESULT_LEN;
use token_manager::constants::TokenManagerType;

use crate::abi::AbiEncodeDecode;
use crate::constants::{
    DeployInterchainTokenPayload, DeployTokenManagerPayload, InterchainTransferPayload, Metadata,
    MetadataVersion, TokenId, TransferAndGasTokens, LATEST_METADATA_VERSION,
    MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN, MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER,
    MESSAGE_TYPE_INTERCHAIN_TRANSFER,
};
use crate::{address_tracker, events, express_executor_tracker, proxy_gmp, proxy_its};

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait RemoteModule:
    express_executor_tracker::ExpressExecutorTracker
    + multiversx_sc_modules::pause::PauseModule
    + events::EventsModule
    + proxy_gmp::ProxyGmpModule
    + proxy_its::ProxyItsModule
    + address_tracker::AddressTracker
{
    fn deploy_remote_token_manager(
        &self,
        token_id: &TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
        gas_token: EgldOrEsdtTokenIdentifier,
        gas_value: BigUint,
    ) {
        let _ = self.deployed_token_manager(token_id);

        let message_type = BigUint::from(MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER);
        let data = DeployTokenManagerPayload {
            message_type: message_type.clone(),
            token_id: token_id.clone(),
            token_manager_type,
            params: params.clone(),
        };

        let payload = data.abi_encode();

        self.call_contract(
            message_type,
            destination_chain.clone(),
            payload,
            MetadataVersion::ContractCall,
            gas_token,
            gas_value,
        );

        self.emit_token_manager_deployment_started(
            token_id,
            destination_chain,
            token_manager_type,
            params,
        );
    }

    fn deploy_remote_interchain_token(
        &self,
        token_id: &TokenId<Self::Api>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        minter: ManagedBuffer,
        destination_chain: ManagedBuffer,
        gas_token: EgldOrEsdtTokenIdentifier,
        gas_value: BigUint,
    ) {
        require!(!name.is_empty(), "Empty token name");
        require!(!symbol.is_empty(), "Empty token symbol");

        self.deployed_token_manager(token_id);

        let message_type = BigUint::from(MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN);
        let data = DeployInterchainTokenPayload {
            message_type: message_type.clone(),
            token_id: token_id.clone(),
            name: name.clone(),
            symbol: symbol.clone(),
            decimals,
            minter: minter.clone(),
        };

        let payload = data.abi_encode();

        self.call_contract(
            message_type,
            destination_chain.clone(),
            payload,
            MetadataVersion::ContractCall,
            gas_token,
            gas_value,
        );

        self.emit_interchain_token_deployment_started_event(
            token_id,
            name,
            symbol,
            decimals,
            minter,
            destination_chain,
        );
    }

    fn transmit_interchain_transfer_raw(
        &self,
        token_id: TokenId<Self::Api>,
        source_address: ManagedAddress,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        transfer_and_gas_tokens: TransferAndGasTokens<Self::Api>,
        metadata_version: MetadataVersion,
        data: ManagedBuffer,
    ) {
        require!(!destination_address.is_empty(), "Empty destination address");
        require!(transfer_and_gas_tokens.transfer_amount > 0, "Zero amount");

        let data_hash = if data.is_empty() {
            ManagedByteArray::from(&[0; KECCAK256_RESULT_LEN])
        } else {
            self.crypto().keccak256(&data)
        };

        let message_type = BigUint::from(MESSAGE_TYPE_INTERCHAIN_TRANSFER);
        let payload = InterchainTransferPayload {
            message_type: message_type.clone(),
            token_id: token_id.clone(),
            source_address: source_address.as_managed_buffer().clone(),
            destination_address: destination_address.clone(),
            amount: transfer_and_gas_tokens.transfer_amount.clone(),
            data,
        };

        let payload = payload.abi_encode();

        self.call_contract(
            message_type,
            destination_chain.clone(),
            payload,
            metadata_version,
            transfer_and_gas_tokens.gas_token,
            transfer_and_gas_tokens.gas_amount,
        );

        self.emit_interchain_transfer_event(
            token_id,
            source_address,
            destination_chain,
            destination_address,
            transfer_and_gas_tokens.transfer_amount,
            data_hash,
        );
    }

    fn decode_metadata(&self, raw_metadata: ManagedBuffer) -> (MetadataVersion, ManagedBuffer) {
        let decoded_metadata = Metadata::<Self::Api>::top_decode(raw_metadata);

        if decoded_metadata.is_err() {
            return (MetadataVersion::ContractCall, ManagedBuffer::new());
        }

        let metadata: Metadata<Self::Api> = decoded_metadata.unwrap();

        require!(
            metadata.version <= LATEST_METADATA_VERSION,
            "Invalid metadata version"
        );

        (MetadataVersion::from(metadata.version), metadata.data)
    }

    fn only_remote_service(&self, source_chain: &ManagedBuffer, source_address: &ManagedBuffer) {
        require!(
            self.is_trusted_address(source_chain, source_address),
            "Not remote service"
        );
    }
}
