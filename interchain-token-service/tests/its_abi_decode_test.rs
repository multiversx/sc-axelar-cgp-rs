use multiversx_sc::arrayvec::ArrayVec;
use multiversx_sc::hex_literal::hex;
use multiversx_sc::types::{BigUint, ManagedBuffer, ManagedByteArray};
use multiversx_sc_scenario::api::StaticApi;

use interchain_token_service::abi::AbiEncodeDecode;
use interchain_token_service::abi::ParamType;
use interchain_token_service::abi::Token;
use interchain_token_service::constants::{
    DeployInterchainTokenPayload, DeployTokenManagerPayload, InterchainTransferPayload,
};
use token_manager::constants::TokenManagerType;

#[test]
#[should_panic]
fn decode_from_empty_bytes32() {
    let mut result = ArrayVec::<Token<StaticApi>, 0>::new();

    InterchainTransferPayload::<StaticApi>::raw_abi_decode(
        &[ParamType::Bytes32],
        &ManagedBuffer::new(),
        &mut result,
        0,
    );
}

#[test]
#[should_panic]
fn decode_from_empty_bytes() {
    let mut result = ArrayVec::<Token<StaticApi>, 0>::new();

    InterchainTransferPayload::<StaticApi>::raw_abi_decode(
        &[ParamType::Bytes],
        &ManagedBuffer::new(),
        &mut result,
        0,
    );
}

#[test]
#[should_panic]
fn decode_from_empty_string() {
    let mut result = ArrayVec::<Token<StaticApi>, 0>::new();

    InterchainTransferPayload::<StaticApi>::raw_abi_decode(
        &[ParamType::String],
        &ManagedBuffer::new(),
        &mut result,
        0,
    );
}

#[test]
fn decode_uint256() {
    let mut result = ArrayVec::<Token<StaticApi>, 1>::new();

    InterchainTransferPayload::<StaticApi>::raw_abi_decode(
        &[ParamType::Uint256],
        &ManagedBuffer::from(&hex!(
            "000000000000000000000000000000005ce0e9a53831e3936420d9774000000c"
        )),
        &mut result,
        0,
    );

    let expected = BigUint::from(123456789000000000000000000000000000012u128);

    assert_eq!(result.pop().unwrap().into_biguint(), expected);
}

#[test]
fn decode_bytes32() {
    let mut result = ArrayVec::<Token<StaticApi>, 1>::new();

    InterchainTransferPayload::<StaticApi>::raw_abi_decode(
        &[ParamType::Bytes32],
        &ManagedBuffer::from(&hex!(
            "1234567890000000000000000000000000000000000000000000000000001122"
        )),
        &mut result,
        0,
    );

    let expected = ManagedByteArray::from(&[
        0x12, 0x34, 0x56, 0x78, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x11, 0x22,
    ]);

    assert_eq!(result.pop().unwrap().into_managed_byte_array(), expected);
}

#[test]
fn decode_bytes() {
    let mut result = ArrayVec::<Token<StaticApi>, 1>::new();

    InterchainTransferPayload::<StaticApi>::raw_abi_decode(
        &[ParamType::Bytes],
        &ManagedBuffer::from(&hex!(
            "
			0000000000000000000000000000000000000000000000000000000000000020
			0000000000000000000000000000000000000000000000000000000000000002
			1234000000000000000000000000000000000000000000000000000000000000
		"
        )),
        &mut result,
        0,
    );

    let expected = ManagedBuffer::from(&[0x12, 0x34]);

    assert_eq!(result.pop().unwrap().into_managed_buffer(), expected);
}

#[test]
fn decode_string() {
    let mut result = ArrayVec::<Token<StaticApi>, 1>::new();

    InterchainTransferPayload::<StaticApi>::raw_abi_decode(
        &[ParamType::String],
        &ManagedBuffer::from(&hex!(
            "
			0000000000000000000000000000000000000000000000000000000000000020
			0000000000000000000000000000000000000000000000000000000000000009
			6761766f66796f726b0000000000000000000000000000000000000000000000
		"
        )),
        &mut result,
        0,
    );

    let expected = ManagedBuffer::from("gavofyork");

    assert_eq!(result.pop().unwrap().into_managed_buffer(), expected);
}

#[test]
fn decode_uint8() {
    let mut result = ArrayVec::<Token<StaticApi>, 1>::new();

    InterchainTransferPayload::<StaticApi>::raw_abi_decode(
        &[ParamType::Uint8],
        &ManagedBuffer::from(&hex!(
            "00000000000000000000000000000000000000000000000000000000000000ff"
        )),
        &mut result,
        0,
    );

    let expected = 255u8;

    assert_eq!(result.pop().unwrap().into_u8(), expected);
}

#[test]
#[should_panic]
fn decode_uint8_error() {
    let mut result = ArrayVec::<Token<StaticApi>, 1>::new();

    InterchainTransferPayload::<StaticApi>::raw_abi_decode(
        &[ParamType::Uint8],
        &ManagedBuffer::from(&hex!(
            "0000000000000000000000000000000000000000000000000000000000000fff"
        )),
        &mut result,
        0,
    );
}

#[test]
fn decode_two_bytes() {
    let mut result = ArrayVec::<Token<StaticApi>, 2>::new();

    InterchainTransferPayload::<StaticApi>::raw_abi_decode(
        &[ParamType::Bytes, ParamType::Bytes],
        &ManagedBuffer::from(&hex!(
            "
			0000000000000000000000000000000000000000000000000000000000000040
			0000000000000000000000000000000000000000000000000000000000000080
			000000000000000000000000000000000000000000000000000000000000001f
			1000000000000000000000000000000000000000000000000000000000000200
			0000000000000000000000000000000000000000000000000000000000000020
			0010000000000000000000000000000000000000000000000000000000000002
		"
        )),
        &mut result,
        0,
    );

    let token1 = ManagedBuffer::from(&hex!(
        "10000000000000000000000000000000000000000000000000000000000002"
    ));
    let token2 = ManagedBuffer::from(&hex!(
        "0010000000000000000000000000000000000000000000000000000000000002"
    ));

    assert_eq!(result.pop().unwrap().into_managed_buffer(), token2);
    assert_eq!(result.pop().unwrap().into_managed_buffer(), token1);
}

#[test]
fn decode_interchain_transfer_payload_empty_data() {
    let result = InterchainTransferPayload::<StaticApi>::abi_decode(ManagedBuffer::from(&hex!(
        "
			000000000000000000000000000000000000000000000000000000000000000b
            131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b
            00000000000000000000000000000000000000000000000000000000000000c0
            0000000000000000000000000000000000000000000000000000000000000100
            000000000000000000000000000000000000000000000000000000000165ec15
            0000000000000000000000000000000000000000000000000000000000000140
            0000000000000000000000000000000000000000000000000000000000000014
            f786e21509a9d50a9afd033b5940a2b7d872c208000000000000000000000000
            0000000000000000000000000000000000000000000000000000000000000020
            000000000000000005001019ba11c00268aae52e1dc6f89572828ae783ebb5bf
            0000000000000000000000000000000000000000000000000000000000000000
		"
    )));

    let expected = InterchainTransferPayload::<StaticApi> {
        message_type: BigUint::from(11u64),
        token_id: ManagedByteArray::from(&hex!(
            "131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b"
        )),
        source_address: ManagedBuffer::from(&hex!("f786e21509a9d50a9afd033b5940a2b7d872c208")),
        destination_address: ManagedBuffer::from(&hex!(
            "000000000000000005001019ba11c00268aae52e1dc6f89572828ae783ebb5bf"
        )),
        amount: BigUint::from(23456789u64),
        data: ManagedBuffer::new(),
    };

    assert_eq!(result.message_type, expected.message_type);
    assert_eq!(result.token_id, expected.token_id);
    assert_eq!(result.destination_address, expected.destination_address);
    assert_eq!(result.amount, expected.amount);
    assert_eq!(result.source_address, expected.source_address);
    assert_eq!(result.data, expected.data);
}

#[test]
fn decode_interchain_transfer_payload_with_data() {
    let result = InterchainTransferPayload::<StaticApi>::abi_decode(ManagedBuffer::from(&hex!(
        "
			0000000000000000000000000000000000000000000000000000000000000001
            131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b
            00000000000000000000000000000000000000000000000000000000000000c0
            0000000000000000000000000000000000000000000000000000000000000100
            000000000000000000000000000000000000000000000000000000000165ec15
            0000000000000000000000000000000000000000000000000000000000000140
            0000000000000000000000000000000000000000000000000000000000000020
            000000000000000005001019ba11c00268aae52e1dc6f89572828ae783ebb5bf
            0000000000000000000000000000000000000000000000000000000000000014
            f786e21509a9d50a9afd033b5940a2b7d872c208000000000000000000000000
            0000000000000000000000000000000000000000000000000000000000000008
            536f6d6544617461000000000000000000000000000000000000000000000000
		"
    )));

    let expected = InterchainTransferPayload::<StaticApi> {
        message_type: BigUint::from(1u64),
        token_id: ManagedByteArray::from(&hex!(
            "131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b"
        )),
        source_address: ManagedBuffer::from(&hex!(
            "000000000000000005001019ba11c00268aae52e1dc6f89572828ae783ebb5bf"
        )),
        destination_address: ManagedBuffer::from(&hex!("f786e21509a9d50a9afd033b5940a2b7d872c208")),
        amount: BigUint::from(23456789u64),
        data: ManagedBuffer::from(&hex!("536f6d6544617461")),
    };

    assert_eq!(result.message_type, expected.message_type);
    assert_eq!(result.token_id, expected.token_id);
    assert_eq!(result.destination_address, expected.destination_address);
    assert_eq!(result.amount, expected.amount);
    assert_eq!(result.source_address, expected.source_address);
    assert_eq!(result.data, expected.data);
}

#[test]
fn decode_deploy_token_manager_payload() {
    let result = DeployTokenManagerPayload::<StaticApi>::abi_decode(ManagedBuffer::from(&hex!(
        "
			0000000000000000000000000000000000000000000000000000000000000021
            131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b
            0000000000000000000000000000000000000000000000000000000000000001
            0000000000000000000000000000000000000000000000000000000000000080
            0000000000000000000000000000000000000000000000000000000000000014
            f786e21509a9d50a9afd033b5940a2b7d872c208000000000000000000000000
		"
    )));

    let expected = DeployTokenManagerPayload::<StaticApi> {
        message_type: BigUint::from(33u64),
        token_id: ManagedByteArray::from(&hex!(
            "131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b"
        )),
        token_manager_type: TokenManagerType::MintBurnFrom,
        params: ManagedBuffer::from(&hex!("f786e21509a9d50a9afd033b5940a2b7d872c208")),
    };

    assert_eq!(result.message_type, expected.message_type);
    assert_eq!(result.token_id, expected.token_id);
    assert_eq!(result.token_manager_type, expected.token_manager_type);
    assert_eq!(result.params, expected.params);
}

#[test]
fn decode_deploy_interchain_token_payload() {
    let result = DeployInterchainTokenPayload::<StaticApi>::abi_decode(ManagedBuffer::from(&hex!(
        "
			000000000000000000000000000000000000000000000000000000000000002c
            131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b
            00000000000000000000000000000000000000000000000000000000000000c0
            0000000000000000000000000000000000000000000000000000000000000100
            0000000000000000000000000000000000000000000000000000000000000012
            0000000000000000000000000000000000000000000000000000000000000140
            0000000000000000000000000000000000000000000000000000000000000004
            4e616d6500000000000000000000000000000000000000000000000000000000
            0000000000000000000000000000000000000000000000000000000000000006
            53796d626f6c0000000000000000000000000000000000000000000000000000
            0000000000000000000000000000000000000000000000000000000000000014
            f786e21509a9d50a9afd033b5940a2b7d872c208000000000000000000000000
		"
    )));

    let expected = DeployInterchainTokenPayload::<StaticApi> {
        message_type: BigUint::from(44u64),
        token_id: ManagedByteArray::from(&hex!(
            "131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b"
        )),
        name: ManagedBuffer::from("Name"),
        symbol: ManagedBuffer::from("Symbol"),
        decimals: 18,
        minter: ManagedBuffer::from(&hex!("f786e21509a9d50a9afd033b5940a2b7d872c208")),
    };

    assert_eq!(result.message_type, expected.message_type);
    assert_eq!(result.token_id, expected.token_id);
    assert_eq!(result.name, expected.name);
    assert_eq!(result.symbol, expected.symbol);
    assert_eq!(result.decimals, expected.decimals);
    assert_eq!(result.minter, expected.minter);
}
