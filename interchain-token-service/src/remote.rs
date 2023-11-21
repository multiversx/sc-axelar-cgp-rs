multiversx_sc::imports!();

use crate::abi::AbiEncodeDecode;
use crate::constants::{
    DeployTokenManagerPayload, Metadata, SendTokenPayload, TokenId, TokenManagerType,
    MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER, MESSAGE_TYPE_INTERCHAIN_TRANSFER, MESSAGE_TYPE_INTERCHAIN_TRANSFER_WITH_DATA,
};
use crate::{events, proxy};
use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[multiversx_sc::module]
pub trait RemoteModule:
    express_executor_tracker::ExpressExecutorTracker
    + multiversx_sc_modules::pause::PauseModule
    + events::EventsModule
    + proxy::ProxyModule
{
    fn deploy_remote_token_manager(
        &self,
        token_id: &TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        gas_value: BigUint,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) {
        let data = DeployTokenManagerPayload {
            selector: BigUint::from(MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER),
            token_id: token_id.clone(),
            token_manager_type,
            params: params.clone(),
        };

        let payload = data.abi_encode();

        self.call_contract(&destination_chain, &payload, &gas_value);

        self.emit_remote_token_manager_deployment_initialized(
            token_id,
            destination_chain,
            gas_value,
            token_manager_type,
            params,
        );
    }

    fn transmit_send_token_raw(
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
            let data = SendTokenPayload {
                message_type: BigUint::from(MESSAGE_TYPE_INTERCHAIN_TRANSFER),
                token_id: token_id.clone(),
                destination_address: destination_address.clone(),
                amount: amount.clone(),
                source_address: None,
                data: None,
            };

            let payload = data.abi_encode();

            // TODO: What gas value should we use here? Since we can not have both EGLD and ESDT payment in the same contract call
            self.call_contract(&destination_chain, &payload, &BigUint::zero());

            self.emit_token_sent_event(token_id, destination_chain, destination_address, amount);

            return;
        }

        require!(version == 0, "Invalid metadata version");

        let data = SendTokenPayload {
            message_type: BigUint::from(MESSAGE_TYPE_INTERCHAIN_TRANSFER_WITH_DATA),
            token_id: token_id.clone(),
            destination_address: destination_address.clone(),
            amount: amount.clone(),
            source_address: Some(source_address.as_managed_buffer().clone()),
            data: Some(metadata.clone()),
        };

        let payload = data.abi_encode();

        // TODO: What gas value should we use here? Since we can not have both EGLD and ESDT payment in the same contract call
        self.call_contract(&destination_chain, &payload, &BigUint::zero());

        self.emit_token_sent_with_data_event(
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
        let metadata = Metadata::<Self::Api>::top_decode(raw_metadata);
        let raw_metadata: Metadata<Self::Api>;
        let is_err;
        if metadata.is_err() {
            raw_metadata = Metadata::<Self::Api> {
                version: 0,
                metadata: ManagedBuffer::new(),
            };
            is_err = true;
        } else {
            raw_metadata = metadata.unwrap();
            is_err = false;
        }

        (raw_metadata.version, raw_metadata.metadata, is_err)
    }

    fn only_remote_service(&self, source_chain: &ManagedBuffer, source_address: &ManagedBuffer) {
        require!(self.is_trusted_address(source_chain, source_address), "Not remote service");
    }
}
