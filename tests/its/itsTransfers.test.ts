import { afterEach, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, LSWallet, LSWorld } from 'xsuite';
import {
  INTERCHAIN_TOKEN_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_IDENTIFIER,
  TOKEN_IDENTIFIER2,
  TOKEN_IDENTIFIER_EGLD,
} from '../helpers';
import {
  deployContracts,
  gasService,
  its,
  ITS_HUB_CHAIN,
  itsRegisterCanonicalToken,
  itsRegisterCustomTokenLockUnlock,
} from '../itsHelpers';

let world: LSWorld;
let deployer: LSWallet;
let collector: LSWallet;
let user: LSWallet;

beforeEach(async () => {
  world = await LSWorld.start();
  await world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  });

  collector = await world.createWallet();
  deployer = await world.createWallet({
    balance: 10_000_000_000n,
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_IDENTIFIER,
          amount: 100_000,
        },
        {
          id: TOKEN_IDENTIFIER2,
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
          id: TOKEN_IDENTIFIER,
          amount: 100_000,
        },
        {
          id: TOKEN_IDENTIFIER2,
          amount: 10_000,
        },
      ]),
    ],
  });

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  world.terminate();
});

describe('Interchain transfer', () => {
  test('No data', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsRegisterCustomTokenLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''), // No data
        e.U(0),
      ],
      esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
    });

    // Assert NO gas was paid for cross chain call
    let kvs = await gasService.getAccount();
    assertAccount(kvs, {
      balance: 0,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });

    let tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_IDENTIFIER, amount: 1_000 }]), // Lock/Unlock token manager holds tokens in the contract
      ],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });

  test('With data', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsRegisterCustomTokenLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
      esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
    });

    // Assert NO gas was paid for cross chain call
    const kvs = await gasService.getAccount();
    assertAccount(kvs, {
      balance: 0,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });

    const tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [...baseTokenManagerKvs, e.kvs.Esdts([{ id: TOKEN_IDENTIFIER, amount: 1_000 }])],
    });
  });

  test('Errors', async () => {
    const { computedTokenId } = await itsRegisterCustomTokenLockUnlock(world, user);

    await user
      .callContract({
        callee: its,
        funcName: 'interchainTransfer',
        gasLimit: 20_000_000,
        value: 1_000,
        funcArgs: [
          e.TopBuffer(INTERCHAIN_TOKEN_ID),
          e.Str(OTHER_CHAIN_NAME),
          e.Str(OTHER_CHAIN_ADDRESS),
          e.Buffer(''), // No data
          e.U(0),
        ],
      })
      .assertFail({ code: 4, message: 'Token manager does not exist' });

    // Sending wrong token to token manager
    await user
      .callContract({
        callee: its,
        funcName: 'interchainTransfer',
        gasLimit: 20_000_000,
        value: 1_000,
        funcArgs: [
          e.TopBuffer(computedTokenId),
          e.Str(OTHER_CHAIN_NAME),
          e.Str(OTHER_CHAIN_ADDRESS),
          e.Buffer(''), // No data
          e.U(0),
        ],
      })
      .assertFail({ code: 10, message: 'error signalled by smartcontract' });

    await user
      .callContract({
        callee: its,
        funcName: 'interchainTransfer',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(computedTokenId),
          e.Str('Unsupported-Chain'),
          e.Str(OTHER_CHAIN_ADDRESS),
          e.Buffer(''), // No data
          e.U(0),
        ],
        esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
      })
      .assertFail({ code: 4, message: 'Untrusted chain' });

    // Chain is not trusted
    await user
      .callContract({
        callee: its,
        funcName: 'interchainTransfer',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(computedTokenId),
          e.Str('Unsupported-Chain'),
          e.Str(OTHER_CHAIN_ADDRESS),
          e.Str('sth'),
          e.U(0),
        ],
        esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
      })
      .assertFail({ code: 4, message: 'Untrusted chain' });

    await user
      .callContract({
        callee: its,
        funcName: 'interchainTransfer',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(computedTokenId),
          e.Str('Unsupported-Chain'),
          e.Buffer(''), // empty destination address
          e.Buffer(''), // No data
          e.U(0),
        ],
        esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
      })
      .assertFail({ code: 4, message: 'Empty destination address' });

    // Can not send directly to ITS Hub chain
    await user
      .callContract({
        callee: its,
        funcName: 'interchainTransfer',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(computedTokenId),
          e.Str(ITS_HUB_CHAIN),
          e.Str(OTHER_CHAIN_ADDRESS),
          e.Buffer(''), // No data
          e.U(0),
        ],
        esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
      })
      .assertFail({ code: 4, message: 'Untrusted chain' });
  });

  test('Gas token errors', async () => {
    await user
      .callContract({
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
      })
      .assertFail({ code: 4, message: 'Invalid gas value' });

    await user
      .callContract({
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
      })
      .assertFail({ code: 4, message: 'Invalid gas value' });

    const tempUser = (user = await world.createWallet({
      balance: BigInt('10000000000000000'),
      kvs: [
        e.kvs.Esdts([
          { id: TOKEN_IDENTIFIER, amount: 100_000 },
          { id: TOKEN_IDENTIFIER2, amount: 10_000 },
          { id: 'TOKEN3-987654', amount: 10_000 },
          { id: 'NFT-123456', amount: 1, nonce: 1 },
        ]),
      ],
    }));
    await tempUser
      .callContract({
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
          { id: TOKEN_IDENTIFIER, amount: 1_000 },
          { id: TOKEN_IDENTIFIER2, amount: 1_000 },
          { id: 'TOKEN3-987654', amount: 1_000 },
        ],
      })
      .assertFail({ code: 4, message: 'A maximum of two esdt payments are supported' });

    // One ESDT sent
    await tempUser
      .callContract({
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
        esdts: [{ id: 'NFT-123456', amount: 1, nonce: 1 }],
      })
      .assertFail({ code: 4, message: 'Only fungible esdts are supported' });

    await tempUser
      .callContract({
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
        esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
      })
      .assertFail({ code: 4, message: 'Gas amount should be zero' });

    // Two ESDTs sent
    await tempUser
      .callContract({
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
          { id: TOKEN_IDENTIFIER, amount: 1_000 },
          { id: 'NFT-123456', amount: 1, nonce: 1 },
        ],
      })
      .assertFail({ code: 4, message: 'Only fungible esdts are supported' });

    await tempUser
      .callContract({
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
          { id: TOKEN_IDENTIFIER, amount: 1_000 },
          { id: TOKEN_IDENTIFIER2, amount: 100 },
        ],
      })
      .assertFail({ code: 4, message: 'Invalid gas value' });

    await user
      .callContract({
        callee: its,
        funcName: 'interchainTransfer',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(INTERCHAIN_TOKEN_ID),
          e.Str(OTHER_CHAIN_NAME),
          e.Str(OTHER_CHAIN_ADDRESS),
          e.Buffer(''),
          e.U(100),
        ],
        esdts: [
          { id: TOKEN_IDENTIFIER, amount: 1_000 },
          { id: TOKEN_IDENTIFIER2, amount: 100 },
        ],
      })
      .assertFail({ code: 4, message: 'Only egld is supported for paying gas' });
  });

  test('Gas token egld', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsRegisterCanonicalToken(
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
    let kvs = await gasService.getAccount();
    assertAccount(kvs, {
      balance: 20,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });

    let tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 980,
      kvs: [...baseTokenManagerKvs],
    });
  });

  test('Gas token esdt + egld', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsRegisterCustomTokenLockUnlock(world, user);

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
        { id: TOKEN_IDENTIFIER, amount: 1_000 },
        { id: TOKEN_IDENTIFIER_EGLD, amount: 100 },
      ],
    });

    // Assert EGLD gas was paid for cross chain call
    let kvs = await gasService.getAccount();
    assertAccount(kvs, {
      balance: 100,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });

    let tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [...baseTokenManagerKvs, e.kvs.Esdts([{ id: TOKEN_IDENTIFIER, amount: 1_000 }])],
    });
  });

  test('Call contract', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsRegisterCustomTokenLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
      esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
    });

    // Assert NO gas was paid for cross chain call
    let kvs = await gasService.getAccount();
    assertAccount(kvs, {
      balance: 0,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });

    let tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_IDENTIFIER, amount: 1_000 }]), // Lock/Unlock token manager holds tokens in the contract
      ],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });
});
