use core::convert::TryFrom;
use core::ops::Deref;

use multiversx_sc::api::KECCAK256_RESULT_LEN;

use token_manager::constants::{DeployTokenManagerParams, TokenManagerType};

use crate::abi::{AbiEncodeDecode, ParamType};
use crate::abi_types::{
    DeployInterchainTokenPayload, InterchainTransferPayload, LinkTokenPayload,
    ReceiveFromHubPayload,
};
use crate::constants::{Hash, TokenId, MESSAGE_TYPE_RECEIVE_FROM_HUB};
use crate::{address_tracker, events, proxy_gmp, proxy_its};

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait ExecutableModule:
    multiversx_sc_modules::pause::PauseModule
    + events::EventsModule
    + proxy_gmp::ProxyGmpModule
    + proxy_its::ProxyItsModule
    + address_tracker::AddressTracker
{
    // Returns (message_type, original_source_chain, payload)
    fn get_execute_params(&self, payload: ManagedBuffer) -> (u64, ManagedBuffer, ManagedBuffer) {
        let message_type = self.get_message_type(&payload);

        require!(
            message_type == MESSAGE_TYPE_RECEIVE_FROM_HUB,
            "Invalid message type"
        );

        let data = ReceiveFromHubPayload::<Self::Api>::abi_decode(payload);

        // Check whether the original source chain is expected to be routed via the ITS Hub
        require!(
            self.is_trusted_chain(&data.original_source_chain),
            "Untrusted chain"
        );

        let message_type = self.get_message_type(&data.payload);

        // Return original message type, source chain and payload
        (message_type, data.original_source_chain, data.payload)
    }

    fn process_interchain_transfer_payload(
        &self,
        original_source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        let send_token_payload = InterchainTransferPayload::<Self::Api>::abi_decode(payload);

        let destination_address = ManagedAddress::try_from(send_token_payload.destination_address)
            .unwrap_or_else(|_| sc_panic!("Invalid MultiversX address"));

        self.interchain_transfer_received_event(
            &send_token_payload.token_id,
            &original_source_chain,
            &message_id,
            &send_token_payload.source_address,
            &destination_address,
            if send_token_payload.data.is_empty() {
                ManagedByteArray::from(&[0; KECCAK256_RESULT_LEN])
            } else {
                self.crypto().keccak256(&send_token_payload.data)
            },
            &send_token_payload.amount,
        );

        if send_token_payload.data.is_empty() {
            let _ = self.token_manager_give_token(
                &send_token_payload.token_id,
                &destination_address,
                &send_token_payload.amount,
            );

            return;
        }

        // Here we give the tokens to this contract and then call the executable contract with the tokens
        // In case of async call error, the token_manager_take_token method is called to revert this
        let (token_identifier, amount) = self.token_manager_give_token(
            &send_token_payload.token_id,
            &self.blockchain().get_sc_address(),
            &send_token_payload.amount,
        );

        self.executable_contract_execute_with_interchain_token(
            destination_address,
            original_source_chain,
            message_id,
            send_token_payload.source_address,
            send_token_payload.data,
            send_token_payload.token_id,
            token_identifier,
            amount,
        );
    }

    fn process_link_token_payload(&self, payload: ManagedBuffer) {
        let link_token_payload = LinkTokenPayload::<Self::Api>::abi_decode(payload);

        require!(
            link_token_payload.token_manager_type != TokenManagerType::NativeInterchainToken,
            "Can not deploy native interchain token"
        );

        // Support only ESDT tokens for custom linking of tokens
        let token_identifier =
            EgldOrEsdtTokenIdentifier::parse(link_token_payload.destination_token_address);

        require!(token_identifier.is_valid(), "Invalid token identifier");

        self.deploy_token_manager_raw(
            &link_token_payload.token_id,
            link_token_payload.token_manager_type,
            Some(token_identifier),
            link_token_payload.link_params,
        );
    }

    fn process_deploy_interchain_token_payload(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        source_address: ManagedBuffer,
        payload_hash: Hash<Self::Api>,
        payload: ManagedBuffer,
    ) {
        let data = DeployInterchainTokenPayload::<Self::Api>::abi_decode(payload);

        // On first transaction, deploy the token manager and on second transaction deploy ESDT through the token manager
        // This is because we can not deploy token manager and call it to deploy the token in the same transaction
        let token_manager_address_mapper = self.token_manager_address(&data.token_id);
        if token_manager_address_mapper.is_empty() {
            require!(
                self.call_value().egld_value().deref() == &BigUint::zero(),
                "Can not send EGLD payment if not issuing ESDT"
            );

            // Only check that the call is valid, since this needs to be called twice with the same parameters
            let valid = self.gateway_is_message_approved(
                &source_chain,
                &message_id,
                &source_address,
                &payload_hash,
            );

            require!(valid, "Not approved by gateway");

            self.deploy_token_manager_raw(
                &data.token_id,
                TokenManagerType::NativeInterchainToken,
                None,
                data.minter,
            );

            return;
        }

        // The second time this is called, the call will be validated
        let valid = self.gateway_validate_message(
            &source_chain,
            &message_id,
            &source_address,
            &payload_hash,
        );

        require!(valid, "Not approved by gateway");

        let minter = if data.minter.is_empty() {
            None
        } else {
            Some(
                ManagedAddress::try_from(data.minter)
                    .unwrap_or_else(|_| sc_panic!("Invalid MultiversX address")),
            )
        };

        self.token_manager_deploy_interchain_token(
            &data.token_id,
            minter,
            data.name,
            data.symbol,
            data.decimals,
            self.blockchain().get_caller(),
        );
    }

    fn deploy_token_manager_raw(
        &self,
        token_id: &TokenId<Self::Api>,
        token_manager_type: TokenManagerType,
        token_identifier: Option<EgldOrEsdtTokenIdentifier>,
        operator: ManagedBuffer,
    ) -> ManagedAddress {
        let token_manager_address_mapper = self.token_manager_address(token_id);

        require!(
            token_manager_address_mapper.is_empty(),
            "Token manager already exists"
        );

        let mut arguments = ManagedArgBuffer::new();

        arguments.push_arg(self.blockchain().get_sc_address());
        arguments.push_arg(token_manager_type);
        arguments.push_arg(token_id);

        let operator = if operator.is_empty() {
            None
        } else {
            Some(
                ManagedAddress::try_from(operator)
                    .unwrap_or_else(|_| sc_panic!("Invalid MultiversX address")),
            )
        };

        let params = DeployTokenManagerParams {
            operator,
            token_identifier,
        };

        arguments.push_arg(&params);

        let (address, _) = self.send_raw().deploy_from_source_contract(
            self.blockchain().get_gas_left(),
            &BigUint::zero(),
            &self.token_manager().get(),
            CodeMetadata::UPGRADEABLE,
            &arguments,
        );

        require!(!address.is_zero(), "Token manager deployment failed");

        self.emit_token_manager_deployed_event(
            token_id,
            address.clone(),
            token_manager_type,
            params,
        );

        token_manager_address_mapper.set(address.clone());

        address
    }

    fn get_message_type(&self, payload: &ManagedBuffer) -> u64 {
        ParamType::Uint256
            .abi_decode(payload, 0)
            .token
            .into_biguint()
            .to_u64()
            .unwrap()
    }

    #[view(tokenManagerImplementation)]
    #[storage_mapper("token_manager")]
    fn token_manager(&self) -> SingleValueMapper<ManagedAddress>;
}
