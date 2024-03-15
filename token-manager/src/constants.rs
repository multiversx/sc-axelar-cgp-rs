multiversx_sc::imports!();
multiversx_sc::derive_imports!();

// Enum has same types as on EVM for compatibility
#[derive(
    TypeAbi, Debug, PartialEq, TopEncode, TopDecode, NestedEncode, NestedDecode, Clone, Copy,
)]
pub enum TokenManagerType {
    MintBurn,
    MintBurnFrom,
    LockUnlock,
    LockUnlockFee,
}

impl From<u8> for TokenManagerType {
    fn from(value: u8) -> Self {
        match value {
            0 => TokenManagerType::MintBurn,
            1 => TokenManagerType::MintBurnFrom,
            2 => TokenManagerType::LockUnlock,
            3 => TokenManagerType::LockUnlockFee,
            _ => panic!("Unsupported type"),
        }
    }
}

impl From<TokenManagerType> for u8 {
    fn from(value: TokenManagerType) -> Self {
        match value {
            TokenManagerType::MintBurn => 0,
            TokenManagerType::MintBurnFrom => 1,
            TokenManagerType::LockUnlock => 2,
            TokenManagerType::LockUnlockFee => 3,
        }
    }
}

#[derive(TypeAbi, TopEncode, TopDecode)]
pub struct DeployTokenManagerParams<M: ManagedTypeApi> {
    pub operator: Option<ManagedAddress<M>>,
    pub token_identifier: Option<EgldOrEsdtTokenIdentifier<M>>,
}

// If this needs updating, the TokenManagerMintBurn contract from which deployments are made can be upgraded
pub const DEFAULT_ESDT_ISSUE_COST: u64 = 50000000000000000; // 0.05 EGLD
