multiversx_sc::imports!();

use crate::constants::{Hash, ManagedBufferAscii, TokenId};
use core::ops::Deref;
use multiversx_sc::api::KECCAK256_RESULT_LEN;

use interchain_token_service::proxy::ProxyTrait as _;
use interchain_token_service::ProxyTrait as _;
use operatable::ProxyTrait as _;
use token_manager::constants::TokenManagerType;
use token_manager::minter::ProxyTrait as _;
use token_manager::ProxyTrait as _;

#[multiversx_sc::module]
pub trait ProxyModule {
    fn its_chain_name_hash(&self) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .chain_name_hash()
            .execute_on_dest_context()
    }

    fn its_interchain_token_id(
        &self,
        sender: &ManagedAddress,
        salt: &Hash<Self::Api>,
    ) -> TokenId<Self::Api> {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .interchain_token_id(sender, salt)
            .execute_on_dest_context()
    }

    fn its_deploy_interchain_token(
        &self,
        salt: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        minter: &ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .deploy_interchain_token(salt, destination_chain, name, symbol, decimals, minter)
            .with_egld_transfer(gas_value)
            .execute_on_dest_context::<()>();
    }

    fn its_invalid_token_manager_address(&self, token_id: &TokenId<Self::Api>) -> ManagedAddress {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .invalid_token_manager_address(token_id)
            .execute_on_dest_context()
    }

    fn its_valid_token_manager_address(&self, token_id: &TokenId<Self::Api>) -> ManagedAddress {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .valid_token_manager_address(token_id)
            .execute_on_dest_context()
    }

    fn its_deploy_token_manager(
        &self,
        salt: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
        gas_value: BigUint,
    ) -> TokenId<Self::Api> {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .deploy_token_manager(salt, destination_chain, token_manager_type, params)
            .with_egld_transfer(gas_value)
            .execute_on_dest_context()
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

    fn token_manager_mint(
        &self,
        sc_address: ManagedAddress,
        address: ManagedAddress,
        amount: BigUint,
    ) {
        self.token_manager_proxy(sc_address)
            .mint(address, amount)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_transfer_mintership(
        &self,
        sc_address: ManagedAddress,
        minter: ManagedAddress,
    ) {
        self.token_manager_proxy(sc_address)
            .transfer_mintership(minter)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_remove_flow_limiter(
        &self,
        sc_address: ManagedAddress,
        flow_limiter: ManagedAddress,
    ) {
        self.token_manager_proxy(sc_address)
            .remove_flow_limiter(flow_limiter)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_add_flow_limiter(
        &self,
        sc_address: ManagedAddress,
        flow_limiter: ManagedAddress,
    ) {
        self.token_manager_proxy(sc_address)
            .add_flow_limiter(flow_limiter)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_transfer_operatorship(
        &self,
        sc_address: ManagedAddress,
        operator: ManagedAddress,
    ) {
        self.token_manager_proxy(sc_address)
            .transfer_operatorship(operator)
            .execute_on_dest_context::<()>();
    }

    fn token_manager_is_minter(&self, sc_address: ManagedAddress, minter: &ManagedAddress) -> bool {
        self.token_manager_proxy(sc_address)
            .is_minter(minter)
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
    #[storage_mapper("interchain_token_service")]
    fn interchain_token_service(&self) -> SingleValueMapper<ManagedAddress>;

    #[proxy]
    fn interchain_token_service_proxy(
        &self,
        sc_address: ManagedAddress,
    ) -> interchain_token_service::Proxy<Self::Api>;

    #[proxy]
    fn token_manager_proxy(
        &self,
        sc_address: ManagedAddress,
    ) -> token_manager::Proxy<Self::Api>;

    // TODO: Test that this callback works properly (probably only on devnet)
    #[callback]
    fn deploy_remote_token_callback(
        &self,
        salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
        token_symbol: ManagedBuffer,
        minter_raw: &ManagedBuffer,
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

                self.its_deploy_interchain_token(
                    salt,
                    destination_chain,
                    token_name,
                    token_symbol,
                    token_decimals,
                    minter_raw,
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
