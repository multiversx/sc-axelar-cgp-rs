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
    ApproveOperatorProposal,
    CancelOperatorApproval,
}

#[derive(TypeAbi, TopDecode)]
pub struct DecodedCallData<M: ManagedTypeApi> {
    pub endpoint_name: ManagedBuffer<M>,
    pub arguments: ManagedVec<M, ManagedBuffer<M>>,
    pub min_gas_limit: u64,
}

#[derive(TypeAbi, TopDecode)]
pub struct ExecutePayload<M: ManagedTypeApi> {
    pub command: ServiceGovernanceCommand,
    pub target: ManagedAddress<M>,
    pub call_data: ManagedBuffer<M>,
    pub native_value: BigUint<M>,
    pub eta: u64,
}

#[derive(TypeAbi, TopDecode, TopEncode, NestedDecode, NestedEncode, Clone)]
pub struct EgldOrEsdtToken<M: ManagedTypeApi> {
    pub token_identifier: EgldOrEsdtTokenIdentifier<M>,
    pub token_nonce: u64,
}

const EXECUTE_PROPOSAL_CALLBACK_GAS: u64 = 10_000_000;
const EXECUTE_PROPOSAL_CALLBACK_GAS_PER_PAYMENT: u64 = 2_000_000;
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
        operator: ManagedAddress,
    ) {
        require!(
            !gateway.is_zero()
                && !governance_chain.is_empty()
                && !governance_address.is_empty()
                && !operator.is_zero(),
            "Invalid address"
        );

        self.gateway().set(gateway);
        self.minimum_time_lock_delay().set(minimum_time_delay);

        self.governance_chain().set(&governance_chain);
        self.governance_address().set(&governance_address);

        self.operator().set(operator);
    }

    #[upgrade]
    fn upgrade(&self) {}

    #[payable("*")]
    #[endpoint(executeProposal)]
    fn execute_proposal(
        &self,
        target: ManagedAddress,
        call_data: ManagedBuffer,
        native_value: BigUint,
    ) {
        let proposal_hash = self.get_proposal_hash(&target, &call_data, &native_value);

        require!(
            self.time_lock_proposals_submitted(&proposal_hash).get(),
            "Proposal is not submitted"
        );
        require!(
            self.time_lock_proposals_being_executed(&proposal_hash)
                .is_empty(),
            "Proposal is being executed"
        );

        let eta = self.time_lock_eta(&proposal_hash).get();

        require!(
            self.blockchain().get_block_timestamp() >= eta,
            "Time lock not ready"
        );

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

        let caller = self.blockchain().get_caller();

        let mut extra_gas_for_callback = EXECUTE_PROPOSAL_CALLBACK_GAS;

        let payments = self.call_value().any_payment();

        if let EgldOrMultiEsdtPaymentRefs::MultiEsdt(payments) = payments.as_refs() {
            // Reserve extra gas for callback to make sure we can send back the tokens instead of async call error
            let gas_for_payments =
                EXECUTE_PROPOSAL_CALLBACK_GAS_PER_PAYMENT * payments.len() as u64;

            extra_gas_for_callback += gas_for_payments;
        }

        let gas_left = self.blockchain().get_gas_left();

        require!(
            gas_left > extra_gas_for_callback + KEEP_EXTRA_GAS + decoded_call_data.min_gas_limit,
            "Insufficient gas for execution"
        );

        let gas_limit = gas_left - extra_gas_for_callback - KEEP_EXTRA_GAS;

        self.time_lock_proposals_being_executed(&proposal_hash)
            .set(true);

        self.send()
            .contract_call::<()>(target, decoded_call_data.endpoint_name)
            .with_egld_transfer(native_value)
            .with_raw_arguments(decoded_call_data.arguments.into())
            .with_gas_limit(gas_limit)
            .async_call_promise()
            .with_callback(self.callbacks().execute_proposal_callback(
                &proposal_hash,
                caller,
                payments,
            ))
            .with_extra_gas_for_callback(extra_gas_for_callback)
            .register_promise();
    }

    #[payable("*")]
    #[endpoint(executeOperatorProposal)]
    fn execute_operator_proposal(
        &self,
        target: ManagedAddress,
        call_data: ManagedBuffer,
        native_value: BigUint,
    ) {
        let operator = self.operator().get();

        require!(self.blockchain().get_caller() == operator, "Not authorized");

        let proposal_hash = self.get_proposal_hash(&target, &call_data, &native_value);

        require!(
            self.operator_proposals_submitted(&proposal_hash).get(),
            "Proposal is not submitted"
        );
        require!(
            self.operator_proposals_being_executed(&proposal_hash)
                .is_empty(),
            "Proposal is being executed"
        );
        require!(
            self.operator_approvals(&proposal_hash).get(),
            "Not approved"
        );

        self.operator_proposal_executed_event(
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

        let mut extra_gas_for_callback = EXECUTE_PROPOSAL_CALLBACK_GAS;

        let payments = self.call_value().any_payment();

        if let EgldOrMultiEsdtPaymentRefs::MultiEsdt(payments) = payments.as_refs() {
            // Reserve extra gas for callback to make sure we can send back the tokens instead of async call error
            let gas_for_payments =
                EXECUTE_PROPOSAL_CALLBACK_GAS_PER_PAYMENT * payments.len() as u64;

            extra_gas_for_callback += gas_for_payments;
        }

        let gas_left = self.blockchain().get_gas_left();

        require!(
            gas_left > extra_gas_for_callback + KEEP_EXTRA_GAS + decoded_call_data.min_gas_limit,
            "Insufficient gas for execution"
        );

        self.operator_proposals_being_executed(&proposal_hash)
            .set(true);

        let gas_limit = gas_left - extra_gas_for_callback - KEEP_EXTRA_GAS;

        self.send()
            .contract_call::<()>(target, decoded_call_data.endpoint_name)
            .with_egld_transfer(native_value)
            .with_raw_arguments(decoded_call_data.arguments.into())
            .with_gas_limit(gas_limit)
            .async_call_promise()
            .with_callback(self.callbacks().execute_operator_proposal_callback(
                &proposal_hash,
                operator,
                payments,
            ))
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

    #[endpoint(transferOperatorship)]
    fn transfer_operatorship(&self, new_operator: ManagedAddress) {
        let caller = self.blockchain().get_caller();

        require!(
            caller == self.operator().get() || caller == self.blockchain().get_sc_address(),
            "Not authorized"
        );

        require!(!new_operator.is_zero(), "Invalid operator address");

        self.operatorship_transferred_event(&self.operator().get(), &new_operator);

        self.operator().set(new_operator);
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

    #[endpoint(withdrawRefundToken)]
    fn withdraw_refund_token(&self, token: EgldOrEsdtToken<Self::Api>) {
        let caller = self.blockchain().get_caller();
        let value = self.refund_token(&caller, token.clone()).take();

        self.send()
            .direct_non_zero(&caller, &token.token_identifier, token.token_nonce, &value);
    }

    fn process_command(&self, execute_payload: ExecutePayload<Self::Api>) {
        let proposal_hash = self.get_proposal_hash(
            &execute_payload.target,
            &execute_payload.call_data,
            &execute_payload.native_value,
        );

        require!(!proposal_hash.is_empty(), "Invalid proposal hash");

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
                self.remove_proposal_time_lock(&proposal_hash);

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
            ServiceGovernanceCommand::ApproveOperatorProposal => {
                self.approve_operator_proposal(&proposal_hash);

                self.operator_approved_event(
                    &proposal_hash,
                    &execute_payload.target,
                    ProposalEventData {
                        call_data: &execute_payload.call_data,
                        value: &execute_payload.native_value,
                    },
                );
            }
            ServiceGovernanceCommand::CancelOperatorApproval => {
                self.remove_proposal_operator(&proposal_hash);

                self.operator_cancelled_event(
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
        require!(
            self.time_lock_proposals_submitted(hash).is_empty(),
            "Proposal was already submitted"
        );
        require!(
            self.time_lock_proposals_being_executed(hash).is_empty(),
            "Proposal is being executed"
        );

        let time_lock_eta_mapper = self.time_lock_eta(hash);

        let minimum_eta =
            self.blockchain().get_block_timestamp() + self.minimum_time_lock_delay().get();

        if eta < minimum_eta {
            eta = minimum_eta;
        }

        time_lock_eta_mapper.set(eta);
        self.time_lock_proposals_submitted(hash).set(true);

        eta
    }

    fn approve_operator_proposal(&self, hash: &ManagedByteArray<KECCAK256_RESULT_LEN>) {
        require!(
            self.operator_proposals_submitted(hash).is_empty(),
            "Proposal was already submitted"
        );
        require!(
            self.operator_proposals_being_executed(hash).is_empty(),
            "Proposal is being executed"
        );

        self.operator_approvals(hash).set(true);
        self.operator_proposals_submitted(hash).set(true);
    }

    fn remove_proposal_time_lock(&self, hash: &ManagedByteArray<KECCAK256_RESULT_LEN>) {
        self.time_lock_eta(hash).clear();
        self.time_lock_proposals_submitted(hash).clear();
    }

    fn remove_proposal_operator(&self, hash: &ManagedByteArray<KECCAK256_RESULT_LEN>) {
        self.operator_approvals(hash).clear();
        self.operator_proposals_submitted(hash).clear();
    }

    fn get_proposal_hash(
        &self,
        target: &ManagedAddress,
        call_data: &ManagedBuffer,
        native_value: &BigUint,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        target
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode target"));
        call_data
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode call data"));
        native_value
            .dep_encode(&mut encoded)
            .unwrap_or_else(|_| sc_panic!("Could not encode native value"));

        self.crypto().keccak256(encoded)
    }

    #[promises_callback]
    fn execute_proposal_callback(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        caller: ManagedAddress,
        payments: EgldOrMultiEsdtPayment<Self::Api>,
        #[call_result] call_result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        self.time_lock_proposals_being_executed(hash).clear();

        match call_result {
            ManagedAsyncCallResult::Ok(results) => {
                self.remove_proposal_time_lock(hash);

                self.execute_proposal_success_event(hash, results);
            }
            ManagedAsyncCallResult::Err(err) => {
                self.handle_callback_failure(caller, payments);

                self.execute_proposal_error_event(hash, err.err_code, err.err_msg);
            }
        }
    }

    #[promises_callback]
    fn execute_operator_proposal_callback(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        operator: ManagedAddress,
        payments: EgldOrMultiEsdtPayment<Self::Api>,
        #[call_result] call_result: ManagedAsyncCallResult<MultiValueEncoded<ManagedBuffer>>,
    ) {
        self.operator_proposals_being_executed(hash).clear();

        match call_result {
            ManagedAsyncCallResult::Ok(results) => {
                self.remove_proposal_operator(hash);

                self.operator_execute_proposal_success_event(hash, results);
            }
            ManagedAsyncCallResult::Err(err) => {
                self.handle_callback_failure(operator, payments);

                self.operator_execute_proposal_error_event(hash, err.err_code, err.err_msg);
            }
        }
    }

    fn handle_callback_failure(
        &self,
        caller: ManagedAddress,
        payments: EgldOrMultiEsdtPayment<Self::Api>,
    ) {
        match payments {
            EgldOrMultiEsdtPayment::Egld(egld_value) => {
                self.refund_token(
                    &caller,
                    EgldOrEsdtToken {
                        token_identifier: EgldOrEsdtTokenIdentifier::egld(),
                        token_nonce: 0,
                    },
                )
                .update(|old| *old += &egld_value);
            }
            EgldOrMultiEsdtPayment::MultiEsdt(esdts) => {
                for esdt in esdts.iter() {
                    self.refund_token(
                        &caller,
                        EgldOrEsdtToken {
                            token_identifier: EgldOrEsdtTokenIdentifier::esdt(
                                esdt.token_identifier,
                            ),
                            token_nonce: esdt.token_nonce,
                        },
                    )
                    .update(|old| *old += &esdt.amount);
                }
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

    #[view(isOperatorProposalApproved)]
    fn is_operator_proposal_approved(
        &self,
        target: ManagedAddress,
        call_data: ManagedBuffer,
        native_value: BigUint,
    ) -> bool {
        self.operator_approvals(&self.get_proposal_hash(&target, &call_data, &native_value))
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

    #[view(getOperator)]
    #[storage_mapper("operator")]
    fn operator(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(getTimeLockEta)]
    #[storage_mapper("time_lock_eta")]
    fn time_lock_eta(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<u64>;

    #[view(getOperatorApprovals)]
    #[storage_mapper("operator_approvals")]
    fn operator_approvals(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<bool>;

    #[view(getRefundToken)]
    #[storage_mapper("refund_token")]
    fn refund_token(
        &self,
        user: &ManagedAddress,
        token: EgldOrEsdtToken<Self::Api>,
    ) -> SingleValueMapper<BigUint>;

    #[view(getTimelockProposalsSubmitted)]
    #[storage_mapper("time_lock_proposals_submitted")]
    fn time_lock_proposals_submitted(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<bool>;

    #[view(getOperatorProposalsSubmitted)]
    #[storage_mapper("operator_proposals_submitted")]
    fn operator_proposals_submitted(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<bool>;

    #[view(getTimelockProposalsBeingExecuted)]
    #[storage_mapper("time_lock_proposals_being_executed")]
    fn time_lock_proposals_being_executed(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<bool>;

    #[view(getOperatorProposalsBeingExecuted)]
    #[storage_mapper("operator_proposals_being_executed")]
    fn operator_proposals_being_executed(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<bool>;

    #[proxy]
    fn gateway_proxy(&self, sc_address: ManagedAddress) -> gateway::Proxy<Self::Api>;
}
