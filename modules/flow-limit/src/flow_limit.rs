#![no_std]

multiversx_sc::imports!();

const EPOCH_TIME: u64 = 6 * 3600; // 6 hours;

#[multiversx_sc::module]
pub trait FlowLimit {
    fn set_flow_limit_raw(&self, flow_limit: BigUint) {
        self.flow_limit_set_event(&flow_limit);

        self.flow_limit().set(flow_limit);
    }

    #[view]
    fn get_flow_out_amount(&self) -> BigUint {
        let epoch = self.blockchain().get_block_timestamp() / EPOCH_TIME;

        self.flow_out_amount(epoch).get()
    }

    #[view]
    fn get_flow_in_amount(&self) -> BigUint {
        let epoch = self.blockchain().get_block_timestamp() / EPOCH_TIME;

        self.flow_in_amount(epoch).get()
    }

    fn add_flow(
        &self,
        flow_limit: BigUint,
        slot_to_add: SingleValueMapper<BigUint>,
        slot_to_compare: SingleValueMapper<BigUint>,
        flow_amount: &BigUint,
    ) {
        let flow_to_add = slot_to_add.get();
        let flow_to_compare = slot_to_compare.get();

        require!(
            &flow_to_add + flow_amount <= &flow_to_compare + &flow_limit
                && flow_amount <= &flow_limit,
            "Flow limit exceeded"
        );

        slot_to_add.set(&flow_to_add + flow_amount);
    }

    fn add_flow_out(&self, flow_out_amount: &BigUint) {
        let flow_limit = self.flow_limit().get();

        if flow_limit == 0 {
            return;
        }

        let epoch = self.blockchain().get_block_timestamp() / EPOCH_TIME;
        let slot_to_add = self.flow_out_amount(epoch);
        let slot_to_compare = self.flow_in_amount(epoch);

        self.add_flow(flow_limit, slot_to_add, slot_to_compare, flow_out_amount);
    }

    fn add_flow_in(&self, flow_in_amount: &BigUint) {
        let flow_limit = self.flow_limit().get();

        if flow_limit == 0 {
            return;
        }

        let epoch = self.blockchain().get_block_timestamp() / EPOCH_TIME;
        let slot_to_add = self.flow_in_amount(epoch);
        let slot_to_compare = self.flow_out_amount(epoch);

        self.add_flow(flow_limit, slot_to_add, slot_to_compare, flow_in_amount);
    }

    #[event("flow_limit_set_event")]
    fn flow_limit_set_event(&self, flow_limit: &BigUint);

    #[view(getFlowLimit)]
    #[storage_mapper("flow_limit")]
    fn flow_limit(&self) -> SingleValueMapper<BigUint>;

    #[storage_mapper("flow_out_amount")]
    fn flow_out_amount(&self, epoch: u64) -> SingleValueMapper<BigUint>;

    #[storage_mapper("flow_in_amount")]
    fn flow_in_amount(&self, epoch: u64) -> SingleValueMapper<BigUint>;
}
