use crate::abi::AbiEncodeDecode;
use crate::abi_types::SendToHubPayload;
use crate::address_tracker;
use crate::constants::{Hash, ITS_HUB_CHAIN_NAME, MESSAGE_TYPE_SEND_TO_HUB};
use gas_service::ProxyTrait as _;
use gateway::ProxyTrait as _;

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait ProxyGmpModule: address_tracker::AddressTracker {
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
        payload_hash: &Hash<Self::Api>,
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
        payload_hash: &Hash<Self::Api>,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .is_message_approved(
                source_chain,
                message_id,
                source_address,
                self.blockchain().get_sc_address(),
                payload_hash,
            )
            .execute_on_dest_context::<bool>()
    }

    fn route_message_through_its_hub(
        &self,
        destination_chain: ManagedBuffer,
        payload: ManagedBuffer,
        gas_value: BigUint,
    ) {
        // Prevent sending directly to the ITS Hub chain. This is not supported yet, so fail early to prevent the user from having their funds stuck.
        require!(destination_chain != *ITS_HUB_CHAIN_NAME, "Untrusted chain");
        require!(self.is_trusted_chain(&destination_chain), "Untrusted chain");

        let data = SendToHubPayload::<Self::Api> {
            message_type: BigUint::from(MESSAGE_TYPE_SEND_TO_HUB),
            destination_chain,
            payload,
        };

        // Send wrapped message to ITS Hub chain and to ITS Hub true address
        let payload = data.abi_encode();

        self.call_contract_its_hub(payload, gas_value);
    }

    fn call_contract_its_hub(&self, payload: ManagedBuffer, gas_value: BigUint) {
        let its_hub_chain_name = ManagedBuffer::from(ITS_HUB_CHAIN_NAME);
        let its_hub_address = self.its_hub_address().get();

        if gas_value > 0 {
            self.gas_service_pay_native_gas_for_contract_call(
                &its_hub_chain_name,
                &its_hub_address,
                &payload,
                gas_value,
            );
        }

        self.gateway_call_contract(&its_hub_chain_name, &its_hub_address, &payload);
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
