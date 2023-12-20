import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import {
  ADDRESS_ZERO,
  CHAIN_NAME,
  COMMAND_ID,
  INTERCHAIN_TOKEN_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_ID_MANAGER_ADDRESS,
  TOKEN_SALT,
} from '../helpers';
import {
  baseItsKvs,
  computeInterchainTokenId,
  deployContracts,
  deployInterchainTokenFactory,
  deployIts,
  gasService,
  gateway,
  interchainTokenFactory,
  its, TOKEN_MANAGER_TYPE_LOCK_UNLOCK, TOKEN_MANAGER_TYPE_MINT_BURN,
  tokenManager,
  tokenManager,
} from '../itsHelpers';
import { Encodable } from 'xsuite/dist/data/Encodable';
import createKeccakHash from 'keccak';

let world: SWorld;
let deployer: SWallet;
let collector: SWallet;
let user: SWallet;
let otherUser: SWallet;

beforeEach(async () => {
  world = await SWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  });

  collector = await world.createWallet();
  deployer = await world.createWallet({
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
        },
      ]),
    ],
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
        },
      ]),
    ],
  });
  otherUser = await world.createWallet({
    balance: BigInt('10000000000000000'),
  });
});

afterEach(async () => {
  await world.terminate();
});

test('Init errors', async () => {
  await deployContracts(deployer, collector, false);

  for (let i = 0; i < 4; i++) {
    const codeArgs: Encodable[] = [
      gateway,
      gasService,
      tokenManager,
      deployer,
      e.Str(CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_ADDRESS),
    ];

    codeArgs[i] = e.Addr(ADDRESS_ZERO);

    await deployer.deployContract({
      code: 'file:interchain-token-service/output/interchain-token-service.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs,
    }).assertFail({ code: 4, message: 'Zero address' });
  }

  await deployer.deployContract({
    code: 'file:interchain-token-service/output/interchain-token-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      gasService,
      tokenManager,
      deployer,
      e.Str(''),

      e.U32(1),
      e.Str(OTHER_CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_ADDRESS),
    ],
  }).assertFail({ code: 4, message: 'Invalid chain name' });

  await deployer.deployContract({
    code: 'file:interchain-token-service/output/interchain-token-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      gasService,
      tokenManager,
      deployer,
      e.Str(CHAIN_NAME),

      e.U32(2),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_ADDRESS),
    ],
  }).assertFail({ code: 4, message: 'Length mismatch' });

  await deployer.deployContract({
    code: 'file:interchain-token-service/output/interchain-token-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      gasService,
      tokenManager,
      deployer,
      e.Str(CHAIN_NAME),

      e.U32(1),
      e.Str(''),

      e.U32(1),
      e.Str(OTHER_CHAIN_ADDRESS),
    ],
  }).assertFail({ code: 4, message: 'Zero string length' });
});

test('Set interchain token factory', async () => {
  await deployContracts(deployer, collector, false);
  await deployIts(deployer);
  await deployInterchainTokenFactory(deployer, false);

  await user.callContract({
    callee: its,
    funcName: 'setInterchainTokenFactory',
    funcArgs: [
      interchainTokenFactory,
    ],
    gasLimit: 10_000_000,
  }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' });

  await deployer.callContract({
    callee: its,
    funcName: 'setInterchainTokenFactory',
    funcArgs: [
      interchainTokenFactory,
    ],
    gasLimit: 10_000_000,
  });

  // Calling endpoint again won't change the storage
  await deployer.callContract({
    callee: its,
    funcName: 'setInterchainTokenFactory',
    funcArgs: [
      user,
    ],
    gasLimit: 10_000_000,
  });

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),
    ],
  });
});

describe('Operatorship', () => {
  test('Transfer', async () => {
    await deployContracts(deployer, collector);

    await user.callContract({
      callee: its,
      funcName: 'transferOperatorship',
      gasLimit: 10_000_000,
      funcArgs: [
        user,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await deployer.callContract({
      callee: its,
      funcName: 'transferOperatorship',
      gasLimit: 10_000_000,
      funcArgs: [
        user,
      ],
    });

    let kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseItsKvs(user, interchainTokenFactory),
      ],
    });

    // Check that operator was changed
    await user.callContract({
      callee: its,
      funcName: 'transferOperatorship',
      gasLimit: 10_000_000,
      funcArgs: [
        user,
      ],
    });
  });

  test('Propose', async () => {
    await deployContracts(deployer, collector);

    await user.callContract({
      callee: its,
      funcName: 'proposeOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await deployer.callContract({
      callee: its,
      funcName: 'proposeOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    });

    let kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('proposed_roles', deployer, user).Value(e.U32(0b00000010)),
      ],
    });

    // Proposed operator can not call this function
    await user.callContract({
      callee: its,
      funcName: 'proposeOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    // If called multiple times, multiple entries are added
    await deployer.callContract({
      callee: its,
      funcName: 'proposeOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        otherUser,
      ],
    });

    kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('proposed_roles', deployer, user).Value(e.U32(0b00000010)),
        e.kvs.Mapper('proposed_roles', deployer, otherUser).Value(e.U32(0b00000010)),
      ],
    });
  });

  test('Accept', async () => {
    await deployContracts(deployer, collector);

    await user.callContract({
      callee: its,
      funcName: 'acceptOperatorship',
      gasLimit: 10_000_000,
      funcArgs: [
        deployer,
      ],
    }).assertFail({ code: 4, message: 'Invalid proposed roles' });

    await deployer.callContract({
      callee: its,
      funcName: 'proposeOperatorship',
      gasLimit: 10_000_000,
      funcArgs: [
        user,
      ],
    });

    // Propose other
    await deployer.callContract({
      callee: its,
      funcName: 'proposeOperatorship',
      gasLimit: 10_000_000,
      funcArgs: [
        otherUser,
      ],
    });

    await deployer.callContract({
      callee: its,
      funcName: 'acceptOperatorship',
      gasLimit: 10_000_000,
      funcArgs: [
        user,
      ],
    }).assertFail({ code: 4, message: 'Invalid proposed roles' });

    await user.callContract({
      callee: its,
      funcName: 'acceptOperatorship',
      gasLimit: 10_000_000,
      funcArgs: [
        deployer,
      ],
    });

    let kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseItsKvs(user, interchainTokenFactory),

        e.kvs.Mapper('proposed_roles', deployer, otherUser).Value(e.U32(0b00000010)),
      ],
    });

    // otherUser can no longer accept because user doesn't have operator role anymore
    await otherUser.callContract({
      callee: its,
      funcName: 'acceptOperatorship',
      gasLimit: 10_000_000,
      funcArgs: [
        deployer,
      ],
    }).assertFail({ code: 4, message: 'Missing all roles' });
  });
});

describe('Pause unpause', () => {
  test('Pause', async () => {
    await deployContracts(deployer, collector);

    await user.callContract({
      callee: its,
      funcName: 'pause',
      gasLimit: 10_000_000,
      funcArgs: [],
    }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' });

    await deployer.callContract({
      callee: its,
      funcName: 'pause',
      gasLimit: 10_000_000,
      funcArgs: [],
    });

    const kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('pause_module:paused').Value(e.Bool(true)),
      ],
    });

    await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''), // destination chain empty
        e.U8(2), // Lock/unlock
        e.Buffer(e.Tuple(
          e.Option(user),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopBytes()),
      ],
    }).assertFail({ code: 4, message: 'Contract is paused' });

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 100_000_000,
      value: 0,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
        e.TopBuffer(user.toTopBytes()), // minter
      ],
    }).assertFail({ code: 4, message: 'Contract is paused' });

    await world.query({
      callee: its,
      funcName: 'contractCallValue',
      funcArgs: [
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''),
      ],
    }).assertFail({ code: 4, message: 'Contract is paused' });

    await user.callContract({
      callee: its,
      funcName: 'expressExecute',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(COMMAND_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''),
      ],
    }).assertFail({ code: 4, message: 'Contract is paused' });

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''),
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Contract is paused' });

    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''),
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Contract is paused' });

    await user.callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 50_000_000,
      funcArgs: [
        e.TopBuffer(COMMAND_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''),
      ],
    }).assertFail({ code: 4, message: 'Contract is paused' });
  });

  test('Unpause', async () => {
    await deployContracts(deployer, collector);

    // mock paused
    await its.setAccount({
      ...await its.getAccountWithKvs(),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('pause_module:paused').Value(e.Bool(true)),
      ],
    });

    await user.callContract({
      callee: its,
      funcName: 'unpause',
      gasLimit: 10_000_000,
      funcArgs: [],
    }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' });

    await deployer.callContract({
      callee: its,
      funcName: 'unpause',
      gasLimit: 10_000_000,
      funcArgs: [],
    });

    const kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('pause_module:paused').Value(e.Bool(false)),
      ],
    });

    // Call works
    await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''), // destination chain empty
        e.U8(2), // Lock/unlock
        e.Buffer(e.Tuple(
          e.Option(user),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopBytes()),
      ],
    });
  });
});

describe('Address tracker', () => {
  test('Set trusted address', async () => {
    await deployContracts(deployer, collector);

    const someChainName = 'SomeChain';
    const someChainAddress = 'SomeAddress';

    await user.callContract({
      callee: its,
      funcName: 'setTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(someChainName),
        e.Str(someChainAddress),
      ],
    }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' });

    await deployer.callContract({
      callee: its,
      funcName: 'setTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(''),
        e.Str(''),
      ],
    }).assertFail({ code: 4, message: 'Zero string length' });

    await deployer.callContract({
      callee: its,
      funcName: 'setTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(someChainName),
        e.Str(someChainAddress),
      ],
    });
    const someChainAddressHash = createKeccakHash('keccak256').update(someChainAddress).digest('hex');

    const kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('trusted_address_hash', e.Str(someChainName)).Value(e.TopBuffer(someChainAddressHash)),
        e.kvs.Mapper('trusted_address', e.Str(someChainName)).Value(e.Str(someChainAddress)),
      ],
    });
  });

  test('Remove trusted address', async () => {
    await deployContracts(deployer, collector);

    await user.callContract({
      callee: its,
      funcName: 'removeTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(OTHER_CHAIN_NAME),
      ],
    }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' });

    await deployer.callContract({
      callee: its,
      funcName: 'removeTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(''),
      ],
    }).assertFail({ code: 4, message: 'Zero string length' });

    await deployer.callContract({
      callee: its,
      funcName: 'removeTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(OTHER_CHAIN_NAME),
      ],
    });

    const kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('chain_name').Value(e.Str(CHAIN_NAME)),

        // OTHER_CHAIN_NAME was deleted
        e.kvs.Mapper('trusted_address_hash', e.Str(OTHER_CHAIN_NAME)).Value(e.Buffer('')),
        e.kvs.Mapper('trusted_address', e.Str(OTHER_CHAIN_NAME)).Value(e.Buffer('')),
      ],
    });
  });

  test('Address tracker storage mapper views', async () => {
    await deployContracts(deployer, collector);

    let result = await world.query({
      callee: its,
      funcName: 'chainName',
      funcArgs: [],
    });

    assert(result.returnData[0] === e.Str(CHAIN_NAME).toTopHex());

    result = await world.query({
      callee: its,
      funcName: 'trustedAddress',
      funcArgs: [
        e.Str(OTHER_CHAIN_NAME),
      ],
    });

    assert(result.returnData[0] === e.Str(OTHER_CHAIN_ADDRESS).toTopHex());

    result = await world.query({
      callee: its,
      funcName: 'trustedAddressHash',
      funcArgs: [
        e.Str(OTHER_CHAIN_NAME),
      ],
    });

    const otherChainAddressHash = createKeccakHash('keccak256').update(OTHER_CHAIN_ADDRESS).digest('hex');

    assert(result.returnData[0] === otherChainAddressHash);
  });
});

describe('Set flow limits', () => {
  test('Set', async () => {
    await deployContracts(deployer, collector);

    const computedTokenId = computeInterchainTokenId(user);

    await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''), // destination chain empty
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
        e.Buffer(e.Tuple(
          e.Option(user),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopBytes()),
      ],
    });

    await otherUser.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''), // destination chain empty
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
        e.Buffer(e.Tuple(
          e.Option(otherUser),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopBytes()),
      ],
    });

    const computedTokenId2 = computeInterchainTokenId(otherUser);

    await deployer.callContract({
      callee: its,
      funcName: 'setFlowLimits',
      gasLimit: 20_000_000,
      funcArgs: [
        e.U32(2),
        e.TopBuffer(computedTokenId),
        e.TopBuffer(computedTokenId2),

        e.U32(2),
        e.U(99),
        e.U(100),
      ],
    });

    let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      allKvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID2)),
        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limit & operator roles
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),

        e.kvs.Mapper('flow_limit').Value(e.U(99)),
      ],
    });

    tokenManager = await world.newContract('erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqpqqqqdz2m2t');
    tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      allKvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId2)),
        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID2)),
        e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000110)), // flow limit & operator roles
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),

        e.kvs.Mapper('flow_limit').Value(e.U(100)),
      ],
    });
  });

  test('Errors', async () => {
    await deployContracts(deployer, collector);

    const computedTokenId = computeInterchainTokenId(user);

    await user.callContract({
      callee: its,
      funcName: 'setFlowLimits',
      gasLimit: 20_000_000,
      funcArgs: [
        e.U32(1),
        e.TopBuffer(computedTokenId),

        e.U32(1),
        e.U(99),
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await deployer.callContract({
      callee: its,
      funcName: 'setFlowLimits',
      gasLimit: 20_000_000,
      funcArgs: [
        e.U32(1),
        e.TopBuffer(computedTokenId),

        e.U32(2),
        e.U(99),
        e.U(100),
      ],
    }).assertFail({ code: 4, message: 'Length mismatch' });

    await deployer.callContract({
      callee: its,
      funcName: 'setFlowLimits',
      gasLimit: 20_000_000,
      funcArgs: [
        e.U32(1),
        e.TopBuffer(computedTokenId),

        e.U32(1),
        e.U(100),
      ],
    }).assertFail({ code: 4, message: 'Token manager does not exist' });

    await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''), // destination chain empty
        e.U8(2), // Lock/unlock
        e.Buffer(e.Tuple(
          e.Option(user),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopBytes()),
      ],
    });

    // Remove its as flow limiter for token manager
    let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
    await user.callContract({
      callee: tokenManager,
      funcName: 'removeFlowLimiter',
      gasLimit: 5_000_000,
      funcArgs: [
        its,
      ],
    });

    // ITS not flow limiter of token manager
    await deployer.callContract({
      callee: its,
      funcName: 'setFlowLimits',
      gasLimit: 20_000_000,
      funcArgs: [
        e.U32(1),
        e.TopBuffer(computedTokenId),

        e.U32(1),
        e.U(100),
      ],
    }).assertFail({ code: 10, message: 'error signalled by smartcontract' });
  });
});
