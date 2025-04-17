multiversx_sc::imports!();

use crate::abi::{AbiEncodeDecode, ParamType, Token};
use crate::constants::TokenId;
use multiversx_sc::api::ManagedTypeApi;
use multiversx_sc::arrayvec::ArrayVec;
use multiversx_sc::imports::{BigUint, ManagedBuffer};
use token_manager::constants::TokenManagerType;

pub struct InterchainTransferPayload<M: ManagedTypeApi> {
    pub message_type: BigUint<M>,
    pub token_id: TokenId<M>,
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
        let mut result = ArrayVec::<Token<M>, 6>::new();

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

pub struct SendToHubPayload<M: ManagedTypeApi> {
    pub message_type: BigUint<M>,
    pub destination_chain: ManagedBuffer<M>,
    pub payload: ManagedBuffer<M>,
}

impl<M: ManagedTypeApi> AbiEncodeDecode<M> for SendToHubPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        Self::raw_abi_encode(&[
            Token::Uint256(self.message_type),
            Token::String(self.destination_chain),
            Token::Bytes(self.payload),
        ])
    }

    fn abi_decode(payload: ManagedBuffer<M>) -> Self {
        let mut result = ArrayVec::<Token<M>, 3>::new();

        Self::raw_abi_decode(
            &[ParamType::Uint256, ParamType::String, ParamType::Bytes],
            &payload,
            &mut result,
        );

        let payload = result.pop().unwrap().into_managed_buffer();
        let destination_chain = result.pop().unwrap().into_managed_buffer();
        let message_type = result.pop().unwrap().into_biguint();

        SendToHubPayload {
            message_type,
            destination_chain,
            payload,
        }
    }
}

pub struct ReceiveFromHubPayload<M: ManagedTypeApi> {
    pub message_type: BigUint<M>,
    pub original_source_chain: ManagedBuffer<M>,
    pub payload: ManagedBuffer<M>,
}

impl<M: ManagedTypeApi> AbiEncodeDecode<M> for ReceiveFromHubPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        Self::raw_abi_encode(&[
            Token::Uint256(self.message_type),
            Token::String(self.original_source_chain),
            Token::Bytes(self.payload),
        ])
    }

    fn abi_decode(payload: ManagedBuffer<M>) -> Self {
        let mut result = ArrayVec::<Token<M>, 3>::new();

        Self::raw_abi_decode(
            &[ParamType::Uint256, ParamType::String, ParamType::Bytes],
            &payload,
            &mut result,
        );

        let payload = result.pop().unwrap().into_managed_buffer();
        let original_source_chain = result.pop().unwrap().into_managed_buffer();
        let message_type = result.pop().unwrap().into_biguint();

        ReceiveFromHubPayload {
            message_type,
            original_source_chain,
            payload,
        }
    }
}

pub struct RegisterTokenMetadataPayload<M: ManagedTypeApi> {
    pub message_type: BigUint<M>,
    pub token_identifier: ManagedBuffer<M>,
    pub decimals: u8,
}

impl<M: ManagedTypeApi> AbiEncodeDecode<M> for RegisterTokenMetadataPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        Self::raw_abi_encode(&[
            Token::Uint256(self.message_type),
            Token::Bytes(self.token_identifier),
            Token::Uint8(self.decimals),
        ])
    }

    fn abi_decode(payload: ManagedBuffer<M>) -> Self {
        let mut result = ArrayVec::<Token<M>, 3>::new();

        Self::raw_abi_decode(
            &[ParamType::Uint256, ParamType::Bytes, ParamType::Uint8],
            &payload,
            &mut result,
        );

        let decimals = result.pop().unwrap().into_u8();
        let token_address = result.pop().unwrap().into_managed_buffer();
        let message_type = result.pop().unwrap().into_biguint();

        RegisterTokenMetadataPayload {
            message_type,
            token_identifier: token_address,
            decimals,
        }
    }
}

pub struct LinkTokenPayload<M: ManagedTypeApi> {
    pub message_type: BigUint<M>,
    pub token_id: TokenId<M>,
    pub token_manager_type: TokenManagerType,
    pub source_token_address: ManagedBuffer<M>,
    pub destination_token_address: ManagedBuffer<M>,
    pub link_params: ManagedBuffer<M>,
}

impl<M: ManagedTypeApi> AbiEncodeDecode<M> for LinkTokenPayload<M> {
    fn abi_encode(self) -> ManagedBuffer<M> {
        Self::raw_abi_encode(&[
            Token::Uint256(self.message_type),
            Token::Bytes32(self.token_id),
            Token::Uint8(self.token_manager_type.into()),
            Token::Bytes(self.source_token_address),
            Token::Bytes(self.destination_token_address),
            Token::Bytes(self.link_params),
        ])
    }

    fn abi_decode(payload: ManagedBuffer<M>) -> Self {
        let mut result = ArrayVec::<Token<M>, 6>::new();

        Self::raw_abi_decode(
            &[
                ParamType::Uint256,
                ParamType::Bytes32,
                ParamType::Uint8,
                ParamType::Bytes,
                ParamType::Bytes,
                ParamType::Bytes,
            ],
            &payload,
            &mut result,
        );

        let link_params = result.pop().unwrap().into_managed_buffer();
        let destination_token_address = result.pop().unwrap().into_managed_buffer();
        let source_token_address = result.pop().unwrap().into_managed_buffer();
        let token_manager_type = result.pop().unwrap().into_u8();
        let token_id = result.pop().unwrap().into_managed_byte_array();
        let message_type = result.pop().unwrap().into_biguint();

        LinkTokenPayload {
            message_type,
            token_id,
            token_manager_type: TokenManagerType::from(token_manager_type),
            source_token_address,
            destination_token_address,
            link_params,
        }
    }
}
