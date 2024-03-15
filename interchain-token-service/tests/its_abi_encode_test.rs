use multiversx_sc::hex_literal::hex;
use multiversx_sc::types::{BigUint, ManagedBuffer, ManagedByteArray};
use multiversx_sc_scenario::api::StaticApi;

use interchain_token_service::abi::AbiEncodeDecode;
use interchain_token_service::abi::Token;
use interchain_token_service::constants::{
    DeployInterchainTokenPayload, DeployTokenManagerPayload, InterchainTransferPayload,
};
use token_manager::constants::TokenManagerType;

#[test]
fn encode_uint256() {
    let tokens = Token::Uint256(BigUint::from(123456789000000000000000000000000000012u128));
    let encoded = InterchainTransferPayload::<StaticApi>::raw_abi_encode(&[tokens]);
    let expected = hex!(
        "
            000000000000000000000000000000005ce0e9a53831e3936420d9774000000c
		"
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_bytes32() {
    let tokens = Token::Bytes32(ManagedByteArray::from(&[
        0x12, 0x34, 0x56, 0x78, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x11, 0x22,
    ]));
    let encoded = InterchainTransferPayload::<StaticApi>::raw_abi_encode(&[tokens]);
    let expected = hex!(
        "
			1234567890000000000000000000000000000000000000000000000000001122
		"
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_bytes() {
    let tokens = Token::Bytes(ManagedBuffer::from(&[0x12, 0x34]));
    let encoded = InterchainTransferPayload::<StaticApi>::raw_abi_encode(&[tokens]);
    let expected = hex!(
        "
			0000000000000000000000000000000000000000000000000000000000000020
			0000000000000000000000000000000000000000000000000000000000000002
			1234000000000000000000000000000000000000000000000000000000000000
		"
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_string() {
    let tokens = Token::Bytes(ManagedBuffer::from("gavofyork"));
    let encoded = InterchainTransferPayload::<StaticApi>::raw_abi_encode(&[tokens]);
    let expected = hex!(
        "
			0000000000000000000000000000000000000000000000000000000000000020
			0000000000000000000000000000000000000000000000000000000000000009
			6761766f66796f726b0000000000000000000000000000000000000000000000
		"
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_uint8() {
    let tokens = Token::Uint8(255u8);
    let encoded = InterchainTransferPayload::<StaticApi>::raw_abi_encode(&[tokens]);
    let expected = hex!(
        "
            00000000000000000000000000000000000000000000000000000000000000ff
		"
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_bytes2() {
    let tokens = Token::Bytes(ManagedBuffer::from(&hex!(
        "10000000000000000000000000000000000000000000000000000000000002"
    )));
    let encoded = InterchainTransferPayload::<StaticApi>::raw_abi_encode(&[tokens]);
    let expected = hex!(
        "
			0000000000000000000000000000000000000000000000000000000000000020
			000000000000000000000000000000000000000000000000000000000000001f
			1000000000000000000000000000000000000000000000000000000000000200
		"
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_bytes3() {
    let tokens = Token::Bytes(ManagedBuffer::from(&hex!(
        "
            1000000000000000000000000000000000000000000000000000000000000000
            2000000000000000000000000000000000000000000000000000000000000000
        "
    )));
    let encoded = InterchainTransferPayload::<StaticApi>::raw_abi_encode(&[tokens]);
    let expected = hex!(
        "
			0000000000000000000000000000000000000000000000000000000000000020
			0000000000000000000000000000000000000000000000000000000000000040
			1000000000000000000000000000000000000000000000000000000000000000
            2000000000000000000000000000000000000000000000000000000000000000
		"
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_two_bytes() {
    let token1 = Token::Bytes(ManagedBuffer::from(&hex!(
        "10000000000000000000000000000000000000000000000000000000000002"
    )));
    let token2 = Token::Bytes(ManagedBuffer::from(&hex!(
        "0010000000000000000000000000000000000000000000000000000000000002"
    )));
    let encoded = InterchainTransferPayload::<StaticApi>::raw_abi_encode(&[token1, token2]);
    let expected = hex!(
        "
			0000000000000000000000000000000000000000000000000000000000000040
			0000000000000000000000000000000000000000000000000000000000000080
			000000000000000000000000000000000000000000000000000000000000001f
			1000000000000000000000000000000000000000000000000000000000000200
			0000000000000000000000000000000000000000000000000000000000000020
			0010000000000000000000000000000000000000000000000000000000000002
		"
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_interchain_transfer_payload_empty_data() {
    let data = InterchainTransferPayload::<StaticApi> {
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

    let encoded = data.abi_encode();

    let expected = hex!(
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
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_interchain_transfer_payload_with_data() {
    let data = InterchainTransferPayload::<StaticApi> {
        message_type: BigUint::from(22u64),
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

    let encoded = data.abi_encode();

    let expected = hex!(
        "
            0000000000000000000000000000000000000000000000000000000000000016
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
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_deploy_token_manager_payload() {
    let data = DeployTokenManagerPayload::<StaticApi> {
        message_type: BigUint::from(33u64),
        token_id: ManagedByteArray::from(&hex!(
            "131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b"
        )),
        token_manager_type: TokenManagerType::MintBurnFrom,
        params: ManagedBuffer::from(&hex!("f786e21509a9d50a9afd033b5940a2b7d872c208")),
    };

    let encoded = data.abi_encode();

    let expected = hex!(
        "
            0000000000000000000000000000000000000000000000000000000000000021
            131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b
            0000000000000000000000000000000000000000000000000000000000000001
            0000000000000000000000000000000000000000000000000000000000000080
            0000000000000000000000000000000000000000000000000000000000000014
            f786e21509a9d50a9afd033b5940a2b7d872c208000000000000000000000000
        "
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}

#[test]
fn encode_deploy_interchain_token_payload() {
    let data = DeployInterchainTokenPayload::<StaticApi> {
        message_type: BigUint::from(44u64),
        token_id: ManagedByteArray::from(&hex!(
            "131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b"
        )),
        name: ManagedBuffer::from("Name"),
        symbol: ManagedBuffer::from("Symbol"),
        decimals: 18,
        minter: ManagedBuffer::from(&hex!("f786e21509a9d50a9afd033b5940a2b7d872c208")),
    };

    let encoded = data.abi_encode();

    let expected = hex!(
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
    );
    assert_eq!(encoded, ManagedBuffer::from(&expected));
}
