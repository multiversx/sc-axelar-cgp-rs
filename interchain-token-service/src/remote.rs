use multiversx_sc::api::KECCAK256_RESULT_LEN;
use token_manager::constants::TokenManagerType;

use crate::abi::AbiEncodeDecode;
use crate::constants::{
    DeployInterchainTokenPayload, DeployTokenManagerPayload, InterchainTransferPayload, Metadata,
    MetadataVersion, TokenId, LATEST_METADATA_VERSION, MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
    MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER, MESSAGE_TYPE_INTERCHAIN_TRANSFER,
};
use crate::{address_tracker, events, express_executor_tracker, proxy};

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait RemoteModule:
    express_executor_tracker::ExpressExecutorTracker
    + multiversx_sc_modules::pause::PauseModule
    + events::EventsModule
    + proxy::ProxyModule
    + address_tracker::AddressTracker
{
    fn deploy_remote_token_manager(
        &self,
        token_id: &TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        gas_value: &BigUint,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) {
        let _ = self.valid_token_manager_address(token_id);

        let data = DeployTokenManagerPayload {
            message_type: BigUint::from(MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER),
            token_id: token_id.clone(),
            token_manager_type,
            params: params.clone(),
        };

        let payload = data.abi_encode();

        self.call_contract(
            &destination_chain,
            &payload,
            MetadataVersion::ContractCall,
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
        gas_value: &BigUint,
    ) {
        self.valid_token_manager_address(token_id);

        let data = DeployInterchainTokenPayload {
            message_type: BigUint::from(MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN),
            token_id: token_id.clone(),
            name: name.clone(),
            symbol: symbol.clone(),
            decimals,
            minter: minter.clone(),
        };

        let payload = data.abi_encode();

        self.call_contract(
            &destination_chain,
            &payload,
            MetadataVersion::ContractCall,
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
        amount: BigUint,
        metadata_version: MetadataVersion,
        data: ManagedBuffer,
        _gas_value: BigUint, // TODO: Handle gas
    ) {
        let data_hash = if data.is_empty() {
            ManagedByteArray::from(&[0; KECCAK256_RESULT_LEN])
        } else {
            self.crypto().keccak256(&data)
        };

        let payload = InterchainTransferPayload {
            message_type: BigUint::from(MESSAGE_TYPE_INTERCHAIN_TRANSFER),
            token_id: token_id.clone(),
            source_address: source_address.as_managed_buffer().clone(),
            destination_address: destination_address.clone(),
            amount: amount.clone(),
            data,
        };

        let payload = payload.abi_encode();

        // TODO: What gas value should we use here? Since we can not have both EGLD and ESDT payment in the same contract call
        self.call_contract(
            &destination_chain,
            &payload,
            metadata_version,
            &BigUint::zero(),
        );

        self.emit_interchain_transfer_event(
            token_id,
            source_address,
            destination_chain,
            destination_address,
            amount,
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
