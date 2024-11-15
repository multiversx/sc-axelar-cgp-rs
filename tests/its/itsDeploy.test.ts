import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, LSWallet, LSWorld } from 'xsuite';
import {
  ADDRESS_ZERO, CHAIN_NAME,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  OTHER_CHAIN_TOKEN_ADDRESS,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_MANAGER_ADDRESS, TOKEN_MANAGER_ADDRESS_2,
  TOKEN_SALT,
} from '../helpers';
import {
  baseItsKvs,
  computeInterchainTokenId,
  deployContracts, deployTokenManagerInterchainToken,
  deployTokenManagerMintBurn,
  gasService,
  interchainTokenFactory,
  its, TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN,
  TOKEN_MANAGER_TYPE_LOCK_UNLOCK, TOKEN_MANAGER_TYPE_MINT_BURN,
  tokenManager,
} from '../itsHelpers';
import { AbiCoder } from 'ethers';

let world: LSWorld;
let deployer: LSWallet;
let collector: LSWallet;
let user: LSWallet;
let otherUser: LSWallet;

beforeEach(async () => {
  world = await LSWorld.start();
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

describe('Deploy token manager', () => {
  test('Deploy', async () => {
    let result = await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 100_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''), // destination chain empty
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), // Lock/unlock
        e.Buffer(e.Tuple(
          e.Option(user),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopU8A()),
      ],
    });

    const computedTokenId = computeInterchainTokenId(user);

    assert(result.returnData[0] === computedTokenId);

    let kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
      ],
    });

    const tokenManager = await world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccountWithKvs();
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

    // Other caller can also deploy another token manager for this token with different salt
    result = await otherUser.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''), // destination chain empty
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.Buffer(e.Tuple(
          e.Option(otherUser),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopU8A()),
      ],
    });

    kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(result.returnData[0])).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });
  });

  test('Errors', async () => {
    // Params can not be empty
    await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 100_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''), // destination chain empty
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), // Lock/unlock
        e.Buffer(''),
      ],
    }).assertFail({ code: 4, message: 'Empty params' });

    // Can not deploy type interchain token
    await otherUser.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''),
        e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN),
        e.Buffer(e.Tuple(
          e.Option(otherUser),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopU8A()),
      ],
    }).assertFail({ code: 4, message: 'Can not deploy' });

    await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      value: 1_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''),
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
        e.Buffer(e.Tuple(
          e.Option(user),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopU8A()),
      ],
    }).assertFail({ code: 4, message: 'Can not accept EGLD if not cross chain call' });

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
        ).toTopU8A()),
      ],
    });

    // Can not deploy same token with same salt
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
        ).toTopU8A()),
      ],
    }).assertFail({ code: 4, message: 'Token manager already exists' });
  });

  test('Interchain token factory', async () => {
    // Mock user as the interchain token factory
    await its.setAccount({
      ...await its.getAccountWithKvs(),
      kvs: [
        ...baseItsKvs(deployer, user),
      ],
    });

    let result = await user.callContract({
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
        ).toTopU8A()),
      ],
    });

    // Token id is instead computed for the zero adress
    const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO));

    assert(result.returnData[0] === computedTokenId);

    let kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, user),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
      ],
    });
  });
});

describe('Deploy token manager remote', () => {
  test('Remote', async () => {
    // Mock token manager exists on source chain
    await its.setAccount({
      ...await its.getAccountWithKvs(),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(otherUser))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });

    let result = await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      value: 100_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.U8(2),
        e.Buffer(
          AbiCoder.defaultAbiCoder().encode(
            ['bytes', 'address'],
            [
              OTHER_CHAIN_ADDRESS,
              OTHER_CHAIN_TOKEN_ADDRESS,
            ],
          ).substring(2),
        ),
      ],
    });

    assert(result.returnData[0] === computeInterchainTokenId(user));

    // Nothing changes for its keys
    let kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(otherUser))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });

    // Assert gas was paid for cross chain call
    kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 100_000,
      kvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...

    // This can be called multiple times, even by other caller (after he also deploys the token manager for source chain first)
    await otherUser.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.U8(2),
        e.Buffer(
          AbiCoder.defaultAbiCoder().encode(
            ['bytes', 'address'],
            [
              OTHER_CHAIN_ADDRESS,
              OTHER_CHAIN_TOKEN_ADDRESS,
            ],
          ).substring(2),
        ),
      ],
    });

    kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(otherUser))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });
  });

  test('Remote errors', async () => {
    await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.U8(2),
        e.Buffer(
          AbiCoder.defaultAbiCoder().encode(
            ['bytes', 'address'],
            [
              OTHER_CHAIN_ADDRESS,
              OTHER_CHAIN_TOKEN_ADDRESS,
            ],
          ).substring(2),
        ),
      ],
    }).assertFail({ code: 4, message: 'Token manager does not exist' });

    // Mock token manager exists on source chain
    await its.setAccount({
      ...await its.getAccountWithKvs(),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
      ],
    });

    await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str('SomeChain'),
        e.U8(2), // Lock/unlock
        e.Buffer(e.Tuple(
          e.Option(user),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopU8A()),
      ],
    }).assertFail({ code: 4, message: 'Untrusted chain' });

    await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(CHAIN_NAME),
        e.U8(2), // Lock/unlock
        e.Buffer(e.Tuple(
          e.Option(user),
          e.Option(e.Str(TOKEN_ID2)),
        ).toTopU8A()),
      ],
    }).assertFail({ code: 4, message: 'Cannot deploy remotely to self' });
  });

});

describe('Deploy interchain token', () => {
  test('Only deploy token manager minter', async () => {
    await user.callContract({
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
    }).assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

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

    const computedTokenId = computeInterchainTokenId(user);

    const kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
      ],
    });

    const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccountWithKvs();
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
        e.Str('sth'), // invalid minter
      ],
    });

    const computedTokenId = computeInterchainTokenId(user);

    const kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
      ],
    });

    const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccountWithKvs();
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

    const computedTokenId = computeInterchainTokenId(user);

    // Mock token manager already deployed as not being canonical so contract deployment is not tried again
    await its.setAccount({
      ...(await its.getAccountWithKvs()),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });

    // Insufficient funds for issuing ESDT
    await user.callContract({
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
    }).assertFail({ code: 10, message: 'failed transfer (insufficient funds)' });

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

    let kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      hasKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });

    // Assert endpoint to deploy ESDT was called
    kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      hasKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000001)), // minter role was added to user & its
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000111)),

        // This was tested on Devnet and it works fine
        e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
          e.Str('deploy_token_callback'),
          e.TopBuffer('00000000'),
        )),
      ],
    });
  });

  test('Only issue esdt no minter', async () => {
    const baseTokenManagerKvs = await deployTokenManagerInterchainToken(deployer, its);

    const computedTokenId = computeInterchainTokenId(user);

    // Mock token manager already deployed as not being canonical so contract deployment is not tried again
    await its.setAccount({
      ...(await its.getAccountWithKvs()),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });

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
        e.Str('sth'), // invalid minter
      ],
    });

    assertAccount(await its.getAccountWithKvs(), {
      balance: 0n,
      hasKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });
    // Assert endpoint to deploy ESDT was called
    assertAccount(await tokenManager.getAccountWithKvs(), {
      balance: 0n,
      hasKvs: [
        ...baseTokenManagerKvs,

        // minter role was set for zero address and its
        e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000001)),
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000111)),

        // This was tested on Devnet and it works fine
        e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
          e.Str('deploy_token_callback'),
          e.TopBuffer('00000000'),
        )),
      ],
    });
    assertAccount(await user.getAccountWithKvs(), {
      balance: BigInt('50000000000000000'), // balance was changed
    });
  });

  test('Interchain token factory', async () => {
    // Mock user as the interchain token factory
    await its.setAccount({
      ...await its.getAccountWithKvs(),
      kvs: [
        ...baseItsKvs(deployer, user),
      ],
    });

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

    const kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, user, computedTokenId),
      ],
    });
  });
});

describe('Deploy interchain token remote', () => {

  test('Remote', async () => {
    const computedTokenId = computeInterchainTokenId(user);
    const computedTokenId2 = computeInterchainTokenId(otherUser);

    // Mock token manager exists on source chain
    await its.setAccount({
      ...await its.getAccountWithKvs(),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId2)).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });

    await user.callContract({
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
    }).assertFail({ code: 4, message: 'Empty token name' });

    await user.callContract({
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
    }).assertFail({ code: 4, message: 'Empty token symbol' });

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
    let kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId2)).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });

    // Assert gas was paid for cross chain call
    kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 100_000,
      kvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...

    // This can be called multiple times, even by other caller
    await otherUser.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
        e.Str(OTHER_CHAIN_ADDRESS), // minter
      ],
    });

    kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId2)).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });

    kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 100_000,
      kvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });
  });

  test('Remote errors', async () => {
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
    }).assertFail({ code: 4, message: 'Token manager does not exist' });

    // Mock token manager exists on source chain
    await its.setAccount({
      ...await its.getAccountWithKvs(),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
      ],
    });

    await user.callContract({
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
    }).assertFail({ code: 4, message: 'Untrusted chain' });

    await user.callContract({
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
    }).assertFail({ code: 4, message: 'Cannot deploy remotely to self' });
  });
});
