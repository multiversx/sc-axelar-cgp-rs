use multiversx_sc::api::KECCAK256_RESULT_LEN;

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

pub type Hash<M> = ManagedByteArray<M, KECCAK256_RESULT_LEN>;
pub type TokenId<M> = ManagedByteArray<M, KECCAK256_RESULT_LEN>;

pub const ESDT_EGLD_IDENTIFIER: &str = "EGLD-000000";

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
