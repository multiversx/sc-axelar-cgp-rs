use multiversx_sc::api::KECCAK256_RESULT_LEN;

use crate::abi::AbiEncodeDecode;
use crate::abi_types::{DeployInterchainTokenPayload, InterchainTransferPayload};
use crate::constants::{
    TokenId, TransferAndGasTokens, ITS_HUB_CHAIN_NAME,
    MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN, MESSAGE_TYPE_INTERCHAIN_TRANSFER,
};
use crate::{address_tracker, events, proxy_gmp, proxy_its};

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait RemoteModule:
    multiversx_sc_modules::pause::PauseModule
    + events::EventsModule
    + proxy_gmp::ProxyGmpModule
    + proxy_its::ProxyItsModule
    + address_tracker::AddressTracker
{
    fn deploy_remote_interchain_token_base(
        &self,
        token_id: &TokenId<Self::Api>,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        minter: ManagedBuffer,
        destination_chain: ManagedBuffer,
        gas_value: BigUint,
    ) {
        require!(!name.is_empty(), "Empty token name");
        require!(!symbol.is_empty(), "Empty token symbol");

        self.deployed_token_manager(token_id);

        let data = DeployInterchainTokenPayload {
            message_type: BigUint::from(MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN),
            token_id: token_id.clone(),
            name: name.clone(),
            symbol: symbol.clone(),
            decimals,
            minter: minter.clone(),
        };

        let payload = data.abi_encode();

        self.route_message_through_its_hub(destination_chain.clone(), payload, gas_value);

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
        data: ManagedBuffer,
    ) {
        require!(!destination_address.is_empty(), "Empty destination address");
        require!(transfer_and_gas_tokens.transfer_amount > 0, "Zero amount");

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
            amount: transfer_and_gas_tokens.transfer_amount.clone(),
            data,
        };

        let payload = payload.abi_encode();

        self.route_message_through_its_hub(
            destination_chain.clone(),
            payload,
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

    fn only_its_hub(&self, source_chain: &ManagedBuffer, source_address: &ManagedBuffer) {
        require!(
            source_chain == &ManagedBuffer::from(ITS_HUB_CHAIN_NAME)
                && &self.its_hub_address().get() == source_address,
            "Not its hub"
        );
    }
}
