import { afterEach, beforeEach, test } from "vitest";
import { assertAccount, e, SWallet, SWorld } from "xsuite";
import createKeccakHash from "keccak";
import {
  CHAIN_NAME,
  CHAIN_NAME_HASH,
  OTHER_CHAIN_ADDRESS, OTHER_CHAIN_ADDRESS_HASH,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_ID_CANONICAL
} from '../helpers';
import {
  deployGasService,
  deployGatewayContract,
  deployIts,
  deployInterchainTokenFactory,
  deployTokenManagerLockUnlock,
  deployTokenManagerMintBurn,
  gasService,
  gateway,
  its,
  interchainTokenFactory,
  tokenManagerLockUnlock,
  tokenManagerMintBurn
} from '../itsHelpers';

let world: SWorld;
let deployer: SWallet;
let user: SWallet;
let otherUser: SWallet;

beforeEach(async () => {
  world = await SWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  })

  deployer = await world.createWallet({
    balance: 10_000_000_000n,
  });
  user = await world.createWallet({
    balance: 10_000_000_000n,
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 100_000,
        },
        {
          id: TOKEN_ID2,
          amount: 10_000,
        }
      ])
    ]
  });
  otherUser = await world.createWallet();
});

afterEach(async () => {
  await world.terminate();
});

const deployTokenManager = async (itsAddr: SWallet | null = null) => {
  await deployTokenManagerLockUnlock(deployer);

  // Deploy ITS
  await deployGatewayContract(deployer);
  await deployGasService(deployer, deployer);
  await deployInterchainTokenFactory(deployer);
  await deployTokenManagerMintBurn(deployer);
  await deployIts(deployer);

  // Re-deploy contract with correct code
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, itsAddr || its);

  // Mock token manager being known by ITS
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000010)), // operator role

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),
      e.kvs.Mapper('chain_name').Value(e.Str(CHAIN_NAME)),

      e.kvs.Mapper('trusted_address_hash', e.Str(OTHER_CHAIN_NAME)).Value(e.Bytes(OTHER_CHAIN_ADDRESS_HASH)),
      e.kvs.Mapper('trusted_address', e.Str(OTHER_CHAIN_NAME)).Value(e.Str(OTHER_CHAIN_ADDRESS)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(tokenManagerLockUnlock)
    ]
  });
}

test("Init errors", async () => {
  const mockTokenId = createKeccakHash('keccak256').update('mockTokenId').digest('hex');

  await deployer.deployContract({
    code: "file:token-manager-lock-unlock/output/token-manager-lock-unlock.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
      e.Bytes(mockTokenId),
      e.Option(deployer),
      e.Option(null),
    ]
  }).assertFail({ code: 4, message: 'Invalid token address' });

  await deployer.deployContract({
    code: "file:token-manager-lock-unlock/output/token-manager-lock-unlock.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr('erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu'), // zero address
      e.Bytes(mockTokenId),
      e.Option(deployer),
      e.Option(e.Str(TOKEN_ID)),
    ]
  }).assertFail({ code: 4, message: 'Zero address' });
});

test("Init different arguments", async () => {
  const { contract } = await deployer.deployContract({
    code: "file:token-manager-lock-unlock/output/token-manager-lock-unlock.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      otherUser,
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Option(null),
      e.Option(e.Str(TOKEN_ID)),
    ]
  });

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(otherUser),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000110)), // flow limiter & operator roles
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });

  const { contract: contract2 } = await deployer.deployContract({
    code: "file:token-manager-lock-unlock/output/token-manager-lock-unlock.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      otherUser,
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Option(deployer),
      e.Option(e.Str(TOKEN_ID)),
    ]
  });

  kvs = await contract2.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(otherUser),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)), // flow limiter & operator roles
      e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000100)), // flow limiter role
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });
});

test("Interchain transfer", async () => {
  await deployTokenManager();

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Str('sth'), // Will not be taken into account by ITS contract
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens remain in contract
  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...
});

test("Interchain transfer with data", async () => {
  await deployTokenManager();

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Tuple(e.U32(0), e.Str('sth')), // Specify custom metadata to send to ITS
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens remain in contract
  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...
});

test("Interchain transfer errors", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID);

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "interchainTransfer",
    gasLimit: 5_000_000,
    value: 1_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
  }).assertFail({ code: 4, message: 'Wrong token sent' });

  // Deploy ITS
  await deployGatewayContract(deployer);
  await deployGasService(deployer, deployer);
  await deployInterchainTokenFactory(deployer);
  await deployTokenManagerMintBurn(deployer);
  await deployIts(deployer);

  // Re-deploy contract with correct code
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, its);

  // ITS doesn't know about this token manager
  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "interchainTransfer",
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

  // Mock token manager being known by ITS
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000010)), // operator role

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),
      e.kvs.Mapper('chain_name').Value(e.Str(CHAIN_NAME)),

      e.kvs.Mapper('trusted_address_hash', e.Str(OTHER_CHAIN_NAME)).Value(e.Bytes(OTHER_CHAIN_ADDRESS_HASH)),
      e.kvs.Mapper('trusted_address', e.Str(OTHER_CHAIN_NAME)).Value(e.Str(OTHER_CHAIN_ADDRESS)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(tokenManagerLockUnlock),
    ],
  });

  // Wrong metadata version
  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Tuple(e.U32(1), e.Str('')), // Specify custom metadata
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

  // Test flow limit exceeded
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "interchainTransfer",
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });
});

test("Call contract with interchain token", async () => {
  await deployTokenManager();

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "callContractWithInterchainToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Str('sth'), // Will be taken into account by ITS
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens remain in contract
  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...
});

test("Call contract with interchain token errors", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID);

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "callContractWithInterchainToken",
    gasLimit: 5_000_000,
    value: 1_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
  }).assertFail({ code: 4, message: 'Wrong token sent' });

  // Deploy ITS
  await deployGatewayContract(deployer);
  await deployGasService(deployer, deployer);
  await deployInterchainTokenFactory(deployer);
  await deployTokenManagerMintBurn(deployer);
  await deployIts(deployer);

  // Re-deploy contract with correct code
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, its);

  // ITS doesn't know about this token manager
  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "callContractWithInterchainToken",
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

  // Mock token manager being known by ITS
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000010)), // operator role

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),
      e.kvs.Mapper('chain_name').Value(e.Str(CHAIN_NAME)),

      e.kvs.Mapper('trusted_address_hash', e.Str(OTHER_CHAIN_NAME)).Value(e.Bytes(OTHER_CHAIN_ADDRESS_HASH)),
      e.kvs.Mapper('trusted_address', e.Str(OTHER_CHAIN_NAME)).Value(e.Str(OTHER_CHAIN_ADDRESS)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(tokenManagerLockUnlock),
    ],
  });

  // Test flow limit exceeded
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "callContractWithInterchainToken",
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });
});

test("Give token", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, user);

  // Ensure token manager has tokens
  await user.transfer({
    receiver: tokenManagerLockUnlock,
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    gasLimit: 5_000_000
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  });

  // Tokens were sent from contract to otherUser
  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0 }]),
    ],
  });

  const otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    allKvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });
});

test("Give token flow limit", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, user);

  // Ensure token manager has tokens
  await user.transfer({
    receiver: tokenManagerLockUnlock,
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    gasLimit: 5_000_000
  });

  // Set flow limit
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(500),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(500),
    ],
  });

  // Tokens were sent from contract to otherUser
  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(500)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 500 }]),
    ],
  });

  let otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    allKvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 500 }]),
    ],
  });

  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600 - 1,
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(500),
    ],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });

  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600,
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(500),
    ],
  });

  kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(500)),
      e.kvs.Mapper('flow_in_amount', e.U64(1)).Value(e.U(500)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0 }]),
    ],
  });

  otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    allKvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });
});

test("Give token errors", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, user);

  await otherUser.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Not service' });

  // Test flow limit exceeded
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });

  // Contract has no funds to send
  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(999),
    ],
  }).assertFail({ code: 10, message: 'insufficient funds' });
});

test("Take token", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, user);

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }]
  });

  // Tokens remain in contract
  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });
});

test("Take token flow limit", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, user);

  // Set flow limit
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(500),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 500 }]
  });

  // Tokens remain in contract
  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 500 }]),
    ],
  });

  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600 - 1,
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 500 }]
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });

  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600,
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 500 }]
  });

  kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),
      e.kvs.Mapper('flow_out_amount', e.U64(1)).Value(e.U(500)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });
});

test("Take token errors", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, user);

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    value: 1_000,
  }).assertFail({ code: 4, message: 'Not service' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    value: 1_000,
  }).assertFail({ code: 4, message: 'Wrong token sent' });

  // Test flow limit exceeded
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }]
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });
});

test("Set flow limit", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, user, user);

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(500),
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(500),
    ],
  });

  // Tokens were sent from contract to otherUser
  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
    ],
  });
});

test("Transfer operatorship", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, user, user);

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "transferOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "transferOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000100)), // flow limit role remained
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000010)), // operator role was transfered
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });

  // Check that operator was changed
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "transferOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });
});

test("Propose operatorship", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, user, user);

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000010)),
    ],
  });

  // Proposed operator can not call this function
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  // If called multiple times, multiple entries are added
  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  });

  kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000010)),
      e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000010)),
    ],
  });
});

test("Accept operatorship", async () => {
  await deployTokenManagerLockUnlock(deployer, TOKEN_ID, user, user);

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "acceptOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user,
    ],
  }).assertFail({ code: 4, message: 'Invalid proposed roles' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "acceptOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user,
    ],
  }).assertFail({ code: 4, message: 'Invalid proposed roles' });

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: "acceptOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user
    ],
  })

  // Tokens were sent from contract to otherUser
  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000100)), // flow limit role remained
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000010)), // operator role was changed
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });
});
