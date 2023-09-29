multiversx_sc::imports!();
multiversx_sc::derive_imports!();

pub const PREFIX_CUSTOM_TOKEN_ID: &[u8] = b"its-custom-token-id";
pub const PREFIX_STANDARDIZED_TOKEN_ID: &[u8] = b"its-standardized-token-id";
pub const PREFIX_STANDARDIZED_TOKEN_SALT : &[u8] = b"its-standardized-token-salt";

#[derive(TypeAbi, TopEncode, TopDecode, Clone, Copy)]
pub enum TokenManagerType {
    LockUnlock,
    MintBurn,
}
