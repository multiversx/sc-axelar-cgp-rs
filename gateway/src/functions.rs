multiversx_sc::imports!();

use crate::constants::{ApproveContractCallParams, ApproveContractCallWithMintParams, DeployTokenParams, MintTokenParams, TokenType, SupportedToken};
use crate::events::{ContractCallApprovedData, ContractCallApprovedWithMintData};
use crate::{events, proxy, tokens};
use multiversx_sc::api::KECCAK256_RESULT_LEN;

#[multiversx_sc::module]
pub trait Functions: tokens::Tokens + events::Events + proxy::ProxyModule {
    fn deploy_token(&self, params_raw: &ManagedBuffer, command_id: &ManagedBuffer) -> (bool, Option<AsyncCall>) {
        let params: DeployTokenParams<Self::Api> =
            DeployTokenParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        let supported_token_mapper = self.supported_tokens(&params.symbol);

        if !supported_token_mapper.is_empty() {
            self.token_already_exists_event(params.symbol);

            return (false, Option::None);
        }

        if params.token.is_none() {
            // If token address is no specified, it indicates a request to deploy one.
            let issue_cost = self.esdt_issue_cost().get();

            if self.blockchain().get_sc_balance(&EgldOrEsdtTokenIdentifier::egld(), 0) < issue_cost {
                self.token_deploy_failed_not_enough_balance_event(params.symbol);

                return (false, Option::None);
            }

            // The cap is not utilized here at all, since tokens can be minted and burned on MultiversX without a cap
            let async_call = self.send()
                .esdt_system_sc_proxy()
                .issue_and_set_all_roles(
                    issue_cost,
                    params.name.clone(),
                    params.symbol.clone(),
                    EsdtTokenType::Fungible,
                    params.decimals as usize,
                )
                .async_call()
                .with_callback(
                    self.callbacks()
                        .deploy_token_callback(params.symbol, params.mint_limit, command_id),
                );

            // Return false for success since the call will be handled async
            return (false, Option::Some(async_call));
        } else {
            let token = params.token.unwrap();
            // If token is specified, ensure that there is a valid token id provided
            if !token.is_valid() {
                self.token_id_does_not_exist_event(token);

                return (false, Option::None);
            }

            self.token_deployed_event(&params.symbol, &token);
            self.token_mint_limit_updated_event(&params.symbol, &params.mint_limit);

            supported_token_mapper.set(SupportedToken {
                token_type: TokenType::External,
                identifier: token,
                mint_limit: params.mint_limit,
            });
        }

        return (true, Option::None);
    }

    fn mint_token(&self, params_raw: &ManagedBuffer) -> bool {
        let params: MintTokenParams<Self::Api> =
            MintTokenParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        self.mint_token_raw(&params.symbol, &params.account, &params.amount)
    }

    fn approve_contract_call(
        &self,
        params_raw: &ManagedBuffer,
        command_id: &ManagedBuffer,
    ) -> bool {
        let params: ApproveContractCallParams<Self::Api> =
            ApproveContractCallParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        let hash = self.get_is_contract_call_approved_key(
            command_id,
            &params.source_chain,
            &params.source_address,
            &params.contract_address,
            &params.payload_hash,
        );

        self.contract_call_approved().add(&hash);

        self.contract_call_approved_event(
            command_id,
            params.source_chain,
            params.source_address,
            params.contract_address,
            params.payload_hash,
            ContractCallApprovedData {
                source_tx_hash: params.source_tx_hash,
                source_event_index: params.source_event_index,
            },
        );

        return true;
    }

    fn approve_contract_call_with_mint(
        &self,
        params_raw: &ManagedBuffer,
        command_id: &ManagedBuffer,
    ) -> bool {
        let params: ApproveContractCallWithMintParams<Self::Api> =
            ApproveContractCallWithMintParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        let hash = self.get_is_contract_call_approved_with_mint_key(
            command_id,
            &params.source_chain,
            &params.source_address,
            &params.contract_address,
            &params.payload_hash,
            &params.symbol,
            &params.amount,
        );

        self.contract_call_approved().add(&hash);

        self.contract_call_approved_with_mint_event(
            command_id,
            params.source_chain,
            params.source_address,
            params.contract_address,
            params.payload_hash,
            ContractCallApprovedWithMintData {
                symbol: params.symbol,
                amount: params.amount,
                source_tx_hash: params.source_tx_hash,
                source_event_index: params.source_event_index,
            },
        );

        return true;
    }

    fn transfer_operatorship(&self, params: &ManagedBuffer) -> bool {
        self.auth_transfer_operatorship(params);

        self.operatorship_transferred_event(params);

        return true;
    }

    fn set_esdt_issue_cost(&self, params: &ManagedBuffer) -> bool {
        let issue_cost = BigUint::from(params);

        self.esdt_issue_cost().set(&issue_cost);

        self.set_esdt_issue_cost_event(issue_cost);

        return true;
    }

    fn get_is_contract_call_approved_key(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedBuffer,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        encoded.append(command_id);
        encoded.append(source_chain);
        encoded.append(source_address);
        encoded.append(contract_address.as_managed_buffer());
        encoded.append(payload_hash);

        self.crypto().keccak256(encoded)
    }

    fn get_is_contract_call_approved_with_mint_key(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedBuffer,
        symbol: &ManagedBuffer,
        amount: &BigUint,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let mut encoded = ManagedBuffer::new();

        encoded.append(command_id);
        encoded.append(source_chain);
        encoded.append(source_address);
        encoded.append(contract_address.as_managed_buffer());
        encoded.append(payload_hash);
        encoded.append(symbol);
        encoded.append(&amount.to_bytes_be_buffer());

        self.crypto().keccak256(encoded)
    }

    #[callback]
    fn deploy_token_callback(
        &self,
        #[call_result] result: ManagedAsyncCallResult<TokenIdentifier>,
        symbol: ManagedBuffer,
        mint_limit: BigUint,
        command_id: &ManagedBuffer,
    ) {
        match result {
            ManagedAsyncCallResult::Ok(token_id_raw) => {
                let token_id = EgldOrEsdtTokenIdentifier::esdt(token_id_raw);

                self.token_deployed_event(&symbol, &token_id);
                self.token_mint_limit_updated_event(&symbol, &mint_limit);

                self.supported_tokens(&symbol).set(SupportedToken {
                    token_type: TokenType::InternalBurnableFrom,
                    identifier: token_id,
                    mint_limit,
                });

                let command_id_hash = self.get_is_command_executed_key(command_id);

                self.command_executed().add(&command_id_hash);

                self.executed_event(command_id);
            }
            ManagedAsyncCallResult::Err(_) => {
                self.token_deploy_failed_event(symbol);

                // Leave issue cost egld payment in contract for use when retrying deployToken
            }
        }
    }

    fn get_is_command_executed_key(
        &self,
        command_id: &ManagedBuffer,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        self.crypto().keccak256(command_id)
    }

    #[storage_mapper("command_executed")]
    fn command_executed(&self) -> WhitelistMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[storage_mapper("contract_call_approved")]
    fn contract_call_approved(&self) -> WhitelistMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;

    #[storage_mapper("esdt_issue_cost")]
    fn esdt_issue_cost(&self) -> SingleValueMapper<BigUint>;
}
