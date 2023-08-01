multiversx_sc::imports!();
multiversx_sc::derive_imports!();

/// @dev Storage slot with the address of the current implementation. `keccak256('eip1967.proxy.implementation') - 1`.
pub const KEY_IMPLEMENTATION: &[u8; 66] =
    b"0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/// @dev Storage slot with the address of the current governance. `keccak256('governance') - 1`.
pub const KEY_GOVERNANCE: &[u8; 66] =
    b"0xabea6fd3db56a6e6d0242111b43ebb13d1c42709651c032c7894962023a1f909";

/// @dev Storage slot with the address of the current governance. `keccak256('mint-limiter') - 1`.
pub const KEY_MINT_LIMITER: &[u8; 66] =
    b"0x627f0c11732837b3240a2de89c0b6343512886dd50978b99c76a68c6416a4d92";

/// Will be used for generating keccak256 hash
pub const PREFIX_COMMAND_EXECUTED: &[u8; 16] = b"command-executed";
pub const PREFIX_TOKEN_ADDRESS: &[u8; 13] = b"token-address";
pub const PREFIX_TOKEN_TYPE: &[u8; 10] = b"token-type";
pub const PREFIX_CONTRACT_CALL_APPROVED: &[u8; 22] = b"contract-call-approved";
pub const PREFIX_CONTRACT_CALL_APPROVED_WITH_MINT: &[u8; 32] = b"contract-call-approved-with-mint";
pub const PREFIX_TOKEN_MINT_LIMIT: &[u8; 16] = b"token-mint-limit";
pub const PREFIX_TOKEN_MINT_AMOUNT: &[u8; 17] = b"token-mint-amount";

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

pub const HOURS_TO_SECONDS_6: u64 = 21_600;
