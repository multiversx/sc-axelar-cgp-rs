#![no_std]

mod proxy;

multiversx_sc::imports!();

use core::ptr::metadata;
use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopEncode, TopDecode)]
pub struct Metadata<M: ManagedTypeApi> {
    pub version: u32,
    pub metadata: ManagedBuffer<M>,
}

#[multiversx_sc::module]
pub trait TokenManager: proxy::ProxyModule + flow_limit::FlowLimit {
    #[init]
    fn init(
        &self,
        interchain_token_service: ManagedAddress,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        operator: ManagedAddress,
        token_address: Option<EgldOrEsdtTokenIdentifier>, // TODO: This is an option here since the TokenManager should deploy the tokens on MultiversX
    ) {
        require!(
            !interchain_token_service.is_zero(),
            "Token linker zero address"
        );

        self.interchain_token_service()
            .set_if_empty(interchain_token_service);
        self.token_id().set_if_empty(token_id);
        self.operator().set_if_empty(operator);

        if token_address.is_some() {
            self.token_address().set_if_empty(token_address.unwrap());
        }
    }

    // TODO: This should be moved to a higher trait module, since traits can not have `abstract` functions in Rust
    // #[payable("*")]
    // #[endpoint(interchainTransfer)]
    // fn interchain_transfer(
    //     &self,
    //     destination_chain: ManagedBuffer,
    //     destination_address: ManagedBuffer,
    //     metadata: ManagedBuffer,
    // ) {
    //     let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();
    //
    //     let token_address = self.token_address().get();
    //
    //     require!(token_identifier == token_address, "Wrong token sent");
    //
    //     let sender = self.blockchain().get_caller();
    //
    //     let amount = self.take_token_raw(sender, amount);
    //
    //     self.add_flow_out(amount);
    //
    //     self.interchain_token_service_transmit_send_token(
    //         self.token_id().get(),
    //         sender,
    //         destination_chain,
    //         destination_address,
    //         amount,
    //         metadata,
    //     );
    // }

    // #[payable("*")]
    // #[endpoint(callContractWithInterchainToken)]
    // fn call_contract_with_interchain_token(
    //     &self,
    //     destination_chain: ManagedBuffer,
    //     destination_address: ManagedBuffer,
    //     data: ManagedBuffer,
    // ) {
    //     let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();
    //
    //     let token_address = self.token_address().get();
    //
    //     require!(token_identifier == token_address, "Wrong token sent");
    //
    //     let sender = self.blockchain().get_caller();
    //
    //     let amount = self.take_token_raw(sender, amount);
    //
    //     self.add_flow_out(amount);
    //
    //     let mut payload = ManagedBuffer::new();
    //
    //     let metadata = Metadata {
    //         version: 0,
    //         metadata: data,
    //     };
    //
    //     metadata.top_encode(&mut payload);
    //
    //     self.interchain_token_service_transmit_send_token(
    //         self.token_id().get(),
    //         sender,
    //         destination_chain,
    //         destination_address,
    //         amount,
    //         payload,
    //     );
    // }

    // TODO: A take_token endpoint that can be called only be InterchainTokenService should exist
    // fn take_token_raw(&self, sender: &ManagedAddress) -> BigUint;

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

    // TODO: This also has an only_token function which can not be implemented on MultiversX

    #[view(tokenId)]
    #[storage_mapper("token_id")]
    fn token_id(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[view]
    #[storage_mapper("operator")]
    fn operator(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(tokenAddress)]
    #[storage_mapper("token_address")]
    fn token_address(&self) -> SingleValueMapper<EgldOrEsdtTokenIdentifier>;
}
