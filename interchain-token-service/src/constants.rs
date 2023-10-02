multiversx_sc::imports!();
multiversx_sc::derive_imports!();

pub const PREFIX_CUSTOM_TOKEN_ID: &[u8] = b"its-custom-token-id";
pub const PREFIX_STANDARDIZED_TOKEN_ID: &[u8] = b"its-standardized-token-id";
pub const PREFIX_STANDARDIZED_TOKEN_SALT : &[u8] = b"its-standardized-token-salt";

pub const SELECTOR_SEND_TOKEN: u32 = 1;
pub const SELECTOR_SEND_TOKEN_WITH_DATA: u32 = 2;
pub const SELECTOR_DEPLOY_TOKEN_MANAGER: u32 = 3;
pub const SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN: u32 = 4;

#[derive(TypeAbi, TopEncode, TopDecode, NestedEncode, Clone, Copy)]
pub enum TokenManagerType {
    LockUnlock,
    MintBurn,
}
