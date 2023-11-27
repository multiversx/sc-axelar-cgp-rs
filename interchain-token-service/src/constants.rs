multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use crate::abi::{AbiEncodeDecode, ParamType, Token};
use multiversx_sc::api::KECCAK256_RESULT_LEN;
use token_manager::TokenManagerType;

pub const PREFIX_INTERCHAIN_TOKEN_ID: &[u8] = b"its-interchain-token-id";

pub const MESSAGE_TYPE_INTERCHAIN_TRANSFER: u64 = 0;
pub const MESSAGE_TYPE_INTERCHAIN_TRANSFER_WITH_DATA: u64 = 1;
pub const MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN: u64 = 2;
pub const MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER: u64 = 3;

pub const LATEST_METADATA_VERSION: u32 = 0;

pub type TokenId<M> = ManagedByteArray<M, KECCAK256_RESULT_LEN>;

pub struct InterchainTransferPayload<M: ManagedTypeApi> {
    pub message_type: BigUint<M>,
    pub token_id: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
    pub source_address: ManagedBuffer<M>,
    pub destination_address: ManagedBuffer<M>,
    pub amount: BigUint<M>,
    pub data: Option<ManagedBuffer<M>>,
}

impl<M: ManagedTypeApi> AbiEncodeDecode<M> for InterchainTransferPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        if self.data.is_none() {
            return Self::raw_abi_encode(&[
                Token::Uint256(self.message_type),
                Token::Bytes32(self.token_id),
                Token::Bytes(self.source_address),
                Token::Bytes(self.destination_address),
                Token::Uint256(self.amount),
            ]);
        }

        Self::raw_abi_encode(&[
            Token::Uint256(self.message_type),
            Token::Bytes32(self.token_id),
            Token::Bytes(self.source_address),
            Token::Bytes(self.destination_address),
            Token::Uint256(self.amount),
            Token::Bytes(self.data.unwrap()),
        ])
    }

    fn abi_decode(payload: ManagedBuffer<M>) -> Self {
        let mut result = ArrayVec::<Token<M>, 5>::new();
        Self::raw_abi_decode(
            &[
                ParamType::Uint256,
                ParamType::Bytes32,
                ParamType::Bytes,
                ParamType::Bytes,
                ParamType::Uint256,
            ],
            &payload,
            &mut result,
            0,
        );

        let amount = result.pop().unwrap().into_biguint();
        let destination_address = result.pop().unwrap().into_managed_buffer();
        let source_address = result.pop().unwrap().into_managed_buffer();
        let token_id = result.pop().unwrap().into_managed_byte_array();
        let message_type = result.pop().unwrap().into_biguint();

        let mut data = None;
        if message_type == MESSAGE_TYPE_INTERCHAIN_TRANSFER_WITH_DATA {
            let mut result = ArrayVec::<Token<M>, 1>::new();
            Self::raw_abi_decode(
                &[ParamType::Bytes],
                &payload,
                &mut result,
                5,
            );

            data = Some(result.pop().unwrap().into_managed_buffer());
        }

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

#[derive(TypeAbi, TopEncode, TopDecode)]
pub struct Metadata<M: ManagedTypeApi> {
    pub version: u32,
    pub metadata: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopDecode, TopEncode, NestedEncode)]
pub struct DeployTokenManagerParams<M: ManagedTypeApi> {
    pub operator: Option<ManagedAddress<M>>,
    pub token_identifier: Option<EgldOrEsdtTokenIdentifier<M>>,
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
            Token::Uint8(self.token_manager_type.to_u8()),
            Token::Bytes(self.params),
        ])
    }

    fn abi_decode(payload: ManagedBuffer<M>) -> Self {
        let mut result = ArrayVec::<Token<M>, 4>::new();

        Self::raw_abi_decode(
            &[
                ParamType::Uint256,
                ParamType::Bytes32,
                ParamType::Uint8,
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
            token_manager_type: TokenManagerType::from_u8(token_manager_type),
            params,
        }
    }
}

pub struct DeployInterchainTokenPayload<M: ManagedTypeApi> {
    pub message_type: BigUint<M>,
    pub token_id: TokenId<M>,
    pub name: ManagedBuffer<M>,
    pub symbol: ManagedBuffer<M>,
    pub decimals: u8,
    pub distributor: ManagedBuffer<M>,
}

impl<M: ManagedTypeApi> AbiEncodeDecode<M> for DeployInterchainTokenPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        Self::raw_abi_encode(&[
            Token::Uint256(self.message_type),
            Token::Bytes32(self.token_id),
            Token::String(self.name),
            Token::String(self.symbol),
            Token::Uint8(self.decimals),
            Token::Bytes(self.distributor),
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

        let distributor = result.pop().unwrap().into_managed_buffer();
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
            distributor,
        }
    }
}
