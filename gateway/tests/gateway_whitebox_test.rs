use multiversx_sc::hex_literal::hex;
use multiversx_sc::types::Address;
use multiversx_sc_scenario::{scenario_model::*, *};
use gateway::*;

const GATEWAY_PATH_EXPR: &str = "file:output/gateway.wasm";

fn world() -> ScenarioWorld {
    let mut blockchain = ScenarioWorld::new();

    blockchain.register_contract(GATEWAY_PATH_EXPR, gateway::ContractBuilder);
    blockchain
}

// TODO: Add tests
// #[test]
// fn gateway_init_error() {
//     let mut world = world();
//     let gateway_whitebox = WhiteboxContract::new("sc:gateway", gateway::contract_obj);
//     let gateway_code = world.code_expression(GATEWAY_PATH_EXPR);
//
//     world
//         .set_state_step(
//             SetStateStep::new()
//                 .put_account("address:owner", Account::new().nonce(1))
//                 .new_address("address:owner", 1, "sc:gateway"),
//         )
//         .whitebox_deploy_check(
//             &gateway_whitebox,
//             ScDeployStep::new().from("address:owner").code(gateway_code),
//             |sc| {
//                 sc.init(
//                     &managed_address!(&Address::from(hex!(
//                         "0139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e1"
//                     ))),
//                     &managed_address!(&Address::from(hex!(
//                         "0139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e1"
//                     ))),
//                 );
//             },
//             |result| {
//                 print!("{:?}", result);
//
//                 assert_eq!(result.result_status, 4);
//                 result.assert_error(4, "Invalid auth module")
//             }
//         );
// }
