import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import {
  CHAIN_NAME,
  CHAIN_NAME_HASH,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_ADDRESS_HASH,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  INTERCHAIN_TOKEN_ID
} from '../helpers';
import {
  baseItsKvs, deployContracts,
  deployGasService,
  deployGatewayContract,
  deployInterchainTokenFactory,
  deployIts,
  deployTokenManagerLockUnlock,
  deployTokenManagerMintBurn,
  gasService,
  gateway, interchainTokenFactory,
  its, LATEST_METADATA_VERSION,
  tokenManagerLockUnlock,
  tokenManagerMintBurn,
} from '../itsHelpers';
import createKeccakHash from 'keccak';

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
    balance: BigInt('100000000000000000'),
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

const deployTokenManager = async (itsAddr: SWallet | null = null, mock: boolean = true) => {
  await deployContracts(deployer, otherUser);

  // Re-deploy contract with correct code
  await deployTokenManagerMintBurn(deployer, deployer,itsAddr || its, TOKEN_ID);

  if (mock) {
    // Mock token manager being known by ITS
    await its.setAccount({
      ...(await its.getAccountWithKvs()),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.Bytes(INTERCHAIN_TOKEN_ID)).Value(tokenManagerMintBurn),
      ]
    });
  }
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
      e.Option(deployer),
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
      e.Option(deployer),
      e.Option(e.Str(TOKEN_ID)),
    ]
  }).assertFail({ code: 4, message: 'Zero address' });
});

test("Init different arguments", async () => {
  const { contract } = await deployer.deployContract({
    code: "file:token-manager-mint-burn/output/token-manager-mint-burn.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      otherUser,
      e.Bytes(INTERCHAIN_TOKEN_ID),
      e.Option(null),
      e.Option(e.Str(TOKEN_ID)),
    ]
  });

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(otherUser),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000110)), // flow limiter & operator roles for its
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });

  const { contract: contract2 } = await deployer.deployContract({
    code: "file:token-manager-mint-burn/output/token-manager-mint-burn.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      otherUser,
      e.Bytes(INTERCHAIN_TOKEN_ID),
      e.Option(deployer),
      e.Option(null),
    ]
  });

  kvs = await contract2.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(otherUser),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)), // flow limiter & operator roles for operator
      e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000100)), // flow limiter role for its
    ],
  });
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
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
    ],
  });

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('100000000000000000'),
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
      e.Tuple(e.U32(LATEST_METADATA_VERSION), e.Str('sth')), // Specify custom metadata to send to ITS
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens are burned by contract
  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
    ],
  });

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('100000000000000000'),
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
  await deployTokenManager(null, false);

  // Re=deploy contract without burn role
  await deployTokenManagerMintBurn(deployer, deployer, its, TOKEN_ID, false);

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
      ...baseItsKvs(deployer),

      e.kvs.Mapper('token_manager_address', e.Bytes(INTERCHAIN_TOKEN_ID)).Value(tokenManagerMintBurn),
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
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
    ],
  });

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('100000000000000000'),
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
  await deployTokenManager(null, false);

  // Re=deploy contract without burn role
  await deployTokenManagerMintBurn(deployer, deployer, its, TOKEN_ID, false);

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
      ...baseItsKvs(deployer),

      e.kvs.Mapper('token_manager_address', e.Bytes(INTERCHAIN_TOKEN_ID)).Value(tokenManagerMintBurn),
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
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

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
    allKvs: baseKvs,
  });

  const otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    allKvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });
});

test("Give token flow limit", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

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
      ...baseKvs,

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(500)),
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
      ...baseKvs,

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(500)),
      e.kvs.Mapper('flow_in_amount', e.U64(1)).Value(e.U(500)),
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
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

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
    allKvs: baseKvs,
  });

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('100000000000000000'),
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
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

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
      ...baseKvs,

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),
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
      ...baseKvs,

      e.kvs.Mapper('flow_limit').Value(e.U(500)),
      e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),
      e.kvs.Mapper('flow_out_amount', e.U64(1)).Value(e.U(500)),
    ],
  });

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('100000000000000000'),
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

test("Deploy interchain token", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user);

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "deployInterchainToken",
    gasLimit: 200_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Option(user),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
    ],
  });

  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000101)), // distributor role was added to user

      // ESDT token deployment was tested on Devnet and it works fine
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_token_callback'),
        e.Bytes('00000000'),
      )),
    ],
  });
});

test("Deploy interchain token errors", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user);

  // Not sent enough EGLD funds for ESDT issue
  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "deployInterchainToken",
    gasLimit: 200_000_000,
    value: BigInt('1'),
    funcArgs: [
      e.Option(user),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
    ],
  }).assertFail({ code: 7, message: 'failed transfer (insufficient funds)' });

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "deployInterchainToken",
    gasLimit: 200_000_000,
    funcArgs: [
      e.Option(user),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
    ],
  }).assertFail({ code: 4, message: 'Not service or distributor' });

  // Manually set token identifier
  await tokenManagerMintBurn.setAccount({
    ...(await tokenManagerMintBurn.getAccountWithKvs()),
    kvs: [
      ...baseKvs,

      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "deployInterchainToken",
    gasLimit: 200_000_000,
    funcArgs: [
      e.Option(user),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
    ],
  }).assertFail({ code: 4, message: 'Token address already exists' });
});

test("Mint", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, otherUser, TOKEN_ID, true, user);

  // Only distributor can call this
  await otherUser.callContract({
    callee: tokenManagerMintBurn,
    funcName: "mint",
    gasLimit: 20_000_000,
    funcArgs: [
      user,
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "mint",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  });

  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: baseKvs,
  });

  // 1_000 tokens were minted and sent to otherUser
  const userKvs = await otherUser.getAccountWithKvs();
  assertAccount(userKvs, {
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 1_000,
        },
      ])
    ]
  });
});

test("Burn", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, otherUser, TOKEN_ID, true, user);

  // Only distributor can call this
  await otherUser.callContract({
    callee: tokenManagerMintBurn,
    funcName: "burn",
    gasLimit: 20_000_000,
    funcArgs: [],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "burn",
    gasLimit: 20_000_000,
    funcArgs: [],
    value: 1_000
  }).assertFail({ code: 4, message: 'Wrong token sent' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "burn",
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }]
  });

  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: baseKvs,
  });

  // 1_000 tokens were burned
  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('100000000000000000'),
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

test("Mint & burn errors", async () => {
  await deployTokenManagerMintBurn(deployer, deployer, otherUser, null, false, user);

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "mint",
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Token address not yet set' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "burn",
    gasLimit: 20_000_000,
    funcArgs: [],
  }).assertFail({ code: 4, message: 'Token address not yet set' });
});

test("Transfer operatorship", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, user, user);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "transferOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "transferOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000100)), // flow limit role remained
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000010)), // operator role was transferred
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
  const baseKvs = await deployTokenManagerMintBurn(deployer, user, user);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000010)),
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
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  // If called multiple times, multiple entries are added
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
      ...baseKvs,

      e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000010)),
      e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000010)),
    ],
  });
});

test("Accept operatorship", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, user, user);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user
    ],
  }).assertFail({ code: 4, message: 'Invalid proposed roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  // Propose other
  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user
    ],
  }).assertFail({ code: 4, message: 'Invalid proposed roles' });

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user
    ],
  })

  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000100)), // flow limit role remained
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000010)), // operator role was changed

      e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000010)),
    ],
  });

  // otherUser can no longer accept because user doesn't have operator role anymore
  await otherUser.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptOperatorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user
    ],
  }).assertFail({ code: 4, message: 'Missing all roles' });
});

test("Transfer distributorship", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, otherUser, null, false, user);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "transferDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "transferDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  });

  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000000)), // distributor role was removed
      e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000101)), // flow limit & distributor role
    ],
  });

  // Check that distributor was changed
  await otherUser.callContract({
    callee: tokenManagerMintBurn,
    funcName: "transferDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  });
});

test("Propose distributorship", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, otherUser, null, false, user);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  });

  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000001)),
    ],
  });

  // Proposed operator can not call this function
  await otherUser.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  // If called multiple times, multiple entries are added
  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000001)),
      e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000001)),
    ],
  });
});

test("Accept distributorship", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, otherUser, null, false, user);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user
    ],
  }).assertFail({ code: 4, message: 'Invalid proposed roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  });

  // Propose other
  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "proposeDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user
    ],
  }).assertFail({ code: 4, message: 'Invalid proposed roles' });

  await otherUser.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user
    ],
  })

  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000000)), // distributor role was removed
      e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000101)), // flow limit & distributor role

      e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000001)),
    ],
  });

  // deployer can no longer accept because user doesn't have distributor role anymore
  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "acceptDistributorship",
    gasLimit: 5_000_000,
    funcArgs: [
      user
    ],
  }).assertFail({ code: 4, message: 'Missing all roles' });
});

test("Add flow limiter", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, user, user);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "addFlowLimiter",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "addFlowLimiter",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role
    ],
  });
});

test("Remove flow limiter", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, user, user);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "removeFlowLimiter",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "addFlowLimiter",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "removeFlowLimiter",
    gasLimit: 5_000_000,
    funcArgs: [
      user,
    ],
  });

  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000010)), // operator role remained
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "removeFlowLimiter",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000010)), // operator role remained
    ],
  });
});

test("Set flow limit", async () => {
  const baseKvs = await deployTokenManagerMintBurn(deployer, user, user, TOKEN_ID, false);

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(100),
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "addFlowLimiter",
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  await user.callContract({
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(100),
    ],
  });

  let kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role

      e.kvs.Mapper('flow_limit').Value(e.U(100)),
    ],
  });

  await deployer.callContract({
    callee: tokenManagerMintBurn,
    funcName: "setFlowLimit",
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(200),
    ],
  });

  kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role

      e.kvs.Mapper('flow_limit').Value(e.U(200)),
    ],
  });
});
