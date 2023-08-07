multiversx_sc::imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;
use crate::constants::{ApproveContractCallParams, BurnTokenParams, DeployTokenParams, MintTokenParams, TokenType, ESDT_ISSUE_COST, PREFIX_CONTRACT_CALL_APPROVED, PREFIX_CONTRACT_CALL_APPROVED_WITH_MINT, ApproveContractCallWithMintParams};
use crate::{events, proxy, tokens};
use crate::events::{ContractCallApprovedData, ContractCallApprovedWithMintData};

#[multiversx_sc::module]
pub trait Functions: tokens::Tokens + events::Events + proxy::ProxyModule {
    fn deploy_token(&self, params_raw: &ManagedBuffer) -> bool {
        let params: DeployTokenParams<Self::Api> =
            DeployTokenParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        // TODO: Should we implement this?
        // if !self.token_addresses(&params.symbol).is_empty() {
        //     return false;
        // }

        if params.token.is_none() {
            // If token address is no specified, it indicates a request to deploy one.

            // TODO: Store this issue cost in a mapper or something else?
            let issue_cost = BigUint::from(ESDT_ISSUE_COST);

            // TODO: In the SOL implementation, the token deployer is called. What should we do here?
            // Also, the cap is not utilized here at all, since tokens can be minted and burned on MultiversX without a cap
            // self.send()
            //     .esdt_system_sc_proxy()
            //     .issue_and_set_all_roles(
            //         issue_cost,
            //         params.symbol.clone(),
            //         params.symbol.clone(),
            //         EsdtTokenType::Fungible,
            //         params.decimals as usize,
            //     )
            //     .async_call_promise() // TODO: This feature is not supported yet
            //     .with_callback(
            //         self.callbacks()
            //             .deploy_token_callback(params.symbol, params.mint_limit),
            //     )
            //     .register_promise();
            // TODO: The token issuance can fail async and we don't know this when executing the command
            // Because of this, the command_id_hash is still added to command_executed and the
            // executed event is still dispatched. There needs to be a way to revert these
        } else {
            let token = params.token.unwrap();
            // If token address is specified, ensure that there is a valid token id provided
            if !token.is_valid() {
                self.token_does_not_exist_event(token);

                return false;
            }

            self.token_type(&token).set(TokenType::External);
            self.set_token_mint_limit(&token, &params.mint_limit);

            self.token_deployed_event(params.symbol, token);
        }

        return true;
    }

    fn mint_token(&self, params_raw: &ManagedBuffer) -> bool {
        let params: MintTokenParams<Self::Api> =
            MintTokenParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        return self.mint_token_raw(&params.symbol, &params.account, &params.amount);
    }

    fn burn_token(&self, params_raw: &ManagedBuffer) -> bool {
        let params: BurnTokenParams<Self::Api> =
            BurnTokenParams::<Self::Api>::top_decode(params_raw.clone()).unwrap();

        let token_type_mapper = self.token_type(&params.symbol);

        if token_type_mapper.is_empty() {
            return false;
        }

        // TODO: The SOL logic here is complex, not sure what to do here exactly...
        if token_type_mapper.get() == TokenType::External {
        } else {
        }

        return true;
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

    fn get_is_contract_call_approved_key(
        &self,
        command_id: &ManagedBuffer,
        source_chain: &ManagedBuffer,
        source_address: &ManagedBuffer,
        contract_address: &ManagedAddress,
        payload_hash: &ManagedBuffer,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let prefix: ManagedByteArray<KECCAK256_RESULT_LEN> = self
            .crypto()
            .keccak256(ManagedBuffer::new_from_bytes(PREFIX_CONTRACT_CALL_APPROVED));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix.as_managed_buffer());
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
        symbol: &EgldOrEsdtTokenIdentifier,
        amount: &BigUint,
    ) -> ManagedByteArray<KECCAK256_RESULT_LEN> {
        let prefix: ManagedByteArray<KECCAK256_RESULT_LEN> = self.crypto().keccak256(ManagedBuffer::new_from_bytes(
            PREFIX_CONTRACT_CALL_APPROVED_WITH_MINT,
        ));

        let mut encoded = ManagedBuffer::new();

        encoded.append(prefix.as_managed_buffer());
        encoded.append(command_id);
        encoded.append(source_chain);
        encoded.append(source_address);
        encoded.append(contract_address.as_managed_buffer());
        encoded.append(payload_hash);
        encoded.append(&symbol.clone().into_name());
        encoded.append(&amount.to_bytes_be_buffer());

        self.crypto().keccak256(encoded)
    }

    // #[promises_callback]
    // fn deploy_token_callback(
    //     &self,
    //     #[call_result] result: ManagedAsyncCallResult<TokenIdentifier>,
    //     symbol: ManagedBuffer,
    //     mint_limit: BigUint,
    // ) {
    //     match result {
    //         ManagedAsyncCallResult::Ok(token_id_raw) => {
    //             let token_id = EgldOrEsdtTokenIdentifier::esdt(token_id_raw);
    //
    //             self.token_type(&token_id)
    //                 .set(TokenType::InternalBurnableFrom);
    //
    //             self.set_token_mint_limit(&token_id, &mint_limit);
    //
    //             self.token_deployed_event(symbol, token_id);
    //         }
    //         ManagedAsyncCallResult::Err(_) => {
    //             // TODO: To whom should we return tokens? How should we handle this exactly?
    //             self.token_deploy_failed_event(symbol);
    //
    //             let caller = self.blockchain().get_owner_address();
    //             let returned = self.call_value().egld_or_single_esdt();
    //             if returned.token_identifier.is_egld() && returned.amount > 0 {
    //                 self.send()
    //                     .direct(&caller, &returned.token_identifier, 0, &returned.amount);
    //             }
    //         }
    //     }
    // }

    #[storage_mapper("contract_call_approved")]
    fn contract_call_approved(&self) -> WhitelistMapper<ManagedByteArray<KECCAK256_RESULT_LEN>>;
}
