multiversx_sc::imports!();

use crate::constants::{Hash, TokenId, ManagedBufferAscii};
use multiversx_sc::api::KECCAK256_RESULT_LEN;
use core::ops::Deref;
use token_manager::TokenManagerType;

use interchain_token_service::ProxyTrait as _;
use token_manager_mint_burn::ProxyTrait as _;
use token_manager::ProxyTrait as _;
use interchain_token_service::proxy::ProxyTrait as _;
use token_manager_mint_burn::distributable::ProxyTrait as _;
use operatable::ProxyTrait as _;

#[multiversx_sc::module]
pub trait ProxyModule {
    fn service_chain_name_hash(&self) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        self.service_proxy(self.service().get())
            .chain_name_hash()
            .execute_on_dest_context()
    }

    fn service_interchain_token_id(
        &self,
        sender: &ManagedAddress,
        salt: &Hash<Self::Api>,
    ) -> TokenId<Self::Api> {
        self.service_proxy(self.service().get())
            .interchain_token_id(sender, salt)
            .execute_on_dest_context()
    }

    fn service_deploy_interchain_token(
        &self,
        salt: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        distributor: &ManagedBuffer,
        gas_value: BigUint,
    ) {
        self
            .service_proxy(self.service().get())
            .deploy_interchain_token(salt, destination_chain, name, symbol, decimals, distributor)
            .with_egld_transfer(gas_value)
            .execute_on_dest_context::<()>();
    }

    fn service_invalid_token_manager_address(
        &self,
        token_id: &TokenId<Self::Api>,
    ) -> ManagedAddress {
        self.service_proxy(self.service().get())
            .invalid_token_manager_address(token_id)
            .execute_on_dest_context()
    }

    fn service_interchain_valid_token_manager_address(
        &self,
        token_id: &TokenId<Self::Api>,
    ) -> ManagedAddress {
        self.service_proxy(self.service().get())
            .valid_token_manager_address(token_id)
            .execute_on_dest_context()
    }

    fn service_deploy_token_manager(
        &self,
        salt: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
        gas_value: BigUint,
    ) -> TokenId<Self::Api> {
        self
            .service_proxy(self.service().get())
            .deploy_token_manager(salt, destination_chain, token_manager_type, params)
            .with_egld_transfer(gas_value)
            .execute_on_dest_context()
    }

    fn service_interchain_transfer(
        &self,
        token_id: TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        token_identifier: EgldOrEsdtTokenIdentifier,
        amount: BigUint,
    ) {
        self.service_proxy(self.service().get())
            .interchain_transfer(token_id, destination_chain, destination_address, ManagedBuffer::new())
            .with_egld_or_single_esdt_transfer(EgldOrEsdtTokenPayment::new(
                token_identifier,
                0,
                amount,
            ))
            .execute_on_dest_context::<()>();
    }

    fn token_manager_invalid_token_identifier(
        &self,
        sc_address: ManagedAddress,
    ) -> Option<EgldOrEsdtTokenIdentifier> {
        self.token_manager_proxy(sc_address)
            .invalid_token_identifier()
            .execute_on_dest_context()
    }

    fn token_manager_token_identifier(
        &self,
        sc_address: ManagedAddress,
    ) -> EgldOrEsdtTokenIdentifier {
        self.token_manager_proxy(sc_address)
            .token_identifier()
            .execute_on_dest_context()
    }

    fn token_manager_mint(&self, sc_address: ManagedAddress, address: ManagedAddress, amount: BigUint) {
        self.token_manager_proxy(sc_address)
            .mint(address, amount)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_transfer_distributorship(&self, sc_address: ManagedAddress, distributor: ManagedAddress) {
        self.token_manager_proxy(sc_address)
            .transfer_distributorship(distributor)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_remove_flow_limiter(&self, sc_address: ManagedAddress, flow_limiter: ManagedAddress) {
        self.token_manager_proxy(sc_address)
            .remove_flow_limiter(flow_limiter)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_add_flow_limiter(&self, sc_address: ManagedAddress, flow_limiter: ManagedAddress) {
        self.token_manager_proxy(sc_address)
            .add_flow_limiter(flow_limiter)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_transfer_operatorship(&self, sc_address: ManagedAddress, operator: ManagedAddress) {
        self.token_manager_proxy(sc_address)
            .transfer_operatorship(operator)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_is_distributor(
        &self,
        sc_address: ManagedAddress,
        distributor: &ManagedAddress,
    ) -> bool {
        self.token_manager_proxy(sc_address)
            .is_distributor(distributor)
            .execute_on_dest_context()
    }

    fn esdt_get_token_properties(
        &self,
        token_identifier: EgldOrEsdtTokenIdentifier,
        callback: CallbackClosure<Self::Api>,
    ) {
        let esdt_system_sc_address =
            ESDTSystemSmartContractProxy::<Self::Api>::new_proxy_obj().esdt_system_sc_address();

        let mut contract_call = self.send().contract_call::<()>(
            esdt_system_sc_address,
            ManagedBuffer::from("getTokenProperties"),
        );
        contract_call.push_raw_argument(token_identifier.into_name());

        contract_call
            .async_call()
            .with_callback(callback)
            .call_and_exit();
    }

    #[view]
    #[storage_mapper("service")]
    fn service(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn service_proxy(
        &self,
        sc_address: ManagedAddress,
    ) -> interchain_token_service::Proxy<Self::Api>;

    #[proxy]
    fn token_manager_proxy(
        &self,
        sc_address: ManagedAddress,
    ) -> token_manager_mint_burn::Proxy<Self::Api>;

    // TODO: Test that this callback works properly (probably only on devnet)
    #[callback]
    fn deploy_remote_token_callback(
        &self,
        salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
        token_symbol: ManagedBuffer,
        distributor_raw: &ManagedBuffer,
        gas_value: BigUint,
        caller: ManagedAddress,
        #[call_result] result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(values) => {
                let vec: ManagedVec<ManagedBuffer> = values.into_vec_of_buffers();

                let token_name = vec.get(0).clone_value();
                let token_type = vec.get(1);
                let decimals_buffer_ref = vec.get(5);

                if token_type.deref() != EsdtTokenType::Fungible.as_type_name() {
                    // Send back payed cross chain gas value to initial caller if token is non fungible
                    self.send().direct_non_zero_egld(&caller, &gas_value);

                    return;
                }

                let decimals_buffer = decimals_buffer_ref.deref();
                // num decimals is in format string NumDecimals-DECIMALS
                // skip `NumDecimals-` part and convert to number
                let token_decimals_buf: ManagedBuffer = decimals_buffer
                    .copy_slice(12, decimals_buffer.len() - 12)
                    .unwrap();
                let token_decimals = token_decimals_buf.ascii_to_u8();

                self.service_deploy_interchain_token(
                    salt,
                    destination_chain,
                    token_name,
                    token_symbol,
                    token_decimals,
                    distributor_raw,
                    gas_value,
                );
            }
            ManagedAsyncCallResult::Err(_) => {
                // Send back payed gas value to initial caller
                self.send().direct_non_zero_egld(&caller, &gas_value);
            }
        }
    }
}