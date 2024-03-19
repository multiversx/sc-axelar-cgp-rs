import { afterEach, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import { INTERCHAIN_TOKEN_ID, OTHER_CHAIN_ADDRESS, OTHER_CHAIN_NAME, TOKEN_ID, TOKEN_ID2 } from '../helpers';
import {
  baseItsKvs,
  deployContracts,
  gasService,
  interchainTokenFactory,
  its,
  itsDeployTokenManagerLockUnlock,
  LATEST_METADATA_VERSION,
} from '../itsHelpers';

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

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  await world.terminate();
});

describe('Interchain transfer', () => {
  test('No metadata', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''), // No metadata, uses default
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    });

    // Assert NO gas was paid for cross chain call
    let kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0,
      allKvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      allKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]), // Lock/Unlock token manager holds tokens in the contract
      ],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });

  test('With metadata', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    // Specify custom metadata
    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Tuple(
          e.U32(LATEST_METADATA_VERSION),
          e.Str('sth'),
        ),
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    });

    // Assert NO gas was paid for cross chain call
    const kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0,
      allKvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    const tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      allKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
      ],
    });
  });

  test('With partial metadata', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    // Specify custom metadata
    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Tuple(
          e.U32(LATEST_METADATA_VERSION),
        ),
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    });

    // Assert NO gas was paid for cross chain call
    const kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0,
      allKvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    const tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      allKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
      ],
    });
  });

  test('Errors', async () => {
    const { computedTokenId } = await itsDeployTokenManagerLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      value: 1_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''), // No metadata
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Token manager does not exist' });

    // Sending wrong token to token manager
    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      value: 1_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''), // No metadata
        e.U(0),
      ],
    }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Tuple(
          e.U32(2), // Wrong Metadata version,
          e.Str('sth'),
        ),
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    }).assertFail({ code: 4, message: 'Invalid metadata version' });

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str('Unsupported-Chain'),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''), // No metadata
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    }).assertFail({ code: 4, message: 'Untrusted chain' });

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str('Unsupported-Chain'),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Tuple(
          e.U32(LATEST_METADATA_VERSION), // Correct Metadata version,
          e.Str('sth'),
        ),
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    }).assertFail({ code: 4, message: 'Untrusted chain' });
  });

  test('Gas token errors', async () => {
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
    }).assertFail({ code: 4, message: 'Invalid gas value' });

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      value: 100,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''),
        e.U(100),
      ],
    }).assertFail({ code: 4, message: 'Invalid gas value' });

    const tempUser = user = await world.createWallet({
      balance: BigInt('10000000000000000'),
      kvs: [
        e.kvs.Esdts([
          { id: TOKEN_ID, amount: 100_000 },
          { id: TOKEN_ID2, amount: 10_000 },
          { id: 'TOKEN3-987654', amount: 10_000 },
          { id: 'NFT-123456', amount: 1, nonce: 1 },
        ]),
      ],
    });
    await tempUser.callContract({
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
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
        { id: TOKEN_ID2, amount: 1_000 },
        { id: 'TOKEN3-987654', amount: 1_000, }
      ],
    }).assertFail({ code: 4, message: 'A maximum of two esdt payments are supported' });

    // One ESDT sent
    await tempUser.callContract({
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
      esdts: [
        { id: 'NFT-123456', amount: 1, nonce: 1 },
      ],
    }).assertFail({ code: 4, message: 'Only fungible esdts are supported' });

    await tempUser.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''),
        e.U(1_000),
      ],
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
      ],
    }).assertFail({ code: 4, message: 'Invalid gas value' });

    // Two ESDTs sent
    await tempUser.callContract({
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
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
        { id: 'NFT-123456', amount: 1, nonce: 1 },
      ],
    }).assertFail({ code: 4, message: 'Only fungible esdts are supported' });

    await tempUser.callContract({
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
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
        { id: TOKEN_ID2, amount: 100 },
      ],
    }).assertFail({ code: 4, message: 'Invalid gas value' });
  });

  test('Gas token egld', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(
      world,
      user,
      false,
      'EGLD'
    );

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      value: 1_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''),
        e.U(20),
      ],
    });

    // Assert EGLD gas was paid for cross chain call
    let kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 20,
      allKvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 980,
      allKvs: [
        ...baseTokenManagerKvs,
      ],
    });
  });

  test('Gas token one esdt', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''),
        e.U(20),
      ],
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
      ],
    });

    // Assert ESDT gas was paid for cross chain call
    let kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0,
      allKvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

        e.kvs.Esdts([
          { id: TOKEN_ID, amount: 20 },
        ]),
      ],
    });

    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      allKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 980 }]),
      ],
    });
  });

  test('Gas token two esdts', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''),
        e.U(100),
      ],
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
        { id: TOKEN_ID2, amount: 100 },
      ],
    });

    // Assert 2nd ESDT gas was paid for cross chain call
    let kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0,
      allKvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

        e.kvs.Esdts([
          { id: TOKEN_ID2, amount: 100 },
        ]),
      ],
    });

    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      allKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
      ],
    });
  });
});

describe('Call contract with interchain token', () => {
  test('Call contract', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    });

    // Assert NO gas was paid for cross chain call
    let kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0,
      allKvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      allKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]), // Lock/Unlock token manager holds tokens in the contract
      ],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });

  test('Errors', async () => {
    const { computedTokenId } = await itsDeployTokenManagerLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      value: 1_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''), // No data
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    }).assertFail({ code: 4, message: 'Empty data' });

    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      value: 1_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Token manager does not exist' });

    // Sending wrong token
    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      value: 1_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
    }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

    // Sending to unsupported chain
    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str('Unsupported-Chain'),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    }).assertFail({ code: 4, message: 'Untrusted chain' });
  });

  test('Gas token errors', async () => {
    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Invalid gas value' });

    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      value: 100,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(100),
      ],
    }).assertFail({ code: 4, message: 'Invalid gas value' });

    const tempUser = user = await world.createWallet({
      balance: BigInt('10000000000000000'),
      kvs: [
        e.kvs.Esdts([
          { id: TOKEN_ID, amount: 100_000 },
          { id: TOKEN_ID2, amount: 10_000 },
          { id: 'TOKEN3-987654', amount: 10_000 },
          { id: 'NFT-123456', amount: 1, nonce: 1 },
        ]),
      ],
    });
    await tempUser.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
        { id: TOKEN_ID2, amount: 1_000 },
        { id: 'TOKEN3-987654', amount: 1_000, }
      ],
    }).assertFail({ code: 4, message: 'A maximum of two esdt payments are supported' });

    // One ESDT sent
    await tempUser.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
      esdts: [
        { id: 'NFT-123456', amount: 1, nonce: 1 },
      ],
    }).assertFail({ code: 4, message: 'Only fungible esdts are supported' });

    await tempUser.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(1_000),
      ],
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
      ],
    }).assertFail({ code: 4, message: 'Invalid gas value' });

    // Two ESDTs sent
    await tempUser.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
        { id: 'NFT-123456', amount: 1, nonce: 1 },
      ],
    }).assertFail({ code: 4, message: 'Only fungible esdts are supported' });

    await tempUser.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
        { id: TOKEN_ID2, amount: 100 },
      ],
    }).assertFail({ code: 4, message: 'Invalid gas value' });
  });

  test('Gas token egld', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(
      world,
      user,
      false,
      'EGLD'
    );

    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      value: 1_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(20),
      ],
    });

    // Assert EGLD gas was paid for cross chain call
    let kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 20,
      allKvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 980,
      allKvs: [
        ...baseTokenManagerKvs,
      ],
    });
  });

  test('Gas token one esdt', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(20),
      ],
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
      ],
    });

    // Assert ESDT gas was paid for cross chain call
    let kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0,
      allKvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

        e.kvs.Esdts([
          { id: TOKEN_ID, amount: 20 },
        ]),
      ],
    });

    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      allKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 980 }]),
      ],
    });
  });

  test('Gas token two esdts', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(100),
      ],
      esdts: [
        { id: TOKEN_ID, amount: 1_000 },
        { id: TOKEN_ID2, amount: 100 },
      ],
    });

    // Assert 2nd ESDT gas was paid for cross chain call
    let kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0,
      allKvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

        e.kvs.Esdts([
          { id: TOKEN_ID2, amount: 100 },
        ]),
      ],
    });

    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      allKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
      ],
    });
  });
});
