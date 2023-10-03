multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::codec::{NestedDecodeInput, TopDecodeInput};

use multiversx_sc::api::KECCAK256_RESULT_LEN;

pub const PREFIX_CUSTOM_TOKEN_ID: &[u8] = b"its-custom-token-id";
pub const PREFIX_STANDARDIZED_TOKEN_ID: &[u8] = b"its-standardized-token-id";
pub const PREFIX_STANDARDIZED_TOKEN_SALT : &[u8] = b"its-standardized-token-salt";

pub const SELECTOR_SEND_TOKEN: u32 = 1;
pub const SELECTOR_SEND_TOKEN_WITH_DATA: u32 = 2;
pub const SELECTOR_DEPLOY_TOKEN_MANAGER: u32 = 3;
pub const SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN: u32 = 4;

#[derive(TypeAbi, TopEncode, TopDecode, NestedEncode, Clone, Copy)]
pub enum TokenManagerType {
    LockUnlock,
    MintBurn,
}

#[derive(TypeAbi, TopEncode)]
pub struct ReceiveTokenPayload<M: ManagedTypeApi> {
    pub selector: BigUint<M>,
    pub token_id: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub destination_address: ManagedAddress<M>,
    pub amount: BigUint<M>,
    pub source_address: Option<ManagedBuffer<M>>,
    pub data: Option<ManagedBuffer<M>>,
}

impl<M: ManagedTypeApi> TopDecode for ReceiveTokenPayload<M> {
    fn top_decode<I>(input: I) -> Result<Self, DecodeError>
        where
            I: TopDecodeInput,
    {
        let mut input = input.into_nested_buffer();

        let selector = BigUint::dep_decode(&mut input)?;
        let token_id = ManagedByteArray::<M, KECCAK256_RESULT_LEN>::dep_decode(&mut input)?;
        let destination_address = ManagedAddress::dep_decode(&mut input)?;
        let amount = BigUint::dep_decode(&mut input)?;

        if input.is_depleted() {
            return Result::Ok(ReceiveTokenPayload {
                selector,
                token_id,
                destination_address,
                amount,
                source_address: None,
                data: None,
            });
        }

        let source_address = ManagedBuffer::<M>::dep_decode(&mut input)?;
        let data = ManagedBuffer::<M>::dep_decode(&mut input)?;

        Result::Ok(ReceiveTokenPayload {
            selector,
            token_id,
            destination_address,
            amount,
            source_address: Some(source_address),
            data: Some(data),
        })
    }
}
