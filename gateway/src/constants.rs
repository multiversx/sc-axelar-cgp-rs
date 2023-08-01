multiversx_sc::imports!();
multiversx_sc::derive_imports!();

/// Will be used for generating keccak256 hash
pub const PREFIX_COMMAND_EXECUTED: &[u8; 16] = b"command-executed";
pub const PREFIX_TOKEN_ADDRESS: &[u8; 13] = b"token-address";
pub const PREFIX_TOKEN_TYPE: &[u8; 10] = b"token-type";
pub const PREFIX_CONTRACT_CALL_APPROVED: &[u8; 22] = b"contract-call-approved";
pub const PREFIX_CONTRACT_CALL_APPROVED_WITH_MINT: &[u8; 32] = b"contract-call-approved-with-mint";

pub const SELECTOR_BURN_TOKEN: &[u8; 9] = b"burnToken";
pub const SELECTOR_DEPLOY_TOKEN: &[u8; 11] = b"deployToken";
pub const SELECTOR_MINT_TOKEN: &[u8; 9] = b"mintToken";
pub const SELECTOR_APPROVE_CONTRACT_CALL: &[u8; 19] = b"approveContractCall";
pub const SELECTOR_APPROVE_CONTRACT_CALL_WITH_MINT: &[u8; 27] = b"approveContractCallWithMint";
pub const SELECTOR_TRANSFER_OPERATORSHIP: &[u8; 20] = b"transferOperatorship";

#[derive(TypeAbi, TopEncode, TopDecode, Debug)]
pub enum TokenType {
    InternalBurnable,
    InternalBurnableFrom,
    External,
}

pub const HOURS_6_TO_SECONDS: u64 = 21_600;

pub const AXELAR_GATEWAY: &[u8; 14] = b"axelar-gateway";
