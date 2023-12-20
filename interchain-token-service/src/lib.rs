#![no_std]

use core::convert::TryFrom;
use core::ops::Deref;

use multiversx_sc::api::KECCAK256_RESULT_LEN;

use token_manager::constants::{DeployTokenManagerParams, TokenManagerType};

use crate::abi::{AbiEncodeDecode, ParamType};
use crate::constants::{
    InterchainTransferPayload, MetadataVersion, TokenId, MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
    MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER, MESSAGE_TYPE_INTERCHAIN_TRANSFER,
    PREFIX_INTERCHAIN_TOKEN_ID,
};

multiversx_sc::imports!();

pub mod abi;
pub mod address_tracker;
pub mod constants;
pub mod events;
pub mod executable;
pub mod express_executor_tracker;
pub mod proxy;
pub mod remote;

#[multiversx_sc::contract]
pub trait InterchainTokenServiceContract:
    operatable::Operatable
    + operatable::roles::AccountRoles
    + express_executor_tracker::ExpressExecutorTracker
    + address_tracker::AddressTracker
    + proxy::ProxyModule
    + executable::ExecutableModule
    + events::EventsModule
    + remote::RemoteModule
    + multiversx_sc_modules::pause::PauseModule
{
    #[init]
    fn init(
        &self,
        gateway: ManagedAddress,
        gas_service: ManagedAddress,
        token_manager_implementation: ManagedAddress,
        // from _setup function below
        operator: ManagedAddress,
        chain_name: ManagedBuffer,
        trusted_chain_names: MultiValueManagedVecCounted<ManagedBuffer>,
        trusted_addresses: MultiValueManagedVecCounted<ManagedBuffer>,
    ) {
        require!(
            !gateway.is_zero()
                && !gas_service.is_zero()
                && !token_manager_implementation.is_zero(),
            "Zero address"
        );

        self.gateway().set_if_empty(gateway);
        self.gas_service().set_if_empty(gas_service);
        self.token_manager()
            .set_if_empty(token_manager_implementation);

        // from _setup function below
        require!(!operator.is_zero(), "Zero address");
        require!(!chain_name.is_empty(), "Invalid chain name");
        require!(
            trusted_chain_names.len() == trusted_addresses.len(),
            "Length mismatch"
        );

        self.add_operator(operator);
        self.set_chain_name(chain_name.clone());
        self.chain_name_hash()
            .set_if_empty(self.crypto().keccak256(chain_name));

        for (name, address) in trusted_chain_names
            .into_vec()
            .iter()
            .zip(trusted_addresses.into_vec().iter())
        {
            self.set_trusted_address(name.deref(), address.deref());
        }
    }

    #[only_owner]
    #[endpoint(setInterchainTokenFactory)]
    fn set_interchain_token_factory(&self, interchain_token_factory: ManagedAddress) {
        self.interchain_token_factory()
            .set_if_empty(interchain_token_factory)
    }

    /// User Functions

    // Payable with EGLD for cross chain calls gas
    #[payable("EGLD")]
    #[endpoint(deployTokenManager)]
    fn deploy_token_manager(
        &self,
        salt: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        token_manager_type: TokenManagerType,
        params: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();

        let mut deployer = self.blockchain().get_caller();

        if deployer == self.interchain_token_factory().get() {
            deployer = ManagedAddress::zero();
        }

        let token_id = self.interchain_token_id(&deployer, &salt);

        self.interchain_token_id_claimed_event(&token_id, &deployer, &salt);

        let gas_value = self.call_value().egld_value();
        let gas_value = gas_value.deref();

        if destination_chain.is_empty() {
            require!(
                gas_value == &BigUint::zero(),
                "Can not accept EGLD if not cross chain call"
            );

            self.deploy_token_manager_raw(&token_id, token_manager_type, params);
        } else {
            self.deploy_remote_token_manager(
                &token_id,
                destination_chain,
                gas_value,
                token_manager_type,
                params,
            );
        }

        token_id
    }

    // Payable with EGLD for:
    // - ESDT token deploy (2nd transaction)
    // - cross chain calls gas
    #[payable("EGLD")]
    #[endpoint(deployInterchainToken)]
    fn deploy_interchain_token(
        &self,
        salt: ManagedByteArray<KECCAK256_RESULT_LEN>,
        destination_chain: ManagedBuffer,
        name: ManagedBuffer,
        symbol: ManagedBuffer,
        decimals: u8,
        minter: ManagedBuffer,
    ) -> TokenId<Self::Api> {
        self.require_not_paused();

        let mut deployer = self.blockchain().get_caller();

        if deployer == self.interchain_token_factory().get() {
            deployer = ManagedAddress::zero();
        }

        let token_id = self.interchain_token_id(&deployer, &salt);

        if destination_chain.is_empty() {
            let minter_raw = ManagedAddress::try_from(minter);
            let minter = if minter_raw.is_err() {
                None
            } else {
                Some(minter_raw.unwrap())
            };

            // On first transaction, deploy the token manager and on second transaction deploy ESDT through the token manager
            // This is because we can not deploy token manager and call it to deploy the token in the same transaction
            let token_manager_address_mapper = self.token_manager_address(&token_id);
            if token_manager_address_mapper.is_empty() {
                require!(
                    self.call_value().egld_value().deref() == &BigUint::zero(),
                    "Can not send EGLD payment if not issuing ESDT"
                );

                let mut params = ManagedBuffer::new();

                DeployTokenManagerParams {
                    operator: minter,
                    token_identifier: None,
                }
                .top_encode(&mut params)
                .unwrap();

                self.deploy_token_manager_raw(&token_id, TokenManagerType::MintBurn, params);

                return token_id;
            }

            self.token_manager_deploy_interchain_token(&token_id, minter, name, symbol, decimals);
        } else {
            let gas_value = self.call_value().egld_value();
            let gas_value = gas_value.deref();

            self.deploy_remote_interchain_token(
                &token_id,
                name,
                symbol,
                decimals,
                minter,
                destination_chain,
                gas_value,
            );
        }

        token_id
    }

    #[payable("*")]
    #[endpoint(expressExecute)]
    fn express_execute_endpoint(
        &self,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        self.require_not_paused();

        let interchain_transfer_payload =
            InterchainTransferPayload::<Self::Api>::abi_decode(payload.clone());

        require!(
            interchain_transfer_payload.message_type == MESSAGE_TYPE_INTERCHAIN_TRANSFER,
            "Invalid express message type"
        );

        require!(
            !self.gateway_is_command_executed(&command_id),
            "Already executed"
        );

        let express_executor = self.blockchain().get_caller();
        let payload_hash = self.crypto().keccak256(payload);

        self.express_executed_event(
            &command_id,
            &source_chain,
            &source_address,
            &payload_hash,
            &express_executor,
        );

        let express_hash = self.set_express_executor(
            &command_id,
            &source_chain,
            &source_address,
            &payload_hash,
            &express_executor,
        );

        self.express_execute_raw(
            command_id,
            source_chain,
            interchain_transfer_payload,
            express_executor,
            express_hash,
        );
    }

    #[payable("*")]
    #[endpoint(interchainTransfer)]
    fn interchain_transfer(
        &self,
        token_id: TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        metadata: ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.require_not_paused();

        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        // TODO: Handle gas value using WEGLD
        // Send cross chain only the amount which was not used to pay for gas
        self.token_manager_take_token(&token_id, token_identifier, &amount - &gas_value);

        let (metadata_version, data) = self.decode_metadata(metadata);

        self.transmit_interchain_transfer_raw(
            token_id,
            self.blockchain().get_caller(),
            destination_chain,
            destination_address,
            amount,
            metadata_version,
            data,
            gas_value,
        );
    }

    #[payable("*")]
    #[endpoint(callContractWithInterchainToken)]
    fn call_contract_with_interchain_token(
        &self,
        token_id: TokenId<Self::Api>,
        destination_chain: ManagedBuffer,
        destination_address: ManagedBuffer,
        data: ManagedBuffer,
        gas_value: BigUint,
    ) {
        self.require_not_paused();

        require!(!data.is_empty(), "Empty data");

        let (token_identifier, amount) = self.call_value().egld_or_single_fungible_esdt();

        // TODO: Handle gas value using WEGLD
        // Send cross chain only the amount which was not used to pay for gas
        self.token_manager_take_token(&token_id, token_identifier, &amount - &gas_value);

        self.transmit_interchain_transfer_raw(
            token_id,
            self.blockchain().get_caller(),
            destination_chain,
            destination_address,
            amount,
            MetadataVersion::ContractCall,
            data,
            gas_value,
        );
    }

    /// Owner functions

    #[endpoint(setFlowLimits)]
    fn set_flow_limits(
        &self,
        token_ids: MultiValueManagedVecCounted<TokenId<Self::Api>>,
        flow_limits: MultiValueManagedVecCounted<BigUint>,
    ) {
        self.only_operator();

        require!(token_ids.len() == flow_limits.len(), "Length mismatch");

        for (token_id, flow_limit) in token_ids
            .into_vec()
            .iter()
            .zip(flow_limits.into_vec().iter())
        {
            self.token_manager_set_flow_limit(token_id.deref(), flow_limit.deref());
        }
    }

    /// Internal Functions

    // Needs to be payable because it can issue ESDT token through the TokenManager
    #[payable("EGLD")]
    #[endpoint]
    fn execute(
        &self,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) {
        self.require_not_paused();
        self.only_remote_service(&source_chain, &source_address);

        let payload_hash = self.crypto().keccak256(&payload);

        let message_type = ParamType::Uint256
            .abi_decode(&payload, 0)
            .token
            .into_biguint()
            .to_u64()
            .unwrap();

        match message_type {
            MESSAGE_TYPE_INTERCHAIN_TRANSFER | MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER => {
                require!(
                    self.call_value().egld_value().deref() == &BigUint::zero(),
                    "Can not send EGLD payment if not issuing ESDT"
                );

                let valid = self.gateway_validate_contract_call(
                    &command_id,
                    &source_chain,
                    &source_address,
                    &payload_hash,
                );

                require!(valid, "Not approved by gateway");
            }
            MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN => {
                // This is checked inside process_deploy_interchain_token_payload function
            }
            _ => {
                sc_panic!("Invalid message type");
            }
        }

        match message_type {
            MESSAGE_TYPE_INTERCHAIN_TRANSFER => {
                let express_executor = self.pop_express_executor(
                    &command_id,
                    &source_chain,
                    &source_address,
                    &payload_hash,
                );

                if !express_executor.is_zero() {
                    self.express_execution_fulfilled_event(
                        &command_id,
                        &source_chain,
                        &source_address,
                        &payload_hash,
                        &express_executor,
                    );
                }

                self.process_interchain_transfer_payload(
                    command_id,
                    express_executor,
                    source_chain,
                    payload,
                );
            }
            MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER => {
                self.process_deploy_token_manager_payload(payload);
            }
            MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN => {
                self.process_deploy_interchain_token_payload(
                    command_id,
                    source_chain,
                    source_address,
                    payload_hash,
                    payload,
                );
            }
            _ => {
                sc_panic!("Invalid message type");
            }
        }
    }

    /// Private Functions

    fn express_execute_raw(
        &self,
        command_id: ManagedByteArray<KECCAK256_RESULT_LEN>,
        source_chain: ManagedBuffer,
        interchain_transfer_payload: InterchainTransferPayload<Self::Api>,
        express_executor: ManagedAddress,
        express_hash: ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) {
        let destination_address =
            ManagedAddress::try_from(interchain_transfer_payload.destination_address).unwrap();

        let token_identifier = self.valid_token_identifier(&interchain_transfer_payload.token_id);

        let (sent_token_identifier, sent_amount) = self.call_value().egld_or_single_fungible_esdt();

        require!(
            sent_token_identifier == token_identifier
                && sent_amount == interchain_transfer_payload.amount,
            "Wrong token or amount sent"
        );

        self.interchain_transfer_received_event(
            &command_id,
            &interchain_transfer_payload.token_id,
            &source_chain,
            &interchain_transfer_payload.source_address,
            &destination_address,
            if interchain_transfer_payload.data.is_empty() {
                ManagedByteArray::from(&[0; KECCAK256_RESULT_LEN])
            } else {
                self.crypto().keccak256(&interchain_transfer_payload.data)
            },
            &interchain_transfer_payload.amount,
        );

        if !interchain_transfer_payload.data.is_empty() {
            self.executable_contract_express_execute_with_interchain_token(
                destination_address,
                source_chain,
                interchain_transfer_payload.source_address,
                interchain_transfer_payload.data,
                interchain_transfer_payload.token_id,
                token_identifier,
                interchain_transfer_payload.amount,
                express_executor,
                command_id,
                express_hash,
            );

            // Not technically needed, the async call above will end the execution
            return;
        }

        self.send().direct(
            &destination_address,
            &token_identifier,
            0,
            &interchain_transfer_payload.amount,
        );
    }

    fn only_token_manager(&self, token_id: &TokenId<Self::Api>) {
        let caller = self.blockchain().get_caller();

        require!(
            caller == self.valid_token_manager_address(token_id),
            "Not token manager"
        );
    }

    #[view(interchainTokenId)]
    fn interchain_token_id(
        &self,
        sender: &ManagedAddress,
        salt: &ManagedByteArray<KECCAK256_RESULT_LEN>,
    ) -> TokenId<Self::Api> {
        let prefix_interchain_token_id = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_INTERCHAIN_TOKEN_ID));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix_interchain_token_id.as_managed_buffer());
        encoded.append(sender.as_managed_buffer());
        encoded.append(salt.as_managed_buffer());

        self.crypto().keccak256(encoded)
    }

    #[view(contractCallValue)]
    fn contract_call_value(
        &self,
        source_chain: ManagedBuffer,
        source_address: ManagedBuffer,
        payload: ManagedBuffer,
    ) -> MultiValue2<EgldOrEsdtTokenIdentifier, BigUint> {
        self.only_remote_service(&source_chain, &source_address);
        self.require_not_paused();

        // TODO: Is this decoding fine? Since on EVM this structure is slightly different for some reason
        let interchain_transfer_payload = InterchainTransferPayload::abi_decode(payload);

        require!(
            interchain_transfer_payload.message_type == MESSAGE_TYPE_INTERCHAIN_TRANSFER,
            "Invalid express message type"
        );

        (
            self.valid_token_identifier(&interchain_transfer_payload.token_id),
            interchain_transfer_payload.amount,
        )
            .into()
    }

    #[view(interchainTokenFactory)]
    #[storage_mapper("interchain_token_factory")]
    fn interchain_token_factory(&self) -> SingleValueMapper<ManagedAddress>;

    #[view(chainNameHash)]
    #[storage_mapper("chain_name_hash")]
    fn chain_name_hash(&self) -> SingleValueMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;
}
