multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[multiversx_sc::module]
pub trait ExpressExecutorTracker {
    fn get_express_executor(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> ManagedAddress {
        let hash =
            self.express_execute_hash(command_id, source_chain, source_address, payload_hash);
        let express_execute_mapper = self.express_execute(&hash);

        if express_execute_mapper.is_empty() {
            return ManagedAddress::zero();
        }

        express_execute_mapper.get()
    }

    fn set_express_executor(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        express_executor: &ManagedAddress,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let hash =
            self.express_execute_hash(command_id, source_chain, source_address, payload_hash);

        let express_execute_mapper = self.express_execute(&hash);

        require!(
            express_execute_mapper.is_empty(),
            "Express executor already set"
        );

        express_execute_mapper.set(express_executor);

        hash
    }

    fn pop_express_executor(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> ManagedAddress {
        let hash =
            self.express_execute_hash(command_id, source_chain, source_address, payload_hash);

        let express_execute_mapper = self.express_execute(&hash);

        if express_execute_mapper.is_empty() {
            return ManagedAddress::zero();
        }

        express_execute_mapper.take()
    }

    fn express_execute_hash(
        &self,
        command_id: &ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        payload_hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut hash_data = ManagedBuffer::new();

        hash_data.append(command_id.as_managed_buffer());
        hash_data.append(source_chain);
        hash_data.append(source_address);
        hash_data.append(payload_hash.as_managed_buffer());

        self.crypto().keccak256(hash_data)
    }

    #[storage_mapper("express_execute")]
    fn express_execute(
        &self,
        hash: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> SingleValueMapper<ManagedAddress>;
}
