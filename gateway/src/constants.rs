use core::convert::TryFrom;
use multiversx_sc::api::ED25519_KEY_BYTE_LEN;
use multiversx_sc::api::ED25519_SIGNATURE_BYTE_LEN;
use multiversx_sc::api::KECCAK256_RESULT_LEN;

multiversx_sc::imports!();
multiversx_sc::derive_imports!();

pub const MULTIVERSX_SIGNED_MESSAGE_PREFIX: &[u8; 28] = b"\x19MultiversX Signed Message:\n";

#[derive(TypeAbi, TopEncode, NestedEncode)]
pub enum CommandType {
    ApproveMessages,
    RotateSigners,
}

#[derive(TypeAbi, TopDecode, TopEncode, NestedEncode, NestedDecode, ManagedVecItem)]
pub struct Message<M: ManagedTypeApi> {
    pub source_chain: ManagedBuffer<M>,
    pub message_id: ManagedBuffer<M>,
    pub source_address: ManagedBuffer<M>,
    pub contract_address: ManagedAddress<M>,
    pub payload_hash: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
}

#[derive(TypeAbi, TopDecode, TopEncode, NestedEncode, NestedDecode, ManagedVecItem, PartialEq)]
pub struct WeightedSigner<M: ManagedTypeApi> {
    pub signer: ManagedByteArray<M, ED25519_KEY_BYTE_LEN>,
    pub weight: BigUint<M>,
}

#[derive(TypeAbi, TopDecode, TopEncode, NestedEncode, NestedDecode)]
pub struct WeightedSigners<M: ManagedTypeApi> {
    pub signers: ManagedVec<M, WeightedSigner<M>>,
    pub threshold: BigUint<M>,
    pub nonce: ManagedByteArray<M, KECCAK256_RESULT_LEN>,
}

#[derive(TypeAbi, TopDecode)]
pub struct Proof<M: ManagedTypeApi> {
    pub signers: WeightedSigners<M>,
    pub signatures: ManagedVec<M, Option<ManagedByteArray<M, ED25519_SIGNATURE_BYTE_LEN>>>,
}

#[derive(TypeAbi, TopDecode, TopEncode, NestedEncode)]
pub struct CrossChainId<M: ManagedTypeApi> {
    pub source_chain: ManagedBuffer<M>,
    pub message_id: ManagedBuffer<M>,
}

const MESSAGE_EXECUTED: &[u8; 1] = b"1";

#[derive(TypeAbi, PartialEq, Default)]
pub enum MessageState<M: ManagedTypeApi> {
    #[default]
    NonExistent,
    Approved(ManagedByteArray<M, KECCAK256_RESULT_LEN>),
    Executed,
}

impl<M: ManagedTypeApi> codec::TopEncode for MessageState<M> {
    fn top_encode_or_handle_err<O, H>(&self, output: O, h: H) -> Result<(), H::HandledErr>
    where
        O: codec::TopEncodeOutput,
        H: codec::EncodeErrorHandler,
    {
        match self {
            MessageState::NonExistent => codec::TopEncode::top_encode_or_handle_err(&"", output, h),
            MessageState::Approved(hash) => {
                codec::TopEncode::top_encode_or_handle_err(hash.as_managed_buffer(), output, h)
            }
            MessageState::Executed => {
                codec::TopEncode::top_encode_or_handle_err(MESSAGE_EXECUTED, output, h)
            }
        }
    }
}

impl<M: ManagedTypeApi> codec::TopDecode for MessageState<M> {
    fn top_decode_or_handle_err<I, H>(input: I, h: H) -> Result<Self, H::HandledErr>
    where
        I: codec::TopDecodeInput,
        H: codec::DecodeErrorHandler,
    {
        let decoded_input = ManagedBuffer::top_decode_or_handle_err(input, h)?;
        if decoded_input.is_empty() {
            Ok(MessageState::NonExistent)
        } else if decoded_input == MESSAGE_EXECUTED {
            Ok(MessageState::Executed)
        } else {
            let hash = ManagedByteArray::<M, KECCAK256_RESULT_LEN>::try_from(decoded_input);

            if hash.is_err() {
                return Err(h.handle_error(DecodeError::from("Invalid hash")));
            }

            Ok(MessageState::Approved(hash.unwrap()))
        }
    }
}
