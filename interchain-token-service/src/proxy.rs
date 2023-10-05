multiversx_sc::imports!();

use crate::executable::gateway_proxy::ProxyTrait as GatewayProxyTrait;
use crate::executable::remote_address_validator_proxy::ProxyTrait as RemoteAddressValidatorProxyTrait;
use crate::executable::token_manager_proxy::ProxyTrait as TokenManagerProxyTrait;
use crate::{events, executable};
use multiversx_sc::api::KECCAK256_RESULT_LEN;

mod gas_service_proxy {
    multiversx_sc::imports!();

    #[multiversx_sc::proxy]
    pub trait GasServiceProxy {
        #[payable("EGLD")]
        #[endpoint(payNativeGasForContractCall)]
        fn pay_native_gas_for_contract_call(
            &self,
            destination_chain: &ManagedBuffer,
            destination_address: &ManagedBuffer,
            payload: &ManagedBuffer,
            refund_address: ManagedAddress,
        );
    }
}

#[multiversx_sc::module]
pub trait ProxyModule:
    executable::ExecutableModule + events::EventsModule + multiversx_sc_modules::pause::PauseModule
{
    fn remote_address_validator_chain_name(&self) -> ManagedBuffer {
        self.remote_address_validator_proxy(self.remote_address_validator().get())
            .chain_name()
            .execute_on_dest_context()
    }

    fn remote_address_validator_get_remote_address(
        &self,
        destination_chain: &ManagedBuffer,
    ) -> ManagedBuffer {
        self.remote_address_validator_proxy(self.remote_address_validator().get())
            .get_remote_address(destination_chain)
            .execute_on_dest_context()
    }

    fn gas_service_pay_native_gas_for_contract_call(
        &self,
        destination_chain: &ManagedBuffer,
        destination_address: &ManagedBuffer,
        payload: &ManagedBuffer,
        gas_value: &BigUint,
    ) {
        self.gas_service_proxy(self.gas_service().get())
            .pay_native_gas_for_contract_call(
                destination_chain,
                destination_address,
                payload,
                self.blockchain().get_caller(),
            )
            .with_egld_transfer(gas_value.clone())
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

    fn gateway_is_command_executed(&self, command_id: &ManagedBuffer) -> bool {
        self.gateway_proxy(self.gateway().get())
            .is_command_executed(command_id)
            .execute_on_dest_context::<bool>()
    }

    fn token_manager_take_token(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        sender: &ManagedAddress,
        amount: BigUint,
    ) {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .take_token(sender)
            .with_egld_or_single_esdt_transfer(EgldOrEsdtTokenPayment::new(
                token_identifier,
                0,
                amount,
            ))
            .execute_on_dest_context::<()>();
    }

    fn token_manager_set_flow_limit(
        &self,
        token_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        flow_limit: &BigUint,
    ) {
        self.token_manager_proxy(self.get_valid_token_manager_address(token_id))
            .set_flow_limit(flow_limit)
            .execute_on_dest_context::<()>();
    }

    #[view]
    fn get_flow_limit(&self, token_id: ManagedByteArray<KECCAK256_RESULT_LEN>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(&token_id))
            .get_flow_limit()
            .execute_on_dest_context()
    }

    #[view]
    fn get_flow_out_amount(&self, token_id: ManagedByteArray<KECCAK256_RESULT_LEN>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(&token_id))
            .get_flow_out_amount()
            .execute_on_dest_context()
    }

    #[view]
    fn get_flow_in_amount(&self, token_id: ManagedByteArray<KECCAK256_RESULT_LEN>) -> BigUint {
        self.token_manager_proxy(self.get_valid_token_manager_address(&token_id))
            .get_flow_in_amount()
            .execute_on_dest_context()
    }

    #[storage_mapper("gas_service")]
    fn gas_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn gas_service_proxy(&self, sc_address: ManagedAddress) -> gas_service_proxy::Proxy<Self::Api>;
}
