use multiversx_sc::api::KECCAK256_RESULT_LEN;

use crate::abi::AbiEncodeDecode;
use crate::address_tracker;
use crate::constants::{
    MetadataVersion, SendToHubPayload, ITS_HUB_CHAIN_NAME,
    ITS_HUB_ROUTING_IDENTIFIER, MESSAGE_TYPE_SEND_TO_HUB,
};
use gas_service::ProxyTrait as _;
use gateway::ProxyTrait as _;

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait ProxyGmpModule: address_tracker::AddressTracker {
    fn gas_service_pay_gas_for_contract_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        token_identifier: EgldOrEsdtTokenIdentifier,
        gas_value: BigUint,
    ) {
        if token_identifier.is_egld() {
            self.gas_service_pay_native_gas_for_contract_call(
                destination_chain,
                destination_address,
                payload,
                gas_value,
            );

            return;
        }

        self.gas_service_proxy(self.gas_service().get())
            .pay_gas_for_contract_call(
                self.blockchain().get_sc_address(),
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_esdt_transfer(EsdtTokenPayment::new(
                token_identifier.unwrap_esdt(),
                0,
                gas_value,
            ))
            .execute_on_dest_context::<()>();
    }

    fn gas_service_pay_native_gas_for_contract_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.gas_service_proxy(self.gas_service().get())
            .pay_native_gas_for_contract_call(
                self.blockchain().get_sc_address(),
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_egld_transfer(gas_value)
            .execute_on_dest_context::<()>();
    }

    fn gas_service_pay_gas_for_express_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        token_identifier: EgldOrEsdtTokenIdentifier,
        gas_value: BigUint,
    ) {
        if token_identifier.is_egld() {
            self.gas_service_pay_native_gas_for_express_call(
                destination_chain,
                destination_address,
                payload,
                gas_value,
            );

            return;
        }

        self.gas_service_proxy(self.gas_service().get())
            .pay_gas_for_express_call(
                self.blockchain().get_sc_address(),
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_esdt_transfer(EsdtTokenPayment::new(
                token_identifier.unwrap_esdt(),
                0,
                gas_value,
            ))
            .execute_on_dest_context::<()>();
    }

    fn gas_service_pay_native_gas_for_express_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.gas_service_proxy(self.gas_service().get())
            .pay_native_gas_for_express_call(
                self.blockchain().get_sc_address(),
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_egld_transfer(gas_value)
            .execute_on_dest_context::<()>();
    }

    fn gateway_call_contract(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
    ) {
        self.gateway_proxy(self.gateway().get())
            .call_contract(destination_chain, destination_address, payload)
            .execute_on_dest_context::<()>();
    }

    fn gateway_validate_message(
        &self,
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .validate_message(source_chain, message_id, source_address, payload_hash)
            .execute_on_dest_context::<bool>()
    }

    fn gateway_is_message_approved(
        &self,
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .is_message_approved(
                source_chain,
                message_id,
                source_address,
                &self.blockchain().get_sc_address(),
                payload_hash,
            )
            .execute_on_dest_context::<bool>()
    }

    fn gateway_is_message_executed(
        &self,
        source_chain: &ManagedBuffer,
        message_id: &ManagedBuffer,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .is_message_executed(source_chain, message_id)
            .execute_on_dest_context::<bool>()
    }

    fn call_contract(
        &self,
        destination_chain: ManagedBuffer,
        payload: ManagedBuffer,
        metadata_version: MetadataVersion,
        gas_token: EgldOrEsdtTokenIdentifier,
        gas_value: BigUint,
    ) {
        let (destination_chain, destination_address, payload) =
            self.get_call_params(destination_chain, payload);

        if gas_value > 0 {
            match metadata_version {
                MetadataVersion::ContractCall => self.gas_service_pay_gas_for_contract_call(
                    &destination_chain,
                    &destination_address,
                    &payload,
                    gas_token,
                    gas_value,
                ),
                MetadataVersion::ExpressCall => self.gas_service_pay_gas_for_express_call(
                    &destination_chain,
                    &destination_address,
                    &payload,
                    gas_token,
                    gas_value,
                ),
            }
        }

        self.gateway_call_contract(&destination_chain, &destination_address, &payload);
    }

    fn get_call_params(
        &self,
        destination_chain: ManagedBuffer,
        payload: ManagedBuffer,
    ) -> (ManagedBuffer, ManagedBuffer, ManagedBuffer) {
        // Prevent sending directly to the ITS Hub chain. This is not supported yet, so fail early to prevent the user from having their funds stuck.
        require!(
            destination_chain != ManagedBuffer::from(ITS_HUB_CHAIN_NAME),
            "Untrusted chain"
        );

        let destination_address = self.trusted_address(&destination_chain);
        require!(!destination_address.is_empty(), "Untrusted chain");
        let destination_address = destination_address.get();

        // Check whether the ITS call should be routed via ITS hub for this destination chain
        if destination_address != ManagedBuffer::from(ITS_HUB_ROUTING_IDENTIFIER) {
            return (destination_chain, destination_address, payload);
        }

        let destination_address = self.trusted_address(&ManagedBuffer::from(ITS_HUB_CHAIN_NAME));
        require!(!destination_address.is_empty(), "Untrusted chain");
        let destination_address = destination_address.get();

        let data = SendToHubPayload::<Self::Api> {
            message_type: BigUint::from(MESSAGE_TYPE_SEND_TO_HUB),
            destination_chain,
            payload,
        };

        // Send wrapped message to ITS Hub chain and to ITS Hub true address
        return (
            ManagedBuffer::from(ITS_HUB_CHAIN_NAME),
            destination_address,
            data.abi_encode(),
        );
    }

    #[view]
    #[storage_mapper("gateway")]
    fn gateway(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(gasService)]
    #[storage_mapper("gas_service")]
    fn gas_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway::Proxy<Self::Api>;

    #[proxy]
    fn gas_service_proxy(&self, sc_address: ManagedAddress) -> gas_service::Proxy<Self::Api>;
}
