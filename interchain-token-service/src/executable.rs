multiversx_sc::imports!();

use crate::abi::AbiEncodeDecode;
use crate::constants::{
    DeployStandardizedTokenAndManagerPayload, DeployTokenManagerParams, DeployTokenManagerPayload,
    SendTokenPayload, TokenId, TokenManagerType, SELECTOR_RECEIVE_TOKEN,
};
use crate::{events, proxy};
use core::convert::TryFrom;
use core::ops::Deref;
use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[multiversx_sc::module]
pub trait ExecutableModule:
    multiversx_sc_modules::pause::PauseModule + events::EventsModule + proxy::ProxyModule
{
    fn process_receive_token_payload(
        &self,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        let express_caller = self.pop_express_receive_token(&payload, &command_id);

        let send_token_payload = SendTokenPayload::<Self::Api>::abi_decode(payload);

        let destination_address =
            ManagedAddress::try_from(send_token_payload.destination_address).unwrap();

        if !express_caller.is_zero() {
            self.token_manager_give_token(
                &send_token_payload.token_id,
                &express_caller,
                &send_token_payload.amount,
            );

            return;
        }

        if send_token_payload.selector == SELECTOR_RECEIVE_TOKEN {
            let (_, amount) = self.token_manager_give_token(
                &send_token_payload.token_id,
                &destination_address,
                &send_token_payload.amount,
            );

            self.token_received_event(
                send_token_payload.token_id,
                source_chain,
                destination_address,
                amount,
            );

            return;
        }

        // Here we give the tokens to this contract and then call the executable contract with the tokens
        let (token_identifier, amount) = self.token_manager_give_token(
            &send_token_payload.token_id,
            &self.blockchain().get_sc_address(),
            &send_token_payload.amount,
        );

        self.emit_received_token_with_data_event(
            &send_token_payload.token_id,
            &source_chain,
            &destination_address,
            amount.clone(),
            send_token_payload.source_address.clone().unwrap(),
            send_token_payload.data.clone().unwrap(),
        );

        self.executable_contract_execute_with_interchain_token(
            destination_address,
            source_chain,
            send_token_payload.source_address.unwrap(),
            send_token_payload.data.unwrap(),
            send_token_payload.token_id,
            token_identifier,
            amount,
            command_id,
        );
    }

    fn process_deploy_token_manager_payload(&self, payload: ManagedBuffer) {
        let deploy_token_manager_payload =
            DeployTokenManagerPayload::<Self::Api>::abi_decode(payload);

        let params =
            DeployTokenManagerParams::<Self::Api>::top_decode(deploy_token_manager_payload.params)
                .unwrap();

        self.deploy_token_manager(
            &deploy_token_manager_payload.token_id,
            deploy_token_manager_payload.token_manager_type,
            params.operator,
            Some(params.token_identifier),
        );
    }

    fn process_deploy_standardized_token_and_manager_payload(
        &self,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        payload_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
        payload: ManagedBuffer,
    ) {
        let data = DeployStandardizedTokenAndManagerPayload::<Self::Api>::abi_decode(payload);

        let operator_raw = ManagedAddress::try_from(data.operator);
        let operator = if operator_raw.is_err() {
            self.blockchain().get_sc_address()
        } else {
            operator_raw.unwrap()
        };

        // On first transaction, deploy the token manager and on second transaction deploy ESDT through the token manager
        // This is because we can not deploy token manager and call it to deploy the token in the same transaction
        let token_manager_address_mapper = self.token_manager_address(&data.token_id);
        if token_manager_address_mapper.is_empty() {
            require!(
                self.call_value().egld_value().deref() == &BigUint::zero(),
                "Can not send EGLD payment if not issuing ESDT"
            );

            // Only check that the call is valid, since this needs to be called twice with the same parameters
            let valid = self.gateway_is_contract_call_approved(
                &command_id,
                &source_chain,
                &source_address,
                &payload_hash,
            );

            require!(valid, "Not approved by gateway");

            self.deploy_token_manager(&data.token_id, TokenManagerType::MintBurn, operator, None);

            return;
        }

        let token_manager_address = token_manager_address_mapper.get();

        let distributor_raw = ManagedAddress::try_from(data.distributor);
        let distributor = if distributor_raw.is_err() {
            token_manager_address
        } else {
            distributor_raw.unwrap()
        };

        let mint_to_raw = ManagedAddress::try_from(data.mint_to);
        let mint_to = if mint_to_raw.is_err() {
            distributor.clone()
        } else {
            mint_to_raw.unwrap()
        };

        // The second time this is called, the call will be validated
        let valid = self.gateway_validate_contract_call(
            &command_id,
            &source_chain,
            &source_address,
            &payload_hash,
        );

        require!(valid, "Not approved by gateway");

        self.token_manager_deploy_standardized_token(
            &data.token_id,
            distributor,
            data.name,
            data.symbol,
            data.decimals,
            data.mint_amount,
            mint_to,
        );
    }

    fn deploy_token_manager(
        &self,
        token_id: &TokenId<Self::Api>,
        token_manager_type: TokenManagerType,
        operator: ManagedAddress,
        token_identifier: Option<EgldOrEsdtTokenIdentifier>,
    ) -> ManagedAddress {
        let token_manager_address_mapper = self.token_manager_address(token_id);

        require!(
            token_manager_address_mapper.is_empty(),
            "Token manager already exists"
        );

        let impl_address = self.get_implementation(token_manager_type);

        let mut arguments = ManagedArgBuffer::new();

        arguments.push_arg(self.blockchain().get_sc_address());
        arguments.push_arg(token_id);
        arguments.push_arg(operator);
        arguments.push_arg(token_identifier);

        let (address, _) = self.send_raw().deploy_from_source_contract(
            self.blockchain().get_gas_left(),
            &BigUint::zero(),
            &impl_address,
            CodeMetadata::UPGRADEABLE,
            &arguments,
        );

        require!(!address.is_zero(), "Token manager deployment failed");

        self.emit_token_manager_deployed_event(
            token_id,
            token_manager_type,
            address.clone(),
            arguments,
        );

        token_manager_address_mapper.set(address.clone());

        address
    }

    fn pop_express_receive_token(
        &self,
        payload: &ManagedBuffer,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> ManagedAddress {
        let mut hash_data = ManagedBuffer::new();

        hash_data.append(payload);
        hash_data.append(command_id.as_managed_buffer());

        let hash = self.crypto().keccak256(hash_data);

        let express_receive_token_slot_mapper = self.express_receive_token_slot(&hash);

        if express_receive_token_slot_mapper.is_empty() {
            return ManagedAddress::zero();
        }

        express_receive_token_slot_mapper.take()
    }

    #[view]
    fn get_implementation(&self, token_manager_type: TokenManagerType) -> ManagedAddress {
        // Only MintBurn and LockUnlock are supported, the others are kept for EVM compatibility
        match token_manager_type {
            TokenManagerType::MintBurn => self.implementation_mint_burn().get(),
            TokenManagerType::MintBurnFrom => self.implementation_mint_burn().get(),
            TokenManagerType::LockUnlock => self.implementation_lock_unlock().get(),
            TokenManagerType::LockUnlockFee => self.implementation_lock_unlock().get(),
        }
    }

    #[storage_mapper("implementation_mint_burn")]
    fn implementation_mint_burn(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("implementation_lock_unlock")]
    fn implementation_lock_unlock(&self) -> SingleValueMapper<ManagedAddress>;
}
