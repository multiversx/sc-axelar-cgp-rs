use multiversx_sc::api::KECCAK256_RESULT_LEN;
use multiversx_sc::codec::{NestedDecodeInput, TopDecodeInput};

use token_manager::constants::TokenManagerType;

use crate::abi::{AbiEncodeDecode, ParamType, Token};

multiversx_sc::imports!();
multiversx_sc::derive_imports!();

pub const PREFIX_INTERCHAIN_TOKEN_ID: &[u8] = b"its-interchain-token-id";

pub const MESSAGE_TYPE_INTERCHAIN_TRANSFER: u64 = 0;
pub const MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN: u64 = 1;
pub const MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER: u64 = 2;

pub enum MetadataVersion {
    ContractCall,
    ExpressCall,
}

impl From<u32> for MetadataVersion {
    fn from(value: u32) -> Self {
        match value {
            0 => MetadataVersion::ContractCall,
            1 => MetadataVersion::ExpressCall,
            _ => panic!("Unsupported metadata version"),
        }
    }
}

pub const LATEST_METADATA_VERSION: u32 = 1;

pub type TokenId<M> = ManagedByteArray<M, KECCAK256_RESULT_LEN>;

#[derive(TypeAbi)]
pub struct Metadata<M: ManagedTypeApi> {
    pub version: u32,
    pub data: ManagedBuffer<M>,
}

impl<M: ManagedTypeApi> TopDecode for Metadata<M> {
    fn top_decode<I>(input: I) -> Result<Self, DecodeError>
    where
        I: TopDecodeInput,
    {
        let mut buffer = input.into_nested_buffer();

        let version = u32::dep_decode(&mut buffer)?;
        let data = if !buffer.is_depleted() {
            ManagedBuffer::dep_decode(&mut buffer)?
        } else {
            ManagedBuffer::new()
        };

        Result::Ok(Metadata { version, data })
    }
}

pub struct InterchainTransferPayload<M: ManagedTypeApi> {
    pub message_type: BigUint<M>,
    pub token_id: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub source_address: ManagedBuffer<M>,
    pub destination_address: ManagedBuffer<M>,
    pub amount: BigUint<M>,
    pub data: ManagedBuffer<M>,
}

impl<M: ManagedTypeApi> AbiEncodeDecode<M> for InterchainTransferPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        Self::raw_abi_encode(&[
            Token::Uint256(self.message_type),
            Token::Bytes32(self.token_id),
            Token::Bytes(self.source_address),
            Token::Bytes(self.destination_address),
            Token::Uint256(self.amount),
            Token::Bytes(self.data),
        ])
    }

    fn abi_decode(payload: ManagedBuffer<M>) -> Self {
        let mut result = ArrayVec::<Token<M>, 6>::new();
        Self::raw_abi_decode(
            &[
                ParamType::Uint256,
                ParamType::Bytes32,
                ParamType::Bytes,
                ParamType::Bytes,
                ParamType::Uint256,
                ParamType::Bytes,
            ],
            &payload,
            &mut result,
            0,
        );

        let data = result.pop().unwrap().into_managed_buffer();
        let amount = result.pop().unwrap().into_biguint();
        let destination_address = result.pop().unwrap().into_managed_buffer();
        let source_address = result.pop().unwrap().into_managed_buffer();
        let token_id = result.pop().unwrap().into_managed_byte_array();
        let message_type = result.pop().unwrap().into_biguint();

        InterchainTransferPayload {
            message_type,
            token_id,
            source_address,
            destination_address,
            amount,
            data,
        }
    }
}

pub struct DeployInterchainTokenPayload<M: ManagedTypeApi> {
    pub message_type: BigUint<M>,
    pub token_id: TokenId<M>,
    pub name: ManagedBuffer<M>,
    pub symbol: ManagedBuffer<M>,
    pub decimals: u8,
    pub minter: ManagedBuffer<M>,
}

impl<M: ManagedTypeApi> AbiEncodeDecode<M> for DeployInterchainTokenPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        Self::raw_abi_encode(&[
            Token::Uint256(self.message_type),
            Token::Bytes32(self.token_id),
            Token::String(self.name),
            Token::String(self.symbol),
            Token::Uint8(self.decimals),
            Token::Bytes(self.minter),
        ])
    }

    fn abi_decode(payload: ManagedBuffer<M>) -> Self {
        let mut result = ArrayVec::<Token<M>, 9>::new();

        Self::raw_abi_decode(
            &[
                ParamType::Uint256,
                ParamType::Bytes32,
                ParamType::String,
                ParamType::String,
                ParamType::Uint8,
                ParamType::Bytes,
            ],
            &payload,
            &mut result,
            0,
        );

        let minter = result.pop().unwrap().into_managed_buffer();
        let decimals = result.pop().unwrap().into_u8();
        let symbol = result.pop().unwrap().into_managed_buffer();
        let name = result.pop().unwrap().into_managed_buffer();
        let token_id = result.pop().unwrap().into_managed_byte_array();
        let message_type = result.pop().unwrap().into_biguint();

        DeployInterchainTokenPayload {
            message_type,
            token_id,
            name,
            symbol,
            decimals,
            minter,
        }
    }
}

pub struct DeployTokenManagerPayload<M: ManagedTypeApi> {
    pub message_type: BigUint<M>,
    pub token_id: TokenId<M>,
    pub token_manager_type: TokenManagerType,
    pub params: ManagedBuffer<M>,
}

impl<M: ManagedTypeApi> AbiEncodeDecode<M> for DeployTokenManagerPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        Self::raw_abi_encode(&[
            Token::Uint256(self.message_type),
            Token::Bytes32(self.token_id),
            Token::Uint8(self.token_manager_type.into()),
            Token::Bytes(self.params),
        ])
    }

    fn abi_decode(payload: ManagedBuffer<M>) -> Self {
        let mut result = ArrayVec::<Token<M>, 4>::new();

        Self::raw_abi_decode(
            &[
                ParamType::Uint256,
                ParamType::Bytes32,
                ParamType::Uint8, // TODO: Change implementationType to Uint256?
                ParamType::Bytes,
            ],
            &payload,
            &mut result,
            0,
        );

        let params = result.pop().unwrap().into_managed_buffer();
        let token_manager_type = result.pop().unwrap().into_u8();
        let token_id = result.pop().unwrap().into_managed_byte_array();
        let message_type = result.pop().unwrap().into_biguint();

        DeployTokenManagerPayload {
            message_type,
            token_id,
            token_manager_type: TokenManagerType::from(token_manager_type),
            params,
        }
    }
}
