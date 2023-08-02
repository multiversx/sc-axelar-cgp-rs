multiversx_sc::imports!();
multiversx_sc::derive_imports!();

/// Will be used for generating keccak256 hash
pub const PREFIX_COMMAND_EXECUTED: &[u8; 16] = b"command-executed";
// pub const PREFIX_TOKEN_ADDRESS: &[u8; 13] = b"token-address"; // TODO: Should we add storage for 'token address' which on MultiversX it might be the ESDT identifier of the token?
pub const PREFIX_CONTRACT_CALL_APPROVED: &[u8; 22] = b"contract-call-approved";
pub const PREFIX_CONTRACT_CALL_APPROVED_WITH_MINT: &[u8; 32] = b"contract-call-approved-with-mint";

pub const SELECTOR_BURN_TOKEN: &[u8; 9] = b"burnToken";
pub const SELECTOR_DEPLOY_TOKEN: &[u8; 11] = b"deployToken";
pub const SELECTOR_MINT_TOKEN: &[u8; 9] = b"mintToken";
pub const SELECTOR_APPROVE_CONTRACT_CALL: &[u8; 19] = b"approveContractCall";
pub const SELECTOR_APPROVE_CONTRACT_CALL_WITH_MINT: &[u8; 27] = b"approveContractCallWithMint";
pub const SELECTOR_TRANSFER_OPERATORSHIP: &[u8; 20] = b"transferOperatorship";

pub const HOURS_6_TO_SECONDS: u64 = 21_600;

pub const AXELAR_GATEWAY: &[u8; 14] = b"axelar-gateway";

pub const ESDT_ISSUE_COST: u64 = 5000000000000000;

#[derive(TypeAbi, TopEncode, TopDecode, PartialEq, Debug)]
pub enum TokenType {
    InternalBurnable, // TODO: How can a token like this even be added to the contract and what does it mean?
    InternalBurnableFrom,
    External,
}

#[derive(TypeAbi, TopDecode, Debug)]
pub struct ExecuteData<M: ManagedTypeApi> {
    pub command_ids: ManagedVec<M, ManagedBuffer<M>>,
    pub commands: ManagedVec<M, ManagedBuffer<M>>,
    pub params: ManagedVec<M, ManagedBuffer<M>>,
}

#[derive(TypeAbi, TopDecode, Debug)]
pub struct DeployTokenParams<M: ManagedTypeApi> {
    pub name: ManagedBuffer<M>,
    pub symbol: ManagedBuffer<M>,
    pub decimals: u8,
    pub cap: BigUint<M>,
    pub token: Option<EgldOrEsdtTokenIdentifier<M>>,
    pub mint_limit: BigUint<M>,
}

#[derive(TypeAbi, TopDecode, Debug)]
pub struct MintTokenParams<M: ManagedTypeApi> {
    pub symbol: EgldOrEsdtTokenIdentifier<M>,
    pub account: ManagedAddress<M>,
    pub amount: BigUint<M>,
}

#[derive(TypeAbi, TopDecode, Debug)]
pub struct BurnTokenParams<M: ManagedTypeApi> {
    pub symbol: EgldOrEsdtTokenIdentifier<M>,
    pub salt: ManagedBuffer<M>, // TODO: What is this used for exactly?
}

#[derive(TypeAbi, TopDecode, Debug)]
pub struct ApproveContractCallParams<M: ManagedTypeApi> {
    pub source_chain: ManagedBuffer<M>,
    pub source_address: ManagedBuffer<M>,
    pub contract_address: ManagedAddress<M>,
    pub payload_hash: ManagedBuffer<M>,
    pub source_tx_hash: ManagedBuffer<M>,
    pub source_event_index: BigUint<M>,
}


#[derive(TypeAbi, TopDecode, Debug)]
pub struct ApproveContractCallWithMintParams<M: ManagedTypeApi> {
    pub source_chain: ManagedBuffer<M>,
    pub source_address: ManagedBuffer<M>,
    pub contract_address: ManagedAddress<M>,
    pub payload_hash: ManagedBuffer<M>,
    pub symbol: EgldOrEsdtTokenIdentifier<M>,
    pub amount: BigUint<M>,
    pub source_tx_hash: ManagedBuffer<M>,
    pub source_event_index: BigUint<M>,
}
