multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::codec::{EncodeError, NestedDecodeInput, NestedEncodeOutput, TopDecodeInput, TopEncodeOutput};

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use crate::abi::{abi_encode, AbiEncode, Token};

pub const PREFIX_STANDARDIZED_TOKEN_ID: &[u8] = b"its-standardized-token-id";
pub const PREFIX_CUSTOM_TOKEN_ID: &[u8] = b"its-custom-token-id";

pub const SELECTOR_RECEIVE_TOKEN: u32 = 1;
pub const SELECTOR_RECEIVE_TOKEN_WITH_DATA: u32 = 2;
pub const SELECTOR_DEPLOY_TOKEN_MANAGER: u32 = 3;
pub const SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN: u32 = 4;

pub type TokenId<M> = ManagedByteArray<M, KECCAK256_RESULT_LEN>;

// Enum has same types as on EVM for compatibility
#[derive(TypeAbi, TopEncode, TopDecode, NestedEncode, NestedDecode, Clone, Copy)]
pub enum TokenManagerType {
    MintBurn,
    MintBurnFrom,
    LockUnlock,
    LockUnlockFee,
}

impl TokenManagerType {
    fn to_u8(&self) -> u8 {
        match self {
            TokenManagerType::MintBurn => 0,
            TokenManagerType::MintBurnFrom => 1,
            TokenManagerType::LockUnlock => 2,
            TokenManagerType::LockUnlockFee => 3,
        }
    }
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


impl<M: ManagedTypeApi> AbiEncode<M> for SendTokenPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        if self.source_address.is_none() || self.data.is_none() {
            return abi_encode(&[
                Token::Uint256(self.selector),
                Token::Bytes32(self.token_id),
                Token::Bytes(self.destination_address),
                Token::Uint256(self.amount),
            ]);
        }

        return abi_encode(&[
            Token::Uint256(self.selector),
            Token::Bytes32(self.token_id),
            Token::Bytes(self.destination_address),
            Token::Uint256(self.amount),
            Token::Bytes(self.source_address.unwrap()),
            Token::Bytes(self.data.unwrap()),
        ]);
    }
}

#[derive(TypeAbi, TopEncode, TopDecode)]
pub struct Metadata<M: ManagedTypeApi> {
    pub version: u32,
    pub metadata: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopDecode)]
pub struct DeployTokenManagerParams<M: ManagedTypeApi> {
    pub operator: ManagedAddress<M>,
    pub token_identifier: EgldOrEsdtTokenIdentifier<M>,
}

#[derive(TypeAbi, TopDecode)]
pub struct DeployTokenManagerPayload<M: ManagedTypeApi> {
    pub selector: BigUint<M>,
    pub token_id: TokenId<M>,
    pub token_manager_type: TokenManagerType,
    pub params: ManagedBuffer<M>,
}

impl<M: ManagedTypeApi> AbiEncode<M> for DeployTokenManagerPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        return abi_encode(&[
            Token::Uint256(self.selector),
            Token::Bytes32(self.token_id),
            Token::Uint8(self.token_manager_type.to_u8()),
            Token::Bytes(self.params),
        ]);
    }
}

#[derive(TypeAbi, TopDecode)]
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

impl<M: ManagedTypeApi> AbiEncode<M> for DeployStandardizedTokenAndManagerPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        return abi_encode(&[
            Token::Uint256(self.selector),
            Token::Bytes32(self.token_id),
            Token::String(self.name),
            Token::String(self.symbol),
            Token::Uint8(self.decimals),
            Token::Bytes(self.distributor),
            Token::Bytes(self.mint_to),
            Token::Uint256(self.mint_amount),
            Token::Bytes(self.operator),
        ]);
    }
}

pub trait ManagedBufferAscii<M: ManagedTypeApi> {
    fn ascii_to_u8(&self) -> u8;
}

impl<M: ManagedTypeApi> ManagedBufferAscii<M> for ManagedBuffer<M> {
    fn ascii_to_u8(&self) -> u8 {
        let mut result: u8 = 0;

        self.for_each_batch::<32, _>(|batch| {
            for &byte in batch {
                if byte == 0 {
                    break;
                }

                result *= 10;
                result += (byte as char).to_digit(16).unwrap() as u8;
            }
        });

        result
    }
}
