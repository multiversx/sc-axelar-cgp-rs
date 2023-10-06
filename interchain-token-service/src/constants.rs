multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::codec::{EncodeError, NestedDecodeInput, TopDecodeInput, TopEncodeOutput};

use multiversx_sc::api::KECCAK256_RESULT_LEN;

pub const PREFIX_CUSTOM_TOKEN_ID: &[u8] = b"its-custom-token-id";
pub const PREFIX_STANDARDIZED_TOKEN_ID: &[u8] = b"its-standardized-token-id";

pub const SELECTOR_SEND_TOKEN: u32 = 1;
pub const SELECTOR_SEND_TOKEN_WITH_DATA: u32 = 2;
pub const SELECTOR_DEPLOY_TOKEN_MANAGER: u32 = 3;
pub const SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN: u32 = 4;

pub type TokenId<M> = ManagedByteArray<M, KECCAK256_RESULT_LEN>;

#[derive(TypeAbi, TopEncode, TopDecode, NestedEncode, NestedDecode, Clone, Copy)]
pub enum TokenManagerType {
    LockUnlock,
    MintBurn,
}

#[derive(TypeAbi)]
pub struct SendTokenPayload<M: ManagedTypeApi> {
    pub selector: BigUint<M>,
    pub token_id: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub destination_address: ManagedBuffer<M>,
    pub amount: BigUint<M>,
    pub source_address: Option<ManagedBuffer<M>>,
    pub data: Option<ManagedBuffer<M>>,
}

impl<M: ManagedTypeApi> TopDecode for SendTokenPayload<M> {
    fn top_decode<I>(input: I) -> Result<Self, DecodeError>
        where
            I: TopDecodeInput,
    {
        let mut input = input.into_nested_buffer();

        // TODO: In solidity this uses ABI encode/decode, check if this is correct
        let selector = BigUint::dep_decode(&mut input)?;
        let token_id = ManagedByteArray::<M, KECCAK256_RESULT_LEN>::dep_decode(&mut input)?;
        let destination_address = ManagedBuffer::dep_decode(&mut input)?;
        let amount = BigUint::dep_decode(&mut input)?;

        if input.is_depleted() {
            return Result::Ok(SendTokenPayload {
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

        Result::Ok(SendTokenPayload {
            selector,
            token_id,
            destination_address,
            amount,
            source_address: Some(source_address),
            data: Some(data),
        })
    }
}

impl<M: ManagedTypeApi> TopEncode for SendTokenPayload<M> {
    fn top_encode<O>(&self, output_raw: O) -> Result<(), EncodeError>
        where
            O: TopEncodeOutput,
    {
        // TODO: Check if this encoding works properly
        let mut output = output_raw.start_nested_encode();

        self.selector.dep_encode(&mut output)?;
        self.token_id.dep_encode(&mut output)?;
        self.destination_address.dep_encode(&mut output)?;
        self.amount.dep_encode(&mut output)?;

        if self.source_address.is_some() && self.data.is_some() {
            self.source_address.dep_encode(&mut output)?;
            self.data.dep_encode(&mut output)?;
        }

        output_raw.finalize_nested_encode(output);

        Result::Ok(())
    }
}

#[derive(TypeAbi, TopEncode, TopDecode)]
pub struct Metadata<M: ManagedTypeApi> {
    pub version: u32,
    pub metadata: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopDecode, NestedDecode)]
pub struct DeployTokenManagerParams<M: ManagedTypeApi> {
    pub operator: ManagedAddress<M>,
    pub token_address: EgldOrEsdtTokenIdentifier<M>,
}

#[derive(TypeAbi, TopDecode)]
pub struct DeployTokenManagerPayload<M: ManagedTypeApi> {
    pub selector: BigUint<M>,
    pub token_id: TokenId<M>,
    pub token_manager_type: TokenManagerType,
    pub params: DeployTokenManagerParams<M>,
}

#[derive(TypeAbi, TopDecode, TopEncode)]
pub struct DeployStandardizedTokenAndManagerPayload<M: ManagedTypeApi> {
    pub selector: BigUint<M>,
    pub token_id: TokenId<M>,
    pub name: ManagedBuffer<M>,
    pub symbol: ManagedBuffer<M>,
    pub decimals: u8,
    pub distributor: ManagedBuffer<M>,
    pub mint_to: ManagedBuffer<M>,
    pub mint_amount: BigUint<M>,
    pub operator: ManagedBuffer<M>,
}
