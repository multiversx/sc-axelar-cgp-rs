multiversx_sc::imports!();

use crate::constants::{Hash, ManagedBufferAscii, TokenId};
use core::ops::Deref;

use interchain_token_service::address_tracker::ProxyTrait as _;
use interchain_token_service::proxy_its::ProxyTrait as _;
use interchain_token_service::user_functions::ProxyTrait as _;
use operatable::ProxyTrait as _;
use token_manager::constants::TokenManagerType;
use token_manager::mintership::ProxyTrait as _;
use token_manager::ProxyTrait as _;

const ESDT_PROPERTIES_TOKEN_NAME_INDEX: usize = 0;
const ESDT_PROPERTIES_TOKEN_TYPE_INDEX: usize = 1;
const ESDT_PROPERTIES_DECIMALS_BUFFER_INDEX: usize = 5;

#[multiversx_sc::module]
pub trait ProxyModule {
    fn its_chain_name(&self) -> ManagedBuffer {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .chain_name()
            .execute_on_dest_context()
    }

    fn its_interchain_token_id(&self, deploy_salt: &Hash<Self::Api>) -> TokenId<Self::Api> {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .interchain_token_id(ManagedAddress::zero(), deploy_salt)
            .execute_on_dest_context()
    }

    fn its_deploy_interchain_token(
        &self,
        deploy_salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        minter: &ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .deploy_interchain_token(
                deploy_salt,
                destination_chain,
                name,
                symbol,
                decimals,
                minter,
            )
            .with_egld_transfer(gas_value)
            .execute_on_dest_context::<()>();
    }

    fn its_invalid_token_manager_address(&self, token_id: &TokenId<Self::Api>) -> ManagedAddress {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .invalid_token_manager_address(token_id)
            .execute_on_dest_context()
    }

    fn its_deployed_token_manager(&self, token_id: &TokenId<Self::Api>) -> ManagedAddress {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .deployed_token_manager(token_id)
            .execute_on_dest_context()
    }

    fn its_register_custom_token(
        &self,
        deploy_salt: Hash<Self::Api>,
        token_identifier: EgldOrEsdtTokenIdentifier,
        token_manager_type: TokenManagerType,
        link_params: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .register_custom_token(
                deploy_salt,
                token_identifier,
                token_manager_type,
                link_params,
            )
            .execute_on_dest_context()
    }

    fn its_link_token(
        &self,
        deploy_salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_token_address: ManagedBuffer,
        token_manager_type: TokenManagerType,
        link_params: ManagedBuffer,
        gas_value: BigUint,
    ) -> TokenId<Self::Api> {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .link_token(
                deploy_salt,
                destination_chain,
                destination_token_address,
                token_manager_type,
                link_params,
            )
            .with_egld_transfer(gas_value)
            .execute_on_dest_context()
    }

    fn its_trusted_address(&self, chain_name: &ManagedBuffer) -> ManagedBuffer {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .trusted_address(chain_name)
            .execute_on_dest_context()
    }

    fn its_registered_token_identifier(
        &self,
        token_id: &TokenId<Self::Api>,
    ) -> EgldOrEsdtTokenIdentifier {
        self.interchain_token_service_proxy(self.interchain_token_service().get())
            .registered_token_identifier(token_id)
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
        let mut contract_call = self.send().contract_call::<()>(
            ESDTSystemSCAddress.to_managed_address(),
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
    fn token_manager_proxy(&self, sc_address: ManagedAddress) -> token_manager::Proxy<Self::Api>;

    // This was tested on devnet and worked fine
    #[callback]
    fn deploy_remote_token_callback(
        &self,
        deploy_salt: Hash<Self::Api>,
        destination_chain: ManagedBuffer,
        token_symbol: ManagedBuffer,
        destination_minter: &ManagedBuffer,
        gas_value: BigUint,
        caller: ManagedAddress,
        #[call_result] result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(values) => {
                let vec: ManagedVec<ManagedBuffer> = values.into_vec_of_buffers();

                let token_name = vec.get(ESDT_PROPERTIES_TOKEN_NAME_INDEX).clone_value();
                let token_type = vec.get(ESDT_PROPERTIES_TOKEN_TYPE_INDEX);
                let decimals_buffer_ref = vec.get(ESDT_PROPERTIES_DECIMALS_BUFFER_INDEX);

                if token_type.deref() != EsdtTokenType::Fungible.as_type_name() {
                    // Send back paid cross chain gas value to initial caller if token is non fungible
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
                    deploy_salt,
                    destination_chain,
                    token_name,
                    token_symbol,
                    token_decimals,
                    destination_minter,
                    gas_value,
                );
            }
            ManagedAsyncCallResult::Err(_) => {
                // Send back paid gas value to initial caller
                self.send().direct_non_zero_egld(&caller, &gas_value);
            }
        }
    }
}
