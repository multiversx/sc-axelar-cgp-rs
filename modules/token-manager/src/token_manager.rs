#![no_std]

pub mod proxy;

multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopEncode, TopDecode)]
pub struct Metadata<M: ManagedTypeApi> {
    pub version: u32,
    pub metadata: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopEncode, TopDecode)]
pub enum TokenManagerType {
    MintBurn,
    MintBurnFrom,
    LockUnlock,
    LockUnlockFee,
}

pub const LATEST_METADATA_VERSION: u32 = 0;

#[multiversx_sc::module]
pub trait TokenManager:
    proxy::ProxyModule + flow_limit::FlowLimit + operatable::Operatable
{
    #[endpoint(addFlowLimiter)]
    fn add_flow_limiter(&self, flow_limiter: ManagedAddress) {
        self.only_operator();

        self.add_account_roles(flow_limiter, Roles::FLOW_LIMITER);
    }

    #[endpoint(removeFlowLimiter)]
    fn remove_flow_limiter(&self, flow_limiter: ManagedAddress) {
        self.only_operator();

        self.remove_account_roles(flow_limiter, Roles::FLOW_LIMITER);
    }

    #[endpoint(setFlowLimit)]
    fn set_flow_limit(&self, flow_limit: BigUint) {
        self.only_flow_limiter();

        self.set_flow_limit_raw(flow_limit, self.interchain_token_id().get());
    }

    fn init_raw(
        &self,
        interchain_token_service: ManagedAddress,
        interchain_token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        operator_opt: Option<ManagedAddress>,
        token_identifier: Option<EgldOrEsdtTokenIdentifier>,
    ) {
        require!(!interchain_token_service.is_zero(), "Zero address");

        self.interchain_token_service()
            .set_if_empty(interchain_token_service.clone());
        self.interchain_token_id().set_if_empty(interchain_token_id);

        let mut operator;
        if operator_opt.is_none() {
            operator = interchain_token_service;
        } else {
            operator = operator_opt.unwrap();

            // Add flow limiter role to the service by default. The operator can remove this if they so choose.
            self.add_account_roles(interchain_token_service, Roles::FLOW_LIMITER);
        }

        self.add_account_roles(operator, Roles::FLOW_LIMITER | Roles::OPERATOR);

        if token_identifier.is_some() {
            self.token_identifier()
                .set_if_empty(token_identifier.unwrap());
        }
    }

    fn interchain_transfer_raw(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        metadata: ManagedBuffer,
    ) -> BigUint {
        let amount = self.require_correct_token();

        self.add_flow_out(&amount);

        let sender = self.blockchain().get_caller();

        self.interchain_token_service_transmit_interchain_transfer(
            self.interchain_token_id().get(),
            &sender,
            destination_chain,
            destination_address,
            &amount,
            metadata,
        );

        amount
    }

    fn call_contract_with_interchain_token_raw(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        data: ManagedBuffer,
    ) -> BigUint {
        let amount = self.require_correct_token();

        self.add_flow_out(&amount);

        let sender = self.blockchain().get_caller();

        let mut payload = ManagedBuffer::new();

        let metadata = Metadata {
            version: LATEST_METADATA_VERSION,
            metadata: data,
        };

        let _ = metadata.top_encode(&mut payload);

        self.interchain_token_service_transmit_interchain_transfer(
            self.interchain_token_id().get(),
            &sender,
            destination_chain,
            destination_address,
            &amount,
            payload,
        );

        amount
    }

    fn give_token_endpoint(&self, amount: &BigUint) {
        self.only_service();

        self.add_flow_in(amount);
    }

    fn take_token_endpoint(&self) -> BigUint {
        self.only_service();

        let amount = self.require_correct_token();

        self.add_flow_out(&amount);

        amount
    }

    fn only_service(&self) {
        require!(
            self.blockchain().get_caller() == self.interchain_token_service().get(),
            "Not service"
        );
    }

    fn only_flow_limiter(&self) {
        self.only_role(Roles::FLOW_LIMITER);
    }

    fn require_correct_token(&self) -> BigUint {
        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        let required_token_identifier = self.token_identifier().get();

        require!(
            token_identifier == required_token_identifier,
            "Wrong token sent"
        );

        amount
    }

    #[view(getImplementationTypeAndTokenIdentifier)]
    fn get_implementation_type_and_token_identifier(&self) -> MultiValue2((TokenManagerType, Option<EgldOrEsdtTokenIdentifier>)) {
        let token_identifier = None;

        if !self.token_identifier().is_empty() {
            token_identifier = Some(self.token_identifier().get());
        }

        (self.implementation_type().get(), token_identifier).into()
    }

    #[view(tokenId)]
    #[storage_mapper("interchain_token_id")]
    fn interchain_token_id(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[view(tokenIdentifier)]
    #[storage_mapper("token_identifier")]
    fn token_identifier(&self) -> SingleValueMapper<EgldOrEsdtTokenIdentifier>;
}
