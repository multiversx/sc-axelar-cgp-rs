import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, FSWorld, LSWallet, LSWorld } from 'xsuite';
import {
  ADDRESS_ZERO,
  CHAIN_NAME,
  INTERCHAIN_TOKEN_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  OTHER_CHAIN_TOKEN_ADDRESS,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_MANAGER_ADDRESS,
  TOKEN_MANAGER_ADDRESS_2,
  TOKEN_SALT,
  TOKEN_SALT2,
} from '../helpers';
import {
  baseItsKvs,
  computeInterchainTokenId,
  deployContracts,
  deployTokenManagerInterchainToken,
  deployTokenManagerLockUnlock,
  deployTokenManagerMintBurn,
  gasService,
  gateway,
  interchainTokenFactory,
  its,
  ITS_HUB_ROUTING_IDENTIFIER,
  TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN,
  TOKEN_MANAGER_TYPE_LOCK_UNLOCK,
  TOKEN_MANAGER_TYPE_MINT_BURN,
  tokenManager,
} from '../itsHelpers';
import { AbiCoder } from 'ethers';
import { createAddressLike } from 'xsuite/dist/world/utils';

let world: LSWorld;
let deployer: LSWallet;
let collector: LSWallet;
let user: LSWallet;
let otherUser: LSWallet;

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

describe('Register token metadata', () => {
  test('Register token metadata', async () => {
    await user.callContract({
      callee: its,
      funcName: 'registerTokenMetadata',
      gasLimit: 100_000_000,
      funcArgs: [e.Str(TOKEN_ID)],
      value: 100,
    });

    let kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 100n,
      hasKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs
          .Mapper('CB_CLOSURE................................')
          .Value(
            e.Tuple(
              e.Str('register_token_metadata_callback'),
              e.TopBuffer('00000003'),
              e.Buffer(e.Str(TOKEN_ID).toTopU8A()),
              e.U(100),
              e.Buffer(user.toTopU8A())
            )
          ),
      ],
    });
  });

  test('Errors', async () => {
    await user
      .callContract({
        callee: its,
        funcName: 'registerTokenMetadata',
        gasLimit: 100_000_000,
        funcArgs: [e.Str('')],
      })
      .assertFail({ code: 4, message: 'Invalid token identifier' });
  });
});

describe('Register custom token', () => {
  test('Register custom token', async () => {
    let kvs = await its.getAccount();
    // Mock user as the interchain token factory for below call to work
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [kvs.kvs, e.kvs.Mapper('interchain_token_factory').Value(user)],
    });

    let result = await user.callContract({
      callee: its,
      funcName: 'registerCustomToken',
      gasLimit: 100_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(TOKEN_ID2),
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), // Lock/unlock
        e.Buffer(user.toTopU8A()),
      ],
    });

    const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO));

    assert(result.returnData[0] === computedTokenId);

    kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, user),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
      ],
    });

    const tokenManager = await world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limiter & operator roles
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),
        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID2)),
      ],
    });

    // Assert correct token manager type
    const query = await world.query({
      callee: tokenManager,
      funcName: 'implementationType',
      funcArgs: [],
    });

    assert(query.returnData[0] == '02'); // lock/unlock type

    // Can also register the same token with a different salt
    result = await user.callContract({
      callee: its,
      funcName: 'registerCustomToken',
      gasLimit: 100_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT2),
        e.Str(TOKEN_ID2),
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.Buffer(user.toTopU8A()),
      ],
    });

    kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, user),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(result.returnData[0])).Value(e.Addr(TOKEN_MANAGER_ADDRESS_2)),
      ],
    });
  });

  test('Errors', async () => {
    // Can only be called by interchain token factory
    await user
      .callContract({
        callee: its,
        funcName: 'registerCustomToken',
        gasLimit: 100_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(TOKEN_ID2),
          e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), // Lock/unlock
          e.Buffer(''),
        ],
      })
      .assertFail({ code: 4, message: 'Not interchain token factory' });

    let kvs = await its.getAccount();
    // Mock user as the interchain token factory for below call to work
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [kvs.kvs, e.kvs.Mapper('interchain_token_factory').Value(user)],
    });

    // Can not deploy type interchain token
    await user
      .callContract({
        callee: its,
        funcName: 'registerCustomToken',
        gasLimit: 20_000_000,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(TOKEN_ID2), e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN), e.Buffer('')],
      })
      .assertFail({ code: 4, message: 'Can not deploy native interchain token' });

    await user.callContract({
      callee: its,
      funcName: 'registerCustomToken',
      gasLimit: 100_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(TOKEN_ID2),
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), // Lock/unlock
        e.Buffer(user.toTopU8A()),
      ],
    });

    // Can not deploy same token with same salt
    await user
      .callContract({
        callee: its,
        funcName: 'registerCustomToken',
        gasLimit: 100_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(TOKEN_ID2),
          e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), // Lock/unlock
          e.Buffer(user.toTopU8A()),
        ],
      })
      .assertFail({ code: 4, message: 'Token manager already exists' });
  });
});

describe('Link token', () => {
  test('Link', async () => {
    // Mock token manager exists on source chain
    await deployTokenManagerLockUnlock(deployer, its);
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(tokenManager),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(otherUser))).Value(tokenManager),
      ],
    });

    let result = await user.callContract({
      callee: its,
      funcName: 'linkToken',
      gasLimit: 20_000_000,
      value: 100_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.Buffer(AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2)),
      ],
    });

    assert(result.returnData[0] === computeInterchainTokenId(user));

    // Nothing changes for its keys
    let kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(tokenManager),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(otherUser))).Value(tokenManager),
      ],
    });

    // Assert gas was paid for cross chain call
    kvs = await gasService.getAccount();
    assertAccount(kvs, {
      balance: 100_000,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...

    // This can be called multiple times, even by other caller (after he also deploys the token manager for source chain first)
    await otherUser.callContract({
      callee: its,
      funcName: 'linkToken',
      gasLimit: 20_000_000,
      value: 50_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.Buffer(AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2)),
      ],
    });

    kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(tokenManager),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(otherUser))).Value(tokenManager),
      ],
    });

    // Assert gas was paid for another cross chain call
    kvs = await gasService.getAccount();
    assertAccount(kvs, {
      balance: 150_000,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });
  });

  test('Errors', async () => {
    await user
      .callContract({
        callee: its,
        funcName: 'linkToken',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(OTHER_CHAIN_NAME),
          e.Str(''),
          e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
          e.Buffer(AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2)),
        ],
      })
      .assertFail({ code: 4, message: 'Empty token address' });

    await user
      .callContract({
        callee: its,
        funcName: 'linkToken',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(OTHER_CHAIN_NAME),
          e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
          e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN),
          e.Buffer(AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2)),
        ],
      })
      .assertFail({ code: 4, message: 'Can not deploy native interchain token' });

    await user
      .callContract({
        callee: its,
        funcName: 'linkToken',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(''), // Cannot deploy to same chain
          e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
          e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
          e.Buffer(AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2)),
        ],
      })
      .assertFail({ code: 4, message: 'Not supported' });

    await user
      .callContract({
        callee: its,
        funcName: 'linkToken',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(CHAIN_NAME), // Cannot deploy to same chain
          e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
          e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
          e.Buffer(AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2)),
        ],
      })
      .assertFail({ code: 4, message: 'Cannot deploy remotely to self' });

    await user
      .callContract({
        callee: its,
        funcName: 'linkToken',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(OTHER_CHAIN_NAME),
          e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
          e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
          e.Buffer(AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2)),
        ],
      })
      .assertFail({ code: 4, message: 'Token manager does not exist' });

    // Mock token manager exists on source chain
    await deployTokenManagerLockUnlock(deployer, its);
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(tokenManager),
      ],
    });

    await user
      .callContract({
        callee: its,
        funcName: 'linkToken',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str('SomeChain'),
          e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
          e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
          e.Buffer(AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2)),
        ],
      })
      .assertFail({ code: 4, message: 'Untrusted chain' });
  });
});

describe('Deploy interchain token', () => {
  test('Only deploy token manager minter', async () => {
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: baseItsKvs(deployer, user), // mock user as the factory
    });

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 20_000_000,
        value: BigInt('50000000000000000'),
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(''),
          e.Str('Token Name'),
          e.Str('TOKEN-SYMBOL'),
          e.U8(18),
          e.TopBuffer(user.toTopU8A()), // minter
        ],
      })
      .assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

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
        e.TopBuffer(user.toTopU8A()), // minter
      ],
    });

    const computedTokenId = computeInterchainTokenId();

    const kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [...baseItsKvs(deployer, user, computedTokenId)],
    });

    const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limit & operator roles
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),
      ],
    });
  });

  test('Only deploy token manager no minter', async () => {
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: baseItsKvs(deployer, user), // mock user as the factory
    });

    await user
      .callContract({
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
          e.Str('sth'), // invalid minter
        ],
      })
      .assertFail({ code: 4, message: 'Invalid MultiversX address' });

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 100_000_000,
      value: 0,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(''), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18), e.Str('')],
    });

    const computedTokenId = computeInterchainTokenId();

    const kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [...baseItsKvs(deployer, user, computedTokenId)],
    });

    const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
        e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000110)), // flow limit & operator roles added to zero address
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit & operator roles
      ],
    });
  });

  test('Only issue esdt minter', async () => {
    const baseTokenManagerKvs = await deployTokenManagerInterchainToken(deployer, its);

    const computedTokenId = computeInterchainTokenId();

    // Mock token manager already deployed as not being canonical so contract deployment is not tried again
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [
        ...baseItsKvs(deployer, user), // mock user as the factory

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });

    // Insufficient funds for issuing ESDT
    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000, // needs to be above 100_000_000
        value: 0,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(''),
          e.Str('Token Name'),
          e.Str('TOKEN-SYMBOL'),
          e.U8(18),
          e.TopBuffer(user.toTopU8A()), // minter
        ],
      })
      .assertFail({ code: 10, message: 'failed transfer (insufficient funds)' });

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000, // needs to be above 100_000_000
      value: BigInt('50000000000000000'),
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
        e.TopBuffer(user.toTopU8A()), // minter
      ],
    });

    let kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      hasKvs: [
        ...baseItsKvs(deployer, user),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });

    // Assert endpoint to deploy ESDT was called
    kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      hasKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000001)), // minter role was added to user
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs
          .Mapper('CB_CLOSURE................................')
          .Value(e.Tuple(e.Str('deploy_token_callback'), e.TopBuffer('00000000'))),
      ],
    });
  });

  test('Only issue esdt no minter', async () => {
    const baseTokenManagerKvs = await deployTokenManagerInterchainToken(deployer, its);

    const computedTokenId = computeInterchainTokenId();

    // Mock token manager already deployed as not being canonical so contract deployment is not tried again
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [
        ...baseItsKvs(deployer, user), // mock user as the factory

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000, // needs to be above 100_000_000
      value: BigInt('50000000000000000'),
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(''), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18), e.Str('')],
    });

    assertAccount(await its.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseItsKvs(deployer, user),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });
    // Assert endpoint to deploy ESDT was called
    assertAccount(await tokenManager.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseTokenManagerKvs,

        // minter role was set for zero address and its
        e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000001)),
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs
          .Mapper('CB_CLOSURE................................')
          .Value(e.Tuple(e.Str('deploy_token_callback'), e.TopBuffer('00000000'))),
      ],
    });
    assertAccount(await user.getAccount(), {
      balance: BigInt('50000000000000000'), // balance was changed
    });
  });

  test('Interchain token factory', async () => {
    // Mock user as the interchain token factory
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: baseItsKvs(deployer, user), // mock user as the factory
    });

    // Can only call through the factory
    await deployer
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(''),
          e.Str('Token Name'),
          e.Str('TOKEN-SYMBOL'),
          e.U8(18),
          e.TopBuffer(user.toTopU8A()), // minter
        ],
      })
      .assertFail({ code: 4, message: 'Not interchain token factory' });

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
        e.TopBuffer(user.toTopU8A()), // minter
      ],
    });

    // Token id is instead computed for the zero adress
    const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO));

    const kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [...baseItsKvs(deployer, user, computedTokenId)],
    });
  });
});

describe('Deploy interchain token remote', () => {
  test('Remote', async () => {
    const computedTokenId = computeInterchainTokenId();

    // Mock token manager exists on source chain
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [
        ...baseItsKvs(deployer, user), // mock user as factory

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
      ],
    });

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 20_000_000,
        value: 100_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(OTHER_CHAIN_NAME),
          e.Str(''),
          e.Str('TOKEN-SYMBOL'),
          e.U8(18),
          e.Str(OTHER_CHAIN_ADDRESS), // minter
        ],
      })
      .assertFail({ code: 4, message: 'Empty token name' });

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 20_000_000,
        value: 100_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(OTHER_CHAIN_NAME),
          e.Str('Token Name'),
          e.Str(''),
          e.U8(18),
          e.Str(OTHER_CHAIN_ADDRESS), // minter
        ],
      })
      .assertFail({ code: 4, message: 'Empty token symbol' });

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 20_000_000,
      value: 100_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
        e.Str(OTHER_CHAIN_ADDRESS), // minter
      ],
    });

    // Nothing changes for its keys
    let kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, user), // mock user as factory

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
      ],
    });

    // Assert gas was paid for cross chain call
    kvs = await gasService.getAccount();
    assertAccount(kvs, {
      balance: 100_000,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });

  test('Remote errors', async () => {
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: baseItsKvs(deployer, user), // mock user as factory
    });

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 20_000_000,
        value: 100_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(OTHER_CHAIN_NAME),
          e.Str('Token Name'),
          e.Str('TOKEN-SYMBOL'),
          e.U8(18),
          e.Str(OTHER_CHAIN_ADDRESS), // minter
        ],
      })
      .assertFail({ code: 4, message: 'Token manager does not exist' });

    // Mock token manager exists on source chain
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [
        ...baseItsKvs(deployer, user),

        e.kvs
          .Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId()))
          .Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
      ],
    });

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 20_000_000,
        value: 100_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str('SomeChain'),
          e.Str('Token Name'),
          e.Str('TOKEN-SYMBOL'),
          e.U8(18),
          e.Str(OTHER_CHAIN_ADDRESS), // minter
        ],
      })
      .assertFail({ code: 4, message: 'Untrusted chain' });

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 20_000_000,
        value: 100_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(CHAIN_NAME),
          e.Str('Token Name'),
          e.Str('TOKEN-SYMBOL'),
          e.U8(18),
          e.Str(OTHER_CHAIN_ADDRESS), // minter
        ],
      })
      .assertFail({ code: 4, message: 'Cannot deploy remotely to self' });
  });
});
