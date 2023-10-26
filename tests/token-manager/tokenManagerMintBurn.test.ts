import { afterEach, beforeEach, test } from "vitest";
import { assertAccount, e, SWallet, SWorld } from "xsuite";
import {
  CHAIN_NAME_HASH,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_ID_CANONICAL
} from '../helpers';
import {
  deployGasService,
  deployGatewayContract, deployIts, deployRemoteAddressValidator,
  deployTokenManagerLockUnlock,
  deployTokenManagerMintBurn, gasService, gateway, its, remoteAddressValidator, tokenManagerLockUnlock,
  tokenManagerMintBurn
} from '../itsHelpers';
import createKeccakHash from "keccak";

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
    balance: BigInt('10000000000000000'),
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
  await deployTokenManagerMintBurn(deployer);

  // Deploy ITS
  await deployGatewayContract(deployer);
  await deployGasService(deployer, deployer);
  await deployRemoteAddressValidator(deployer);
  await deployTokenManagerLockUnlock(deployer);
  await deployIts(deployer);

  // Re-deploy contract with correct code
  await deployTokenManagerMintBurn(deployer, deployer,itsAddr || its, TOKEN_ID);

  // Mock token manager being known by ITS
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(tokenManagerMintBurn),
    ]
  });
}

test("Init errors", async () => {
  const mockTokenId = createKeccakHash('keccak256').update('mockTokenId').digest('hex');

  await deployer.deployContract({
    code: "file:token-manager-mint-burn/output/token-manager-mint-burn.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
      e.Bytes(mockTokenId),
      deployer,
      e.Option(e.Str('EGLD')),
    ]
  }).assertFail({ code: 4, message: 'Invalid token address' });

  await deployer.deployContract({
    code: "file:token-manager-mint-burn/output/token-manager-mint-burn.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr('erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu'), // zero address
      e.Bytes(mockTokenId),
      deployer,
      e.Option(e.Str(TOKEN_ID)),
    ]
  }).assertFail({ code: 4, message: 'Token linker zero address' });
});

test("Interchain transfer", async () => {
  await deployTokenManager();

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Str('sth'), // Will not be taken into account by ITS contract
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens are burned by contract
  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
    ],
  });

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('10000000000000000'),
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 99_000,
        },
        {
          id: TOKEN_ID2,
          amount: 10_000,
        }
      ])
    ]
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...
});

test("Interchain transfer with data", async () => {
  await deployTokenManager();

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Tuple(e.U32(0), e.Str('sth')), // Specify custom metadata to send to ITS
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens are burned by contract
  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
    ],
  });

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('10000000000000000'),
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 99_000,
        },
        {
          id: TOKEN_ID2,
          amount: 10_000,
        }
      ])
    ]
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...
});

test("Interchain transfer errors", async () => {
  await deployTokenManagerMintBurn(deployer, deployer, deployer, TOKEN_ID);

  await user.callContract({
    callee: tokenManagerMintBurn,
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
  await deployRemoteAddressValidator(deployer);
  await deployTokenManagerLockUnlock(deployer);
  await deployIts(deployer);

  // Re-deploy contract with correct code
  await deployTokenManagerMintBurn(deployer, deployer, its, TOKEN_ID, false);

  // ITS doesn't know about this token manager
  await user.callContract({
    callee: tokenManagerMintBurn,
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
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(tokenManagerMintBurn),
    ],
  });

  // Wrong metadata version
  await user.callContract({
    callee: tokenManagerMintBurn,
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
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "interchainTransfer",
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });

  // Contract can not burn tokens
  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
    esdts: [{ id: TOKEN_ID, amount: 999 }],
  }).assertFail({ code: 10, message: 'action is not allowed' });
});

test("Call contract with interchain token", async () => {
  await deployTokenManager();

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "callContractWithInterchainToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Str('sth'), // Will be taken into account by ITS
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens are burned by contract
  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
    ],
  });

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('10000000000000000'),
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 99_000,
        },
        {
          id: TOKEN_ID2,
          amount: 10_000,
        }
      ])
    ]
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...
});

test("Call contract with interchain token errors", async () => {
  await deployTokenManagerMintBurn(deployer, deployer, deployer, TOKEN_ID);

  await user.callContract({
    callee: tokenManagerMintBurn,
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
  await deployRemoteAddressValidator(deployer);
  await deployTokenManagerLockUnlock(deployer);
  await deployIts(deployer);

  // Re-deploy contract with correct code
  await deployTokenManagerMintBurn(deployer, deployer, its, TOKEN_ID, false);

  // ITS doesn't know about this token manager
  await user.callContract({
    callee: tokenManagerMintBurn,
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
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(tokenManagerMintBurn),
    ],
  });

  // Test flow limit exceeded
  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "callContractWithInterchainToken",
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });

  // Contract can not burn tokens
  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "callContractWithInterchainToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
    esdts: [{ id: TOKEN_ID, amount: 999 }],
  }).assertFail({ code: 10, message: 'action is not allowed' });
});

test("Give token", async () => {
  await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  });

  // Tokens were minted and sent from contract to otherUser
  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
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
  await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

  // Set flow limit
  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(500),
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(500),
    ],
  });

  // Tokens were minted and sent from contract to otherUser
  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(500)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
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
    callee: tokenManagerMintBurn,
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
    callee: tokenManagerMintBurn,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(500),
    ],
  });

  kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(500)),
      e.kvs.Mapper('flow_in_amount', e.U64(1)).Value(e.U(500)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
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
  await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID, false);

  await otherUser.callContract({
    callee: tokenManagerMintBurn,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Not service' });

  // Test flow limit exceeded
  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });

  // Contract can not mint tokens
  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "giveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(999),
    ],
  }).assertFail({ code: 10, message: 'action is not allowed' });
});

test("Take token", async () => {
  await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }]
  });

  // Tokens were burned by contract
  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
    ],
  });

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('10000000000000000'),
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 99_000,
        },
        {
          id: TOKEN_ID2,
          amount: 10_000,
        }
      ])
    ]
  });
});

test("Take token flow limit", async () => {
  await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

  // Set flow limit
  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(500),
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 500 }]
  });

  // Tokens were burned by contract
  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
    ],
  });

  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600 - 1,
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 500 }]
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });

  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600,
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 500 }]
  });

  kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),
      e.kvs.Mapper('flow_out_amount', e.U64(1)).Value(e.U(500)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
    ],
  });

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('10000000000000000'),
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 99_000,
        },
        {
          id: TOKEN_ID2,
          amount: 10_000,
        }
      ])
    ]
  });
});

test("Take token errors", async () => {
  await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID, false);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    value: 1_000,
  }).assertFail({ code: 4, message: 'Not service' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    value: 1_000,
  }).assertFail({ code: 4, message: 'Wrong token sent' });

  // Test flow limit exceeded
  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }]
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });

  // Contract can not burn tokens
  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "takeToken",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 999 }],
  }).assertFail({ code: 10, message: 'action is not allowed' });
});

test("Deploy standardized token", async () => {
  await deployTokenManagerMintBurn(deployer, deployer, user);

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "deployStandardizedToken",
    gasLimit: 200_000_000,
    value: BigInt('5000000000000000'),
    funcArgs: [
      user,
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000_000),
      user,
    ],
  });

  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),

      // TODO: Check how to actually test the async call to the ESDT system contract here
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_token_callback'),
        e.Bytes('00000002'),
        e.U(1_000_000),
        e.Bytes('00000020'),
        user,
      )),
    ],
  });
});

test("Deploy standardized token errors", async () => {
  await deployTokenManagerMintBurn(deployer, deployer, user);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "deployStandardizedToken",
    gasLimit: 200_000_000,
    funcArgs: [
      user,
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000_000),
      user,
    ],
  }).assertFail({ code: 4, message: 'Not service' });

  // Manually set token identifier
  await tokenManagerMintBurn.setAccount({
    ...(await tokenManagerMintBurn.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "deployStandardizedToken",
    gasLimit: 200_000_000,
    funcArgs: [
      user,
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000_000),
      user,
    ],
  }).assertFail({ code: 4, message: 'Token address already exists' });
});

test("Set flow limit", async () => {
  await deployTokenManagerMintBurn(deployer, user, user, TOKEN_ID, false);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(500),
    ],
  }).assertFail({ code: 4, message: 'Not operator' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(500),
    ],
  });

  // Tokens were sent from contract to otherUser
  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(user),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
    ],
  });
});

test("Transfer operatorship", async () => {
  await deployTokenManagerMintBurn(deployer, user, user, TOKEN_ID, false);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "transferOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Not operator' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "transferOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  // Tokens were sent from contract to otherUser
  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });

  // Check that operator was changed
  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "transferOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });
});

test("Propose operatorship", async () => {
  await deployTokenManagerMintBurn(deployer, user, user, TOKEN_ID, false);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Not operator' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  // Tokens were sent from contract to otherUser
  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(user),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('proposed_operator').Value(deployer),
    ],
  });

  // Proposed operator can not call this function
  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Not operator' });

  // Proposed operator can change
  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  });

  // Tokens were sent from contract to otherUser
  kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(user),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Mapper('proposed_operator').Value(otherUser),
    ],
  });
});

test("Accept operatorship", async () => {
  await deployTokenManagerMintBurn(deployer, user, user, TOKEN_ID, false);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [],
  }).assertFail({ code: 4, message: 'Not proposed operator' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [],
  }).assertFail({ code: 4, message: 'Not proposed operator' });

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [],
  })

  // Tokens were sent from contract to otherUser
  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });
});
