use multiversx_sc::api::KECCAK256_RESULT_LEN;
use multiversx_sc::codec::{NestedDecodeInput, TopDecodeInput};

multiversx_sc::imports!();
multiversx_sc::derive_imports!();

pub const PREFIX_INTERCHAIN_TOKEN_ID: &[u8] = b"its-interchain-token-id";

pub const MESSAGE_TYPE_INTERCHAIN_TRANSFER: u64 = 0;
pub const MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN: u64 = 1;
pub const MESSAGE_TYPE_SEND_TO_HUB: u64 = 3;
pub const MESSAGE_TYPE_RECEIVE_FROM_HUB: u64 = 4;
pub const MESSAGE_TYPE_LINK_TOKEN: u64 = 5;
pub const MESSAGE_TYPE_REGISTER_TOKEN_METADATA: u64 = 6;

/**
 * Chain name where ITS Hub exists. This is used for routing ITS calls via ITS hub.
 * This is set as a constant, since the ITS Hub will exist on Axelar.
 */
pub const ITS_HUB_CHAIN_NAME: &[u8] = b"axelar";

pub const EXECUTE_WITH_TOKEN_CALLBACK_GAS: u64 = 20_000_000; // This is overkill, but the callback should be prevented from failing at all costs
pub const KEEP_EXTRA_GAS: u64 = 15_000_000; // Extra gas to keep in contract before registering async promise. This needs to be a somewhat larger value

pub enum MetadataVersion {
    ContractCall,
}

impl From<u32> for MetadataVersion {
    fn from(value: u32) -> Self {
        match value {
            0 => MetadataVersion::ContractCall,
            _ => panic!("Unsupported metadata version"),
        }
    }
}

pub const LATEST_METADATA_VERSION: u32 = 0;

pub type Hash<M> = ManagedByteArray<M, KECCAK256_RESULT_LEN>;
pub type TokenId<M> = ManagedByteArray<M, KECCAK256_RESULT_LEN>;

pub const ESDT_EGLD_IDENTIFIER: &str = "EGLD-000000";

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

        Ok(Metadata { version, data })
    }
}

pub struct TransferAndGasTokens<M: ManagedTypeApi> {
    pub transfer_token: EgldOrEsdtTokenIdentifier<M>,
    pub transfer_amount: BigUint<M>,
    pub gas_amount: BigUint<M>,
}

pub trait ManagedBufferAscii<M: ManagedTypeApi> {
    fn ascii_to_u8(&self) -> u8;
}

impl<M: ManagedTypeApi> ManagedBufferAscii<M> for ManagedBuffer<M> {
    fn ascii_to_u8(&self) -> u8 {
        let mut result: u8 = 0;
        let mut byte_array = [0u8; 2];

        let _ = self.load_slice(0, &mut byte_array);
        for byte in byte_array {
            result *= 10;
            result += (byte as char).to_digit(16).unwrap() as u8;
        }

        result
    }
}

pub const PREFIX_CANONICAL_TOKEN_SALT: &[u8] = b"canonical-token-salt";
pub const PREFIX_INTERCHAIN_TOKEN_SALT: &[u8] = b"interchain-token-salt";
pub const PREFIX_DEPLOY_APPROVAL: &[u8] = b"deploy-approval";
pub const PREFIX_CUSTOM_TOKEN_SALT: &[u8] = b"custom-token-salt";

#[derive(TypeAbi, TopEncode, TopDecode, NestedEncode)]
pub struct DeployApproval<M: ManagedTypeApi> {
    pub minter: ManagedAddress<M>,
    pub token_id: TokenId<M>,
    pub destination_chain: ManagedBuffer<M>,
}

#[derive(TypeAbi, TopEncode, TopDecode, PartialEq)]
pub enum InterchainTokenStatus {
    None, // Needed because the first value from an enum is also encoded as an empty storage
    NoMint,
    NeedsMint,
    AlreadyMinted,
}

pub const EGLD_DECIMALS: u8 = 18;
