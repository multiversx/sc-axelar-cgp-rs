#![no_std]

pub mod events;

multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use crate::events::ProposalEventData;
use gateway::ProxyTrait as _;
use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[derive(TypeAbi, TopDecode, NestedDecode)]
pub enum ServiceGovernanceCommand {
    ScheduleTimeLockProposal,
    CancelTimeLockProposal,
    ApproveMultisigProposal,
    CancelMultisigApproval,
}

#[derive(TypeAbi, TopDecode)]
pub struct DecodedCallData<M: ManagedTypeApi> {
    pub endpoint_name: ManagedBuffer<M>,
    pub arguments: ManagedVec<M, ManagedBuffer<M>>,
}

#[derive(TypeAbi, TopDecode)]
pub struct ExecutePayload<M: ManagedTypeApi> {
    pub command: ServiceGovernanceCommand,
    pub target: ManagedAddress<M>,
    pub call_data: ManagedBuffer<M>,
    pub native_value: BigUint<M>,
    pub eta: u64,
}

const EXECUTE_PROPOSAL_CALLBACK_GAS: u64 = 5_000_000;
// This is overkill, but the callback should be prevented from failing at all costs
const KEEP_EXTRA_GAS: u64 = 15_000_000; // Extra gas to keep in contract before registering async promise. This needs to be a somewhat larger value

#[multiversx_sc::contract]
pub trait Governance: events::Events {
    #[init]
    fn init(
        &self,
        gateway: ManagedAddress,
        governance_chain: ManagedBuffer,
        governance_address: ManagedBuffer,
        minimum_time_delay: u64,
        multisig: ManagedAddress,
    ) {
        require!(
            !gateway.is_zero()
                && !governance_chain.is_empty()
                && !governance_address.is_empty()
                && !multisig.is_zero(),
            "Invalid address"
        );

        self.gateway().set(gateway);
        self.minimum_time_lock_delay().set(minimum_time_delay);

        self.governance_chain().set(&governance_chain);
        self.governance_address().set(&governance_address);

        self.multisig().set(multisig);
    }

    #[upgrade]
    fn upgrade(&self) {}

    #[payable("EGLD")]
    #[endpoint(executeProposal)]
    fn execute_proposal(
        &self,
        target: ManagedAddress,
        call_data: ManagedBuffer,
        native_value: BigUint,
    ) {
        let proposal_hash = self.get_proposal_hash(&target, &call_data, &native_value);

        let eta = self.finalize_time_lock(&proposal_hash);

        self.proposal_executed_event(
            &proposal_hash,
            &target,
            ProposalEventData {
                call_data: &call_data,
                value: &native_value,
            },
        );

        let decoded_call_data: DecodedCallData<Self::Api> =
            DecodedCallData::<Self::Api>::top_decode(call_data)
                .unwrap_or_else(|_| sc_panic!("Could not decode call data"));

        let gas_left = self.blockchain().get_gas_left();

        require!(
            gas_left > EXECUTE_PROPOSAL_CALLBACK_GAS + KEEP_EXTRA_GAS,
            "Not enough gas left for async call"
        );

        let gas_limit = gas_left - EXECUTE_PROPOSAL_CALLBACK_GAS - KEEP_EXTRA_GAS;

        self.send()
            .contract_call::<()>(target, decoded_call_data.endpoint_name)
            .with_egld_transfer(native_value)
            .with_raw_arguments(decoded_call_data.arguments.into())
            .with_gas_limit(gas_limit)
            .async_call_promise()
            .with_callback(
                self.callbacks()
                    .execute_proposal_callback(&proposal_hash, eta),
            )
            .with_extra_gas_for_callback(EXECUTE_PROPOSAL_CALLBACK_GAS)
            .register_promise();
    }

    #[payable("EGLD")]
    #[endpoint(executeMultisigProposal)]
    fn execute_multisig_proposal(
        &self,
        target: ManagedAddress,
        call_data: ManagedBuffer,
        native_value: BigUint,
    ) {
        require!(
            self.blockchain().get_caller() == self.multisig().get(),
            "Not authorized"
        );

        let proposal_hash = self.get_proposal_hash(&target, &call_data, &native_value);

        require!(
            self.multisig_approvals(&proposal_hash).take(),
            "Not approved"
        );

        self.multisig_proposal_executed_event(
            &proposal_hash,
            &target,
            ProposalEventData {
                call_data: &call_data,
                value: &native_value,
            },
        );

        let decoded_call_data: DecodedCallData<Self::Api> =
            DecodedCallData::<Self::Api>::top_decode(call_data)
                .unwrap_or_else(|_| sc_panic!("Could not decode call data"));

        let gas_left = self.blockchain().get_gas_left();

        require!(
            gas_left > EXECUTE_PROPOSAL_CALLBACK_GAS + KEEP_EXTRA_GAS,
            "Not enough gas left for async call"
        );

        let gas_limit = gas_left - EXECUTE_PROPOSAL_CALLBACK_GAS - KEEP_EXTRA_GAS;

        self.send()
            .contract_call::<()>(target, decoded_call_data.endpoint_name)
            .with_egld_transfer(native_value)
            .with_raw_arguments(decoded_call_data.arguments.into())
            .with_gas_limit(gas_limit)
            .async_call_promise()
            .with_callback(
                self.callbacks()
                    .execute_multisig_proposal_callback(&proposal_hash),
            )
            .with_extra_gas_for_callback(EXECUTE_PROPOSAL_CALLBACK_GAS)
            .register_promise();
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

    #[endpoint(transferMultisig)]
    fn transfer_multisig(&self, new_multisig: ManagedAddress) {
        let caller = self.blockchain().get_caller();

        require!(
            caller == self.multisig().get() || caller == self.blockchain().get_sc_address(),
            "Not authorized"
        );

        require!(!new_multisig.is_zero(), "Invalid multisig address");

        self.multisig_transferred_event(&self.multisig().get(), &new_multisig);

        self.multisig().set(new_multisig);
    }

    #[endpoint]
    fn execute(
        &self,
        source_chain: ManagedBuffer,
        message_id: ManagedBuffer,
        source_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        require!(
            source_chain == self.governance_chain().get()
                && source_address == self.governance_address().get(),
            "Not governance"
        );

        let payload_hash = self.crypto().keccak256(&payload);

        require!(
            self.gateway_proxy(self.gateway().get())
                .validate_message(&source_chain, &message_id, &source_address, &payload_hash)
                .execute_on_dest_context::<bool>(),
            "Not approved by gateway"
        );

        let execute_payload: ExecutePayload<Self::Api> =
            ExecutePayload::<Self::Api>::top_decode(payload)
                .unwrap_or_else(|_| sc_panic!("Could not decode execute payload"));

        require!(!execute_payload.target.is_zero(), "Invalid target");

        self.process_command(execute_payload);
    }

    fn process_command(&self, execute_payload: ExecutePayload<Self::Api>) {
        let proposal_hash = self.get_proposal_hash(
            &execute_payload.target,
            &execute_payload.call_data,
            &execute_payload.native_value,
        );

        match execute_payload.command {
            ServiceGovernanceCommand::ScheduleTimeLockProposal => {
                let eta = self.schedule_time_lock(&proposal_hash, execute_payload.eta);

                self.proposal_scheduled_event(
                    &proposal_hash,
                    &execute_payload.target,
                    eta,
                    ProposalEventData {
                        call_data: &execute_payload.call_data,
                        value: &execute_payload.native_value,
                    },
                );
            }
            ServiceGovernanceCommand::CancelTimeLockProposal => {
                self.cancel_time_lock(&proposal_hash);

                self.proposal_cancelled_event(
                    &proposal_hash,
                    &execute_payload.target,
                    execute_payload.eta,
                    ProposalEventData {
                        call_data: &execute_payload.call_data,
                        value: &execute_payload.native_value,
                    },
                );
            }
            ServiceGovernanceCommand::ApproveMultisigProposal => {
                self.multisig_approvals(&proposal_hash).set(true);

                self.multisig_approved_event(
                    &proposal_hash,
                    &execute_payload.target,
                    ProposalEventData {
                        call_data: &execute_payload.call_data,
                        value: &execute_payload.native_value,
                    },
                );
            }
            ServiceGovernanceCommand::CancelMultisigApproval => {
                self.multisig_approvals(&proposal_hash).clear();

                self.multisig_cancelled_event(
                    &proposal_hash,
                    &execute_payload.target,
                    ProposalEventData {
                        call_data: &execute_payload.call_data,
                        value: &execute_payload.native_value,
                    },
                );
            }
        }
    }

    fn schedule_time_lock(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        mut eta: u64,
    ) -> u64 {
        require!(!hash.is_empty(), "Invalid time lock hash");

        let time_lock_eta_mapper = self.time_lock_eta(hash);

        require!(
            time_lock_eta_mapper.is_empty(),
            "Time lock already scheduled"
        );

        let minimum_eta =
            self.blockchain().get_block_timestamp() + self.minimum_time_lock_delay().get();

        if eta < minimum_eta {
            eta = minimum_eta;
        }

        time_lock_eta_mapper.set(eta);

        eta
    }

    fn cancel_time_lock(&self, hash: &ManagedByteArray<KECCAK256_RESULT_LEN>) {
        require!(!hash.is_empty(), "Invalid time lock hash");

        self.time_lock_eta(hash).clear();
    }

    fn finalize_time_lock(&self, hash: &ManagedByteArray<KECCAK256_RESULT_LEN>) -> u64 {
        let eta = self.time_lock_eta(hash).take();

        require!(!hash.is_empty() && eta != 0, "Invalid time lock hash");
        require!(
            self.blockchain().get_block_timestamp() >= eta,
            "Time lock not ready"
        );

        eta
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

    #[promises_callback]
    fn execute_proposal_callback(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        eta: u64,
        #[call_result] call_result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match call_result {
            ManagedAsyncCallResult::Ok(results) => {
                self.execute_proposal_success_event(hash, results);
            }
            ManagedAsyncCallResult::Err(err) => {
                // Let call be retried in case of failure, mostly because async call
                // can fail with out of gas since it can be triggered by anyone
                self.time_lock_eta(hash).set(eta);

                self.execute_proposal_error_event(hash, err.err_code, err.err_msg);
            }
        }
    }

    #[promises_callback]
    fn execute_multisig_proposal_callback(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        #[call_result] call_result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        match call_result {
            ManagedAsyncCallResult::Ok(results) => {
                self.multisig_execute_proposal_success_event(hash, results);
            }
            ManagedAsyncCallResult::Err(err) => {
                // Let call be retried in case of failure, mostly because async call
                // can fail with out of gas
                self.multisig_approvals(hash).set(true);

                self.multisig_execute_proposal_error_event(hash, err.err_code, err.err_msg);
            }
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

    #[view(isMultisigProposalApproved)]
    fn is_multisig_proposal_approved(
        &self,
        target: ManagedAddress,
        call_data: ManagedBuffer,
        native_value: BigUint,
    ) -> bool {
        self.multisig_approvals(&self.get_proposal_hash(&target, &call_data, &native_value))
            .get()
    }

    #[view]
    #[storage_mapper("gateway")]
    fn gateway(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(getMinimumTimeLockDelay)]
    #[storage_mapper("minimum_time_lock_delay")]
    fn minimum_time_lock_delay(&self) -> SingleValueMapper<u64>;

    #[view(getGovernanceChain)]
    #[storage_mapper("governance_chain")]
    fn governance_chain(&self) -> SingleValueMapper<ManagedBuffer>;

    #[view(getGovernanceAddress)]
    #[storage_mapper("governance_address")]
    fn governance_address(&self) -> SingleValueMapper<ManagedBuffer>;

    #[view(getMultisig)]
    #[storage_mapper("multisig")]
    fn multisig(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(getTimeLockEta)]
    #[storage_mapper("time_lock_eta")]
    fn time_lock_eta(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<u64>;

    #[view(getMultisigApprovals)]
    #[storage_mapper("multisig_approvals")]
    fn multisig_approvals(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<bool>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway::Proxy<Self::Api>;
}
