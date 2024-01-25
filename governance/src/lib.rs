#![no_std]

pub mod events;

multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use crate::events::ProposalExecutedData;
use gateway::ProxyTrait as _;
use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopDecode, NestedDecode)]
enum GovernanceCommand {
    ScheduleTimeLockProposal,
    CancelTimeLockProposal,
}

#[derive(TypeAbi, TopDecode)]
pub struct CallData<M: ManagedTypeApi> {
    pub endpoint_name: ManagedBuffer<M>,
    pub arguments: ManagedVec<M, ManagedBuffer<M>>,
}

#[derive(TypeAbi, TopDecode)]
pub struct ExecutePayload<M: ManagedTypeApi> {
    pub command: GovernanceCommand,
    pub target: ManagedAddress<M>,
    pub call_data: ManagedBuffer<M>,
    pub native_value: BigUint<M>,
    pub eta: u64,
}

#[multiversx_sc::contract]
pub trait Governance: events::Events {
    #[init]
    fn init(
        &self,
        gateway: ManagedAddress,
        governance_chain: ManagedBuffer,
        governance_address: ManagedBuffer,
        minimum_time_delay: u64,
    ) {
        require!(
            !gateway.is_zero() && !governance_chain.is_empty() && !governance_address.is_empty(),
            "Invalid address"
        );

        self.gateway().set_if_empty(gateway);
        self.minimum_time_lock_delay()
            .set_if_empty(minimum_time_delay);

        self.governance_chain().set_if_empty(&governance_chain);
        self.governance_address().set_if_empty(&governance_address);
        self.governance_chain_hash()
            .set_if_empty(self.crypto().keccak256(&governance_chain));
        self.governance_address_hash()
            .set_if_empty(self.crypto().keccak256(&governance_address));
    }

    #[payable("EGLD")]
    #[endpoint(executeProposal)]
    fn execute_proposal(
        &self,
        target: ManagedAddress,
        call_data: ManagedBuffer,
        native_value: BigUint,
    ) {
        let proposal_hash = self.get_proposal_hash(&target, &call_data, &native_value);

        self.finalize_time_lock(&proposal_hash);

        self.proposal_executed_event(
            &proposal_hash,
            &target,
            ProposalExecutedData {
                call_data: &call_data,
                value: &native_value,
            },
        );

        let call_data: CallData<Self::Api> = CallData::<Self::Api>::top_decode(call_data)
            .unwrap_or_else(|_| sc_panic!("Could not decode call data"));

        self.send()
            .contract_call::<()>(target, call_data.endpoint_name)
            .with_egld_transfer(native_value)
            .with_raw_arguments(call_data.arguments.into())
            .execute_on_dest_context::<()>();
    }

    // Can only be called by self (through the execute_proposal endpoint)
    #[endpoint(withdraw)]
    fn withdraw(&self, recipient: ManagedAddress, amount: BigUint) {
        require!(
            self.blockchain().get_caller() == self.blockchain().get_sc_address(),
            "Not self"
        );

        self.send().direct_egld(&recipient, &amount);
    }

    #[endpoint]
    fn execute(
        &self,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        let payload_hash = self.crypto().keccak256(&payload);

        require!(
            self.gateway_proxy(self.gateway().get())
                .validate_contract_call(&command_id, &source_chain, &source_address, &payload_hash)
                .execute_on_dest_context::<bool>(),
            "Not approved by gateway"
        );

        self.only_governance(&source_chain, &source_address);

        let execute_payload: ExecutePayload<Self::Api> = ExecutePayload::<Self::Api>::top_decode(payload)
            .unwrap_or_else(|_| sc_panic!("Could not decode execute payload"));

        require!(!execute_payload.target.is_zero(), "Invalid target");

        self.process_command(execute_payload);
    }

    fn only_governance(&self, source_chain: &ManagedBuffer, source_address: &ManagedBuffer) {
        require!(
            self.crypto().keccak256(source_chain) == self.governance_chain_hash().get()
                && self.crypto().keccak256(source_address) == self.governance_address_hash().get(),
            "Not governance"
        );
    }

    fn get_proposal_hash(
        &self,
        target: &ManagedAddress,
        call_data: &ManagedBuffer,
        native_value: &BigUint,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        encoded.append(target.as_managed_buffer());
        encoded.append(call_data);
        encoded.append(&native_value.to_bytes_be_buffer());

        self.crypto().keccak256(encoded)
    }

    fn finalize_time_lock(&self, hash: &ManagedByteArray<KECCAK256_RESULT_LEN>) {
        let eta = self.time_lock_eta(hash).take();

        require!(!hash.is_empty() && eta != 0, "Invalid time lock hash");
        require!(
            self.blockchain().get_block_timestamp() < eta,
            "Time lock not ready"
        );
    }

    fn process_command(&self, execute_payload: ExecutePayload<Self::Api>) {
        let proposal_hash = self.get_proposal_hash(&execute_payload.target, &execute_payload.call_data, &execute_payload.native_value);
        
        match execute_payload.command {
            GovernanceCommand::ScheduleTimeLockProposal => {}
            GovernanceCommand::CancelTimeLockProposal => {}
        }
    }

    #[view(getProposalEta)]
    fn get_proposal_eta(
        &self,
        target: ManagedAddress,
        call_data: ManagedBuffer,
        native_value: BigUint,
    ) -> u64 {
        self.time_lock_eta(&self.get_proposal_hash(&target, &call_data, &native_value))
            .get()
    }

    #[view]
    #[storage_mapper("gateway")]
    fn gateway(&self) -> SingleValueMapper<ManagedAddress>;

    #[view]
    #[storage_mapper("minimum_time_lock_delay")]
    fn minimum_time_lock_delay(&self) -> SingleValueMapper<u64>;

    #[view]
    #[storage_mapper("governance_chain")]
    fn governance_chain(&self) -> SingleValueMapper<ManagedBuffer>;

    #[view]
    #[storage_mapper("governance_address")]
    fn governance_address(&self) -> SingleValueMapper<ManagedBuffer>;

    #[view]
    #[storage_mapper("governance_chain_hash")]
    fn governance_chain_hash(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[view]
    #[storage_mapper("governance_address_hash")]
    fn governance_address_hash(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[view]
    #[storage_mapper("time_lock_eta")]
    fn time_lock_eta(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<u64>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway::Proxy<Self::Api>;
}
