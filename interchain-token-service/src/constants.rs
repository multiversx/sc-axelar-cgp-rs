multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use crate::abi::{abi_decode, abi_encode, AbiDecode, AbiEncode, ParamType, Token};
use multiversx_sc::api::KECCAK256_RESULT_LEN;

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

#[derive(TypeAbi, Debug)]
pub struct SendTokenPayload<M: ManagedTypeApi> {
    pub selector: BigUint<M>,
    pub token_id: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub destination_address: ManagedBuffer<M>,
    pub amount: BigUint<M>,
    pub source_address: Option<ManagedBuffer<M>>,
    pub data: Option<ManagedBuffer<M>>,
}

impl<M: ManagedTypeApi> AbiDecode<M> for SendTokenPayload<M> {
    fn abi_decode(payload: ManagedBuffer<M>) -> Self {
        let mut result = ArrayVec::<Token<M>, 4>::new();
        abi_decode(
            &[
                ParamType::Uint256,
                ParamType::Bytes32,
                ParamType::Bytes,
                ParamType::Uint256,
            ],
            &payload,
            &mut result,
            0,
        );

        let amount = result.pop().unwrap().into_biguint();
        let destination_address = result.pop().unwrap().into_managed_buffer();
        let token_id = result.pop().unwrap().into_managed_byte_array();
        let selector = result.pop().unwrap().into_biguint();

        let mut source_address = None;
        let mut data = None;
        if selector == BigUint::from(SELECTOR_RECEIVE_TOKEN_WITH_DATA) {
            let mut result = ArrayVec::<Token<M>, 2>::new();
            abi_decode(
                &[
                    ParamType::Bytes,
                    ParamType::Bytes
                ],
                &payload,
                &mut result,
                4,
            );

            data = Some(result.pop().unwrap().into_managed_buffer());
            source_address = Some(result.pop().unwrap().into_managed_buffer());
        }

        SendTokenPayload {
            selector,
            token_id,
            destination_address,
            amount,
            source_address,
            data,
        }
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
