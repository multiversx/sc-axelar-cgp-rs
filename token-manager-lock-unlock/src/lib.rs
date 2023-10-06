#![no_std]

multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[multiversx_sc::contract]
pub trait TokenManagerLockUnlockContract:
    token_manager::TokenManager + token_manager::proxy::ProxyModule + flow_limit::FlowLimit
{
    #[init]
    fn init(
        &self,
        interchain_token_service: ManagedAddress,
        token_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        operator: ManagedAddress,
        token_address: Option<EgldOrEsdtTokenIdentifier>,
    ) {
        require!(token_address.is_some(), "Invalid token address");

        self.init_raw(interchain_token_service, token_id, operator, token_address);
    }

    #[payable("*")]
    #[endpoint(interchainTransfer)]
    fn interchain_transfer(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        metadata: ManagedBuffer,
    ) {
        let (sender, amount) = self.interchain_transfer_raw(destination_chain, destination_address, metadata);

        self.take_token_raw(&sender, &amount);
    }

    #[payable("*")]
    #[endpoint(callContractWithInterchainToken)]
    fn call_contract_with_interchain_token(
        &self,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        data: ManagedBuffer,
    ) {
        let (sender, amount) = self.call_contract_with_interchain_token_raw(destination_chain, destination_address, data);

        self.take_token_raw(&sender, &amount);
    }

    #[endpoint(giveToken)]
    fn give_token(&self, destination_address: &ManagedAddress, amount: BigUint) -> BigUint {
        self.give_token_endpoint(&amount);

        self.give_token_raw(destination_address, &amount)
    }

    #[payable("*")]
    #[endpoint(takeToken)]
    fn take_token(&self, source_address: &ManagedAddress) -> BigUint {
        let amount = self.take_token_endpoint();

        self.take_token_raw(source_address, &amount)
    }

    fn take_token_raw(&self, _sender: &ManagedAddress, amount: &BigUint) -> BigUint {
        // Nothing to do here, tokens remain in contract

        amount.clone()
    }

    fn give_token_raw(&self, destination_address: &ManagedAddress, amount: &BigUint) -> BigUint {
        self.send().direct(destination_address, &self.token_address().get(), 0, amount);

        amount.clone()
    }
}
