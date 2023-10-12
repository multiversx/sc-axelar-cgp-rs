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

#[multiversx_sc::module]
pub trait TokenManager: proxy::ProxyModule + flow_limit::FlowLimit {
    fn init_raw(
        &self,
        interchain_token_service: ManagedAddress,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        operator: ManagedAddress,
        token_identifier: Option<EgldOrEsdtTokenIdentifier>,
    ) {
        require!(
            !interchain_token_service.is_zero(),
            "Token linker zero address"
        );

        self.interchain_token_service()
            .set_if_empty(interchain_token_service);
        self.token_id().set_if_empty(token_id);
        self.operator().set_if_empty(operator);

        if token_identifier.is_some() {
            self.token_identifier().set_if_empty(token_identifier.unwrap());
        }
    }

    #[endpoint(setFlowLimit)]
    fn set_flow_limit(&self, flow_limit: BigUint) {
        self.only_operator();

        self.set_flow_limit_raw(flow_limit);
    }

    fn interchain_transfer_raw(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        metadata: ManagedBuffer,
    ) -> (ManagedAddress, BigUint) {
        let amount = self.require_correct_token();

        let sender = self.blockchain().get_caller();

        self.interchain_token_service_transmit_send_token(
            self.token_id().get(),
            &sender,
            destination_chain,
            destination_address,
            &amount,
            metadata,
        );

        self.add_flow_out(&amount);

        (sender, amount)
    }

    fn call_contract_with_interchain_token_raw(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        data: ManagedBuffer,
    ) -> (ManagedAddress, BigUint) {
        let amount = self.require_correct_token();

        let sender = self.blockchain().get_caller();

        let mut payload = ManagedBuffer::new();

        let metadata = Metadata {
            version: 0,
            metadata: data,
        };

        let _ = metadata.top_encode(&mut payload);

        self.interchain_token_service_transmit_send_token(
            self.token_id().get(),
            &sender,
            destination_chain,
            destination_address,
            &amount,
            payload,
        );

        self.add_flow_out(&amount);

        (sender, amount)
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

    // TODO: This comes from Operatable which also has other functions, check if they are needed
    fn only_operator(&self) {
        require!(
            self.blockchain().get_caller() == self.operator().get(),
            "Not operator"
        );
    }

    fn require_correct_token(&self) -> BigUint {
        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        let required_token_identifier = self.token_identifier().get();

        require!(token_identifier == required_token_identifier, "Wrong token sent");

        amount
    }

    #[view(tokenId)]
    #[storage_mapper("token_id")]
    fn token_id(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[view]
    #[storage_mapper("operator")]
    fn operator(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(tokenIdentifier)]
    #[storage_mapper("token_identifier")]
    fn token_identifier(&self) -> SingleValueMapper<EgldOrEsdtTokenIdentifier>;
}
