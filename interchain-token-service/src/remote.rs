multiversx_sc::imports!();

use crate::abi::AbiEncodeDecode;
use crate::constants::{DeployTokenManagerPayload, Metadata, InterchainTransferPayload, TokenId, TokenManagerType, MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER, MESSAGE_TYPE_INTERCHAIN_TRANSFER, MESSAGE_TYPE_INTERCHAIN_TRANSFER_WITH_DATA, LATEST_METADATA_VERSION};
use crate::{events, proxy, express_executor_tracker, address_tracker};

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
        gas_value: BigUint,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) {
        let _ = self.valid_token_manager_address(&token_id);

        let data = DeployTokenManagerPayload {
            message_type: BigUint::from(MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER),
            token_id: token_id.clone(),
            token_manager_type,
            params: params.clone(),
        };

        let payload = data.abi_encode();

        self.call_contract(&destination_chain, &payload, &gas_value);

        self.emit_token_manager_deployment_started(
            token_id,
            destination_chain,
            token_manager_type,
            params,
        );
    }

    fn transmit_interchain_transfer_raw(
        &self,
        token_id: TokenId<Self::Api>,
        source_address: ManagedAddress,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        amount: BigUint,
        raw_metadata: ManagedBuffer,
    ) {
        let (version, metadata, is_err) = self.decode_metadata(raw_metadata);

        if is_err {
            let data = InterchainTransferPayload {
                message_type: BigUint::from(MESSAGE_TYPE_INTERCHAIN_TRANSFER),
                token_id: token_id.clone(),
                source_address: source_address.as_managed_buffer().clone(),
                destination_address: destination_address.clone(),
                amount: amount.clone(),
                data: None,
            };

            let payload = data.abi_encode();

            // TODO: What gas value should we use here? Since we can not have both EGLD and ESDT payment in the same contract call
            self.call_contract(&destination_chain, &payload, &BigUint::zero());

            self.emit_interchain_transfer_event(token_id, destination_chain, destination_address, amount);

            return;
        }

        require!(version == LATEST_METADATA_VERSION, "Invalid metadata version");

        let data = InterchainTransferPayload {
            message_type: BigUint::from(MESSAGE_TYPE_INTERCHAIN_TRANSFER_WITH_DATA),
            token_id: token_id.clone(),
            source_address: source_address.as_managed_buffer().clone(),
            destination_address: destination_address.clone(),
            amount: amount.clone(),
            data: Some(metadata.clone()),
        };

        let payload = data.abi_encode();

        // TODO: What gas value should we use here? Since we can not have both EGLD and ESDT payment in the same contract call
        self.call_contract(&destination_chain, &payload, &BigUint::zero());

        self.emit_interchain_transfer_with_data_event(
            token_id,
            destination_chain,
            destination_address,
            amount,
            source_address,
            metadata,
        );
    }

    // TODO: Check if this is correct and what this metadata actually is
    fn decode_metadata(&self, raw_metadata: ManagedBuffer) -> (u32, ManagedBuffer, bool) {
        let decoded_metadata = Metadata::<Self::Api>::top_decode(raw_metadata);
        let metadata: Metadata<Self::Api>;
        let is_err;
        if decoded_metadata.is_err() {
            metadata = Metadata::<Self::Api> {
                version: 0,
                metadata: ManagedBuffer::new(),
            };
            is_err = true;
        } else {
            metadata = decoded_metadata.unwrap();
            is_err = false;
        }

        (metadata.version, metadata.metadata, is_err)
    }

    fn only_remote_service(&self, source_chain: &ManagedBuffer, source_address: &ManagedBuffer) {
        require!(self.is_trusted_address(source_chain, source_address), "Not remote service");
    }
}
