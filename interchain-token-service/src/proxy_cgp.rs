use multiversx_sc::api::KECCAK256_RESULT_LEN;

use gas_service::ProxyTrait as _;
use gateway::ProxyTrait as _;

use crate::address_tracker;
use crate::constants::MetadataVersion;

multiversx_sc::imports!();

#[multiversx_sc::module]
pub trait ProxyCgpModule: address_tracker::AddressTracker {
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

    fn gateway_is_command_executed(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .is_command_executed(command_id)
            .execute_on_dest_context::<bool>()
    }

    fn gateway_validate_contract_call(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .validate_contract_call(command_id, source_chain, source_address, payload_hash)
            .execute_on_dest_context::<bool>()
    }

    fn gateway_is_contract_call_approved(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> bool {
        self.gateway_proxy(self.gateway().get())
            .is_contract_call_approved(
                command_id,
                source_chain,
                source_address,
                &self.blockchain().get_sc_address(),
                payload_hash,
            )
            .execute_on_dest_context::<bool>()
    }

    fn call_contract(
        &self,
        destination_chain: &ManagedBuffer,
        payload: &ManagedBuffer,
        metadata_version: MetadataVersion,
        gas_token: EgldOrEsdtTokenIdentifier,
        gas_value: BigUint,
    ) {
        let destination_address = self.trusted_address(destination_chain);

        require!(!destination_address.is_empty(), "Untrusted chain");

        let destination_address = destination_address.get();

        if gas_value > 0 {
            match metadata_version {
                MetadataVersion::ContractCall => self.gas_service_pay_gas_for_contract_call(
                    destination_chain,
                    &destination_address,
                    payload,
                    gas_token,
                    gas_value,
                ),
                MetadataVersion::ExpressCall => self.gas_service_pay_gas_for_express_call(
                    destination_chain,
                    &destination_address,
                    payload,
                    gas_token,
                    gas_value,
                ),
            }
        }

        self.gateway_call_contract(destination_chain, &destination_address, payload);
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
