import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, LSWallet, LSWorld } from 'xsuite';
import {
  ADDRESS_ZERO,
  CANONICAL_INTERCHAIN_TOKEN_ID,
  CHAIN_NAME,
  getKeccak256Hash,
  INTERCHAIN_TOKEN_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  OTHER_CHAIN_TOKEN_ADDRESS,
  TOKEN_IDENTIFIER,
  TOKEN_IDENTIFIER2,
  TOKEN_MANAGER_ADDRESS,
  TOKEN_MANAGER_ADDRESS_2,
  TOKEN_MANAGER_ADDRESS_3,
  TOKEN_SALT,
  TOKEN_SALT2,
} from '../helpers';
import {
  baseItsKvs,
  computeCanonicalInterchainTokenDeploySalt,
  computeInterchainTokenDeploySalt,
  computeInterchainTokenIdRaw,
  computeLinkedTokenId,
  deployContracts,
  deployTokenManagerInterchainToken,
  deployTokenManagerLockUnlock,
  gasService,
  its,
  TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN,
  TOKEN_MANAGER_TYPE_LOCK_UNLOCK,
  TOKEN_MANAGER_TYPE_MINT_BURN,
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
    balance: BigInt('100000000000000000'),
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
  otherUser = await world.createWallet({
    balance: BigInt('10000000000000000'),
  });
});

afterEach(async () => {
  await world.terminate();
});

const deployAndMockTokenManagerInterchainToken = async (burnRole: boolean = false, minter: LSWallet | null = null) => {
  await deployContracts(deployer, collector);

  let baseTokenManagerKvs;
  if (!burnRole) {
    baseTokenManagerKvs = await deployTokenManagerInterchainToken(deployer, its);
  } else {
    baseTokenManagerKvs = await deployTokenManagerInterchainToken(deployer, its, its, TOKEN_IDENTIFIER, true, minter || its);
  }

  const deploySalt = computeInterchainTokenDeploySalt(user);
  const computedTokenId = computeInterchainTokenIdRaw(deploySalt);

  // Mock token manager already deployed as not being canonical so contract deployment is not tried again
  await its.setAccount({
    ...(await its.getAccount()),
    kvs: [
      ...baseItsKvs(deployer),

      e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
    ],
  });

  return { baseTokenManagerKvs, computedTokenId };
};

const deployAndMockTokenManagerLockUnlock = async (
  tokenId: string = TOKEN_IDENTIFIER,
  interchainTokenId: string = INTERCHAIN_TOKEN_ID
) => {
  await deployContracts(deployer, collector);

  let baseTokenManagerKvs = await deployTokenManagerLockUnlock(deployer, its, deployer, tokenId, interchainTokenId);

  let deploySalt;
  if (interchainTokenId === INTERCHAIN_TOKEN_ID) {
    deploySalt = computeInterchainTokenDeploySalt(user);
  } else {
    deploySalt = computeCanonicalInterchainTokenDeploySalt(tokenId);
  }

  const computedTokenId = computeInterchainTokenIdRaw(deploySalt);

  // Mock token manager already deployed as not being canonical so contract deployment is not tried again
  await its.setAccount({
    ...(await its.getAccount()),
    kvs: [
      ...baseItsKvs(deployer),

      e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
    ],
  });
  return { baseTokenManagerKvs, computedTokenId };
};

describe('Deploy interchain token', () => {
  test('Only deploy token manager minter mint', async () => {
    await deployContracts(deployer, collector);

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 100_000_000,
        value: BigInt('50000000000000000'),
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str('TokenName'),
          e.Str('SYMBOL'),
          e.U8(18),
          e.U(1_000),
          user, // minter
        ],
      })
      .assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 100_000_000,
      value: 0,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('TokenName'), e.Str('SYMBOL'), e.U8(18), e.U(1_000), user],
    });

    const salt = computeInterchainTokenDeploySalt(user);
    const computedTokenId = computeInterchainTokenIdRaw(salt);

    const kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, computedTokenId),

        e.kvs.Mapper('interchain_token_status', e.TopBuffer(computedTokenId)).Value(e.U8(2)),
      ],
    });

    // ITS gets roles over token manager
    const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit and operator roles
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),
      ],
    });
  });

  test('Only deploy token manager minter no mint', async () => {
    await deployContracts(deployer, collector);

    // ITS contract can not be the minter
    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 100_000_000,
        value: 0,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('TokenName'), e.Str('SYMBOL'), e.U8(18), e.U(0), its],
      })
      .assertFail({ code: 4, message: 'Invalid minter' });

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 100_000_000,
      value: 0,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('TokenName'), e.Str('SYMBOL'), e.U8(18), e.U(0), user],
    });

    const salt = computeInterchainTokenDeploySalt(user);
    const computedTokenId = computeInterchainTokenIdRaw(salt);

    const kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, computedTokenId),

        e.kvs.Mapper('interchain_token_status', e.TopBuffer(computedTokenId)).Value(e.U8(1)),
      ],
    });

    // Minter gets roles over token manager
    const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limit and operator roles
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit role
      ],
    });
  });

  test('Only deploy token manager no minter no mint error', async () => {
    await deployContracts(deployer, collector);

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 100_000_000,
        value: 0,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('TokenName'), e.Str('SYMBOL'), e.U8(18), e.U(0)],
      })
      .assertFail({ code: 4, message: 'Zero supply token' });
  });

  test('Only issue esdt minter mint', async () => {
    const { baseTokenManagerKvs, computedTokenId } = await deployAndMockTokenManagerInterchainToken();

    // Insufficient funds for issuing ESDT
    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        value: 0,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('TokenName'), e.Str('SYMBOL'), e.U8(18), e.U(1_000), user],
      })
      .assertFail({ code: 10, message: 'error signalled by smartcontract' });

    // Insufficient funds for issuing ESDT
    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      value: BigInt('50000000000000000'),
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('TokenName'), e.Str('SYMBOL'), e.U8(18), e.U(1_000), user],
    });

    assertAccount(await its.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });
    assertAccount(await tokenManager.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000111)), // flow limiter & operator & minter roles

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs
          .Mapper('CB_CLOSURE................................')
          .Value(e.Tuple(e.Str('deploy_token_callback'), e.U32(1), e.Buffer(user.toTopU8A()))),
      ],
    });
    assertAccount(await user.getAccount(), {
      balance: BigInt('50000000000000000'), // balance was changed
    });
  });

  test('Only issue esdt minter no mint', async () => {
    const { baseTokenManagerKvs, computedTokenId } = await deployAndMockTokenManagerInterchainToken();

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      value: BigInt('50000000000000000'),
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str('TokenName'),
        e.Str('SYMBOL'),
        e.U8(18),
        e.U(0),
        user, // minter
      ],
    });

    assertAccount(await its.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });
    // Assert endpoint to deploy ESDT was called
    assertAccount(await tokenManager.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000001)), // minter role
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limiter & operator roles

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs
          .Mapper('CB_CLOSURE................................')
          .Value(e.Tuple(e.Str('deploy_token_callback'), e.U32(1), e.Buffer(user.toTopU8A()))),
      ],
    });
    assertAccount(await user.getAccount(), {
      balance: BigInt('50000000000000000'), // balance was changed
    });

    // Can not call again with initial supply
    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str('TokenName'),
          e.Str('SYMBOL'),
          e.U8(18),
          e.U(1_000), // initial supply not zero
          user, // minter
        ],
      })
      .assertFail({ code: 4, message: 'Token already initialized' });
  });

  test('Only issue esdt no minter', async () => {
    const { baseTokenManagerKvs, computedTokenId } = await deployAndMockTokenManagerInterchainToken();

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000, // needs to be above 100_000_000
      value: BigInt('50000000000000000'),
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str('TokenName'),
        e.Str('SYMBOL'),
        e.U8(18),
        e.U(1_000),
        e.Addr(ADDRESS_ZERO), // minter
      ],
    });

    assertAccount(await its.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });
    // Assert endpoint to deploy ESDT was called
    assertAccount(await tokenManager.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseTokenManagerKvs,

        // minter role was set for its
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000111)), // flow limiter & operator & minter roles

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs
          .Mapper('CB_CLOSURE................................')
          .Value(e.Tuple(e.Str('deploy_token_callback'), e.U32(1), e.Buffer(user.toTopU8A()))),
      ],
    });
    assertAccount(await user.getAccount(), {
      balance: BigInt('50000000000000000'), // balance was changed
    });
  });

  test('Only mint minter', async () => {
    const { baseTokenManagerKvs } = await deployAndMockTokenManagerInterchainToken(true);

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        value: BigInt('50000000000000000'),
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('TokenName'), e.Str('SYMBOL'), e.U8(18), e.U(1_000), user],
      })
      .assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('TokenName'), e.Str('SYMBOL'), e.U8(18), e.U(1_000), user],
    });

    // Assert user got all roles
    let kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseTokenManagerKvs,

        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000000)), // roles removed
        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000111)), // all roles
        e.kvs.Mapper('minter_address').Value(user),
      ],
    });

    // Assert tokens were minted
    kvs = await user.getAccount();
    assertAccount(kvs, {
      balance: BigInt('100000000000000000'),
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_IDENTIFIER,
            amount: 101_000,
          },
          {
            id: TOKEN_IDENTIFIER2,
            amount: 10_000,
          },
        ]),
      ],
    });

    const salt = computeInterchainTokenDeploySalt(user);
    const computedTokenId = computeInterchainTokenIdRaw(salt);

    assertAccount(await its.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),

        e.kvs.Mapper('interchain_token_status', e.TopBuffer(computedTokenId)).Value(e.U8(3)), // Minting completed
      ],
    });

    // Can not mint again
    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('TokenName'), e.Str('SYMBOL'), e.U8(18), e.U(1_000), user],
      })
      .assertFail({ code: 4, message: 'Token already initialized' });
  });

  test('Only mint no minter', async () => {
    const { baseTokenManagerKvs } = await deployAndMockTokenManagerInterchainToken(true);

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str('TokenName'),
        e.Str('SYMBOL'),
        e.U8(18),
        e.U(1_000),
        e.Addr(ADDRESS_ZERO),
      ],
    });

    // Assert user got all roles
    let kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseTokenManagerKvs,

        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000000)), // roles removed
        e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000111)), // operator & flow limiter & minter role
        e.kvs.Mapper('minter_address').Value(e.Addr(ADDRESS_ZERO)),
      ],
    });

    // Assert tokens were minted
    kvs = await user.getAccount();
    assertAccount(kvs, {
      balance: BigInt('100000000000000000'),
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_IDENTIFIER,
            amount: 101_000,
          },
          {
            id: TOKEN_IDENTIFIER2,
            amount: 10_000,
          },
        ]),
      ],
    });
  });

  test('Errors', async () => {
    await deployContracts(deployer, collector);

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 100_000_000,
        value: BigInt('50000000000000000'),
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str('Token Name'),
          e.Str('SYMBOL'),
          e.U8(18),
          e.U(1_000),
          user, // minter
        ],
      })
      .assertFail({ code: 4, message: 'Invalid token name' });

    await user
      .callContract({
        callee: its,
        funcName: 'deployInterchainToken',
        gasLimit: 100_000_000,
        value: BigInt('50000000000000000'),
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str('TokenName'),
          e.Str('TOKEN-SYMBOL'),
          e.U8(18),
          e.U(1_000),
          user, // minter
        ],
      })
      .assertFail({ code: 4, message: 'Invalid token symbol' });
  });
});

describe('Approvals deploy remote interchain token', () => {
  test('Approve deploy remote interchain token', async () => {
    await deployAndMockTokenManagerInterchainToken(true, deployer);

    // Token manager not found
    await user
      .callContract({
        callee: its,
        funcName: 'approveDeployRemoteInterchainToken',
        gasLimit: 150_000_000,
        funcArgs: [
          user,
          e.TopBuffer(TOKEN_SALT), // incorrect salt
          e.Str(OTHER_CHAIN_NAME),
          e.Buffer(OTHER_CHAIN_ADDRESS.slice(2)),
        ],
      })
      .assertFail({ code: 4, message: 'Not minter' });

    // Not minter
    await user
      .callContract({
        callee: its,
        funcName: 'approveDeployRemoteInterchainToken',
        gasLimit: 150_000_000,
        funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME), e.Buffer(OTHER_CHAIN_ADDRESS.slice(2))],
      })
      .assertFail({ code: 4, message: 'Not minter' });

    await deployer
      .callContract({
        callee: its,
        funcName: 'approveDeployRemoteInterchainToken',
        gasLimit: 150_000_000,
        funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str('unknown'), e.Buffer(OTHER_CHAIN_ADDRESS.slice(2))],
      })
      .assertFail({ code: 4, message: 'Invalid chain name' });

    await deployer.callContract({
      callee: its,
      funcName: 'approveDeployRemoteInterchainToken',
      gasLimit: 150_000_000,
      funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME), e.Buffer(OTHER_CHAIN_ADDRESS.slice(2))],
    });

    const deploySalt = computeInterchainTokenDeploySalt(user);
    const computedTokenId = computeInterchainTokenIdRaw(deploySalt);

    const approvalKey = getKeccak256Hash(
      Buffer.concat([
        Buffer.from(getKeccak256Hash('deploy-approval'), 'hex'),
        e.Tuple(deployer, e.TopBuffer(computedTokenId), e.Str(OTHER_CHAIN_NAME)).toNestU8A(),
      ])
    );
    const destinationMinterHash = getKeccak256Hash(Buffer.from(OTHER_CHAIN_ADDRESS.slice(2), 'hex'));

    assertAccount(await its.getAccount(), {
      kvs: [
        ...baseItsKvs(deployer, computedTokenId, TOKEN_MANAGER_ADDRESS_3),

        e.kvs
          .Mapper('approved_destination_minters', e.TopBuffer(approvalKey))
          .Value(e.TopBuffer(destinationMinterHash)),
      ],
    });
  });

  test('Revoke deploy remote interchain token', async () => {
    await deployAndMockTokenManagerInterchainToken(true, deployer);

    const deploySalt = computeInterchainTokenDeploySalt(user);

    const computedTokenId = computeInterchainTokenIdRaw(deploySalt);

    const approvalKey = getKeccak256Hash(
      Buffer.concat([
        Buffer.from(getKeccak256Hash('deploy-approval'), 'hex'),
        e.Tuple(deployer, e.TopBuffer(computedTokenId), e.Str(OTHER_CHAIN_NAME)).toNestU8A(),
      ])
    );
    const destinationMinterHash = getKeccak256Hash(Buffer.from(OTHER_CHAIN_ADDRESS.slice(2), 'hex'));

    // Mock approval
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [
        ...baseItsKvs(deployer, computedTokenId),

        e.kvs
          .Mapper('approved_destination_minters', e.TopBuffer(approvalKey))
          .Value(e.TopBuffer(destinationMinterHash)),
      ],
    });

    // Nothing will happen since it is not the correct minter
    await user.callContract({
      callee: its,
      funcName: 'revokeDeployRemoteInterchainToken',
      gasLimit: 150_000_000,
      funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    await deployer.callContract({
      callee: its,
      funcName: 'revokeDeployRemoteInterchainToken',
      gasLimit: 150_000_000,
      funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    // Approval was deleted
    assertAccount(await its.getAccount(), {
      kvs: [...baseItsKvs(deployer, computedTokenId)],
    });
  });
});

describe('Deploy remote interchain token', () => {
  test('ESDT with no minter', async () => {
    await deployAndMockTokenManagerInterchainToken(true);

    await user.callContract({
      callee: its,
      funcName: 'deployRemoteInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    assertAccount(await its.getAccount(), {
      balance: 100_000_000n,
      hasKvs: [
        ...baseItsKvs(deployer),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs.Mapper('CB_CLOSURE................................').Value(
          e.Tuple(
            e.Str('deploy_remote_token_callback'),
            e.U32(6),
            e.Buffer(computeInterchainTokenDeploySalt(user)),
            e.Str(OTHER_CHAIN_NAME),
            e.Str(TOKEN_IDENTIFIER.split('-')[0]),
            e.Buffer(''), // minter
            e.U(100_000_000n),
            e.Buffer(user.toTopU8A())
          )
        ),
      ],
    });
  });

  test('EGLD with no minter', async () => {
    const { computedTokenId } = await deployAndMockTokenManagerLockUnlock('EGLD');

    await user.callContract({
      callee: its,
      funcName: 'deployRemoteInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    assertAccount(await its.getAccount(), {
      balance: 0,
      kvs: [...baseItsKvs(deployer, computedTokenId, TOKEN_MANAGER_ADDRESS_3)],
    });

    // Assert gas was paid for cross chain call
    const gasServiceKvs = await gasService.getAccount();
    assertAccount(gasServiceKvs, {
      balance: 100_000_000n,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });

  test('Errors', async () => {
    await deployContracts(deployer, collector);

    // No token manager
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainToken',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
      })
      .assertFail({ code: 4, message: 'Token manager does not exist' });

    await deployAndMockTokenManagerLockUnlock();

    const { baseTokenManagerKvs } = await deployAndMockTokenManagerInterchainToken(true);

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      kvs: [...baseTokenManagerKvs, e.kvs.Mapper('token_identifier').Value(e.Str(''))],
    });

    // No token identifier
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainToken',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
      })
      .assertFail({ code: 4, message: 'Invalid token identifier' });

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      kvs: [...baseTokenManagerKvs, e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_IDENTIFIER))],
    });

    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainToken',
        gasLimit: 20_000_000,
        value: 100_000,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('Unknown')],
      })
      .assertFail({ code: 4, message: 'Untrusted chain' });
  });
});

describe('Deploy remote interchain token with minter', () => {
  test('With no destination minter but with minter', async () => {
    const { computedTokenId } = await deployAndMockTokenManagerInterchainToken(true, user);

    await user.callContract({
      callee: its,
      funcName: 'deployRemoteInterchainTokenWithMinter',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Option(user), e.Str(OTHER_CHAIN_NAME)],
    });

    assertAccount(await its.getAccount(), {
      balance: 100_000_000n,
      hasKvs: [
        ...baseItsKvs(deployer, computedTokenId, TOKEN_MANAGER_ADDRESS_3),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs.Mapper('CB_CLOSURE................................').Value(
          e.Tuple(
            e.Str('deploy_remote_token_callback'),
            e.U32(6),
            e.Buffer(computeInterchainTokenDeploySalt(user)),
            e.Str(OTHER_CHAIN_NAME),
            e.Str(TOKEN_IDENTIFIER.split('-')[0]),
            e.Buffer(''), // destination minter
            e.U(100_000_000n),
            e.Buffer(user.toTopU8A())
          )
        ),
      ],
    });
  });

  test('With destination minter', async () => {
    await deployAndMockTokenManagerInterchainToken(true, deployer);

    // Destination minter not approved
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Option(deployer), // minter
          e.Str(OTHER_CHAIN_NAME),
          e.TopBuffer(OTHER_CHAIN_ADDRESS.slice(2)),
        ],
      })
      .assertFail({ code: 4, message: 'Remote deployment not approved' });

    // Approve destination minter
    await deployer.callContract({
      callee: its,
      funcName: 'approveDeployRemoteInterchainToken',
      gasLimit: 150_000_000,
      funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME), e.Buffer(OTHER_CHAIN_ADDRESS.slice(2))],
    });

    // Wrong destination minter
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Option(deployer), // minter
          e.Str(OTHER_CHAIN_NAME),
          e.TopBuffer('AABB'),
        ],
      })
      .assertFail({ code: 4, message: 'Remote deployment not approved' });

    await user.callContract({
      callee: its,
      funcName: 'deployRemoteInterchainTokenWithMinter',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Option(deployer), // minter
        e.Str(OTHER_CHAIN_NAME),
        e.TopBuffer(OTHER_CHAIN_ADDRESS.slice(2)),
      ],
    });

    assertAccount(await its.getAccount(), {
      balance: 100_000_000n,
      hasKvs: [
        ...baseItsKvs(deployer),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs.Mapper('CB_CLOSURE................................').Value(
          e.Tuple(
            e.Str('deploy_remote_token_callback'),
            e.U32(6),
            e.Buffer(computeInterchainTokenDeploySalt(user)),
            e.Str(OTHER_CHAIN_NAME),
            e.Str(TOKEN_IDENTIFIER.split('-')[0]),
            e.Buffer(OTHER_CHAIN_ADDRESS.slice(2)), // destination minter
            e.U(100_000_000n),
            e.Buffer(user.toTopU8A())
          )
        ),
      ],
    });
  });

  test('Errors', async () => {
    await deployContracts(deployer, collector);

    // No token manager
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Option(null), // minter
          e.Str(OTHER_CHAIN_NAME),
        ],
      })
      .assertFail({ code: 4, message: 'Token manager does not exist' });

    await deployAndMockTokenManagerLockUnlock();

    // Lock unlock token manager doesn't have any minter
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Option(user), // minter
          e.Str(OTHER_CHAIN_NAME),
        ],
      })
      .assertFail({ code: 4, message: 'Not minter' });

    const { baseTokenManagerKvs } = await deployAndMockTokenManagerInterchainToken(true);

    // Wrong minter
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Option(user), // minter
          e.Str(OTHER_CHAIN_NAME),
        ],
      })
      .assertFail({ code: 4, message: 'Not minter' });

    // ITS can not be the minter
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Option(its), // minter
          e.Str(OTHER_CHAIN_NAME),
        ],
      })
      .assertFail({ code: 4, message: 'Invalid minter' });

    // Can not specify destination minter if minter is zero address
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Option(null), e.Str(OTHER_CHAIN_NAME), e.TopBuffer('AABB')],
      })
      .assertFail({ code: 4, message: 'Invalid minter' });

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      kvs: [...baseTokenManagerKvs, e.kvs.Mapper('token_identifier').Value(e.Str(''))],
    });

    // No token identifier
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Option(null), // minter
          e.Str(OTHER_CHAIN_NAME),
        ],
      })
      .assertFail({ code: 4, message: 'Invalid token identifier' });
  });
});

describe('Register canonical interchain token', () => {
  test('Register', async () => {
    await deployContracts(deployer, collector);

    const result = await user.callContract({
      callee: its,
      funcName: 'registerCanonicalInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [e.Str(TOKEN_IDENTIFIER)],
    });

    const salt = computeCanonicalInterchainTokenDeploySalt();
    const computedTokenId = computeInterchainTokenIdRaw(salt);

    assert(result.returnData[0] === computedTokenId);

    const kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [...baseItsKvs(deployer, computedTokenId)],
    });

    const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_IDENTIFIER)),
        e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000110)), // flow limit and operator roles
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit and operator roles
      ],
    });

    // Assert correct token manager type
    const query = await world.query({
      callee: tokenManager,
      funcName: 'implementationType',
      funcArgs: [],
    });

    assert(query.returnData[0] == '02'); // lock/unlock type
  });

  test('Errors', async () => {
    await deployContracts(deployer, collector);

    await user
      .callContract({
        callee: its,
        funcName: 'registerCanonicalInterchainToken',
        gasLimit: 20_000_000,
        funcArgs: [e.Str('NOTTOKEN')],
      })
      .assertFail({ code: 4, message: 'Invalid token identifier' });

    await user.callContract({
      callee: its,
      funcName: 'registerCanonicalInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [e.Str(TOKEN_IDENTIFIER)],
    });

    // Can not register same canonical token twice
    await otherUser
      .callContract({
        callee: its,
        funcName: 'registerCanonicalInterchainToken',
        gasLimit: 20_000_000,
        funcArgs: [e.Str(TOKEN_IDENTIFIER)],
      })
      .assertFail({ code: 4, message: 'Token manager already exists' });
  });
});

describe('Deploy remote canonical interchain token', () => {
  test('ESDT token', async () => {
    await deployAndMockTokenManagerLockUnlock(TOKEN_IDENTIFIER, CANONICAL_INTERCHAIN_TOKEN_ID);

    await user.callContract({
      callee: its,
      funcName: 'deployRemoteCanonicalInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.Str(TOKEN_IDENTIFIER), e.Str(OTHER_CHAIN_NAME)],
    });

    assertAccount(await its.getAccount(), {
      balance: 100_000_000n,
      hasKvs: [
        ...baseItsKvs(deployer),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs.Mapper('CB_CLOSURE................................').Value(
          e.Tuple(
            e.Str('deploy_remote_token_callback'),
            e.U32(6),
            e.Buffer(computeCanonicalInterchainTokenDeploySalt()),
            e.Str(OTHER_CHAIN_NAME),
            e.Str(TOKEN_IDENTIFIER.split('-')[0]),
            e.Buffer(''), // empty minter
            e.U(100_000_000n),
            e.Buffer(user.toTopU8A())
          )
        ),
      ],
    });
  });

  test('EGLD token', async () => {
    const { computedTokenId } = await deployAndMockTokenManagerLockUnlock('EGLD', CANONICAL_INTERCHAIN_TOKEN_ID);

    await user.callContract({
      callee: its,
      funcName: 'deployRemoteCanonicalInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.Str('EGLD'), e.Str(OTHER_CHAIN_NAME)],
    });

    assertAccount(await its.getAccount(), {
      balance: 0,
      kvs: [...baseItsKvs(deployer, computedTokenId, TOKEN_MANAGER_ADDRESS_3)],
    });
    // Assert gas was paid for cross chain call
    assertAccount(await gasService.getAccount(), {
      balance: 100_000_000n,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });

  test('Errors', async () => {
    await deployContracts(deployer, collector);

    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteCanonicalInterchainToken',
        gasLimit: 20_000_000,
        funcArgs: [e.Str('NOTTOKEN'), e.Str(OTHER_CHAIN_NAME)],
      })
      .assertFail({ code: 4, message: 'Invalid token identifier' });

    // No token manager
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteCanonicalInterchainToken',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.Str(TOKEN_IDENTIFIER), e.Str(OTHER_CHAIN_NAME)],
      })
      .assertFail({ code: 4, message: 'Token manager does not exist' });

    const { baseTokenManagerKvs } = await deployAndMockTokenManagerLockUnlock(TOKEN_IDENTIFIER, CANONICAL_INTERCHAIN_TOKEN_ID);

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      kvs: [...baseTokenManagerKvs, e.kvs.Mapper('token_identifier').Value(e.Str(''))],
    });

    // No token identifier
    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteCanonicalInterchainToken',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.Str(TOKEN_IDENTIFIER), e.Str(OTHER_CHAIN_NAME)],
      })
      .assertFail({ code: 4, message: 'Invalid token identifier' });

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      kvs: [...baseTokenManagerKvs, e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_IDENTIFIER))],
    });

    await user
      .callContract({
        callee: its,
        funcName: 'deployRemoteCanonicalInterchainToken',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.Str(TOKEN_IDENTIFIER), e.Str('Unknown')],
      })
      .assertFail({ code: 4, message: 'Untrusted chain' });
  });
});

describe('Register custom token', () => {
  test('Register custom token', async () => {
    await deployContracts(deployer, collector);

    let result = await user.callContract({
      callee: its,
      funcName: 'registerCustomToken',
      gasLimit: 100_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(TOKEN_IDENTIFIER),
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), // Lock/unlock
        user,
      ],
    });

    const computedTokenId = computeLinkedTokenId(user);

    assert(result.returnData[0] === computedTokenId);

    let kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer),

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
        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_IDENTIFIER)),
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
      funcArgs: [e.TopBuffer(TOKEN_SALT2), e.Str(TOKEN_IDENTIFIER), e.U8(TOKEN_MANAGER_TYPE_MINT_BURN), user],
    });

    kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(result.returnData[0])).Value(e.Addr(TOKEN_MANAGER_ADDRESS_2)),
      ],
    });
  });

  test('Register custom token egld', async () => {
    await deployContracts(deployer, collector);

    let result = await user.callContract({
      callee: its,
      funcName: 'registerCustomToken',
      gasLimit: 100_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str('EGLD'),
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), // Lock/unlock
        user,
      ],
    });

    const computedTokenId = computeLinkedTokenId(user);

    assert(result.returnData[0] === computedTokenId);

    let kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer),

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
        e.kvs.Mapper('token_identifier').Value(e.Str('EGLD')),
      ],
    });

    // Assert correct token manager type
    const query = await world.query({
      callee: tokenManager,
      funcName: 'implementationType',
      funcArgs: [],
    });

    assert(query.returnData[0] == '02'); // lock/unlock type
  });

  test('Errors', async () => {
    await deployContracts(deployer, collector);

    await user
      .callContract({
        callee: its,
        funcName: 'registerCustomToken',
        gasLimit: 100_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(''),
          e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), // Lock/unlock
          e.Addr(ADDRESS_ZERO),
        ],
      })
      .assertFail({ code: 4, message: 'Invalid token identifier' });

    // Can not deploy type interchain token
    await user
      .callContract({
        callee: its,
        funcName: 'registerCustomToken',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(TOKEN_IDENTIFIER),
          e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN),
          e.Addr(ADDRESS_ZERO),
        ],
      })
      .assertFail({ code: 4, message: 'Can not deploy native interchain token' });

    await user.callContract({
      callee: its,
      funcName: 'registerCustomToken',
      gasLimit: 100_000_000,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(TOKEN_IDENTIFIER), e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), e.Addr(ADDRESS_ZERO)],
    });

    // Can not deploy same token with same salt
    await user
      .callContract({
        callee: its,
        funcName: 'registerCustomToken',
        gasLimit: 100_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(TOKEN_IDENTIFIER),
          e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
          e.Addr(ADDRESS_ZERO),
        ],
      })
      .assertFail({ code: 4, message: 'Token manager already exists' });
  });
});

describe('Link token', () => {
  test('Link', async () => {
    await deployContracts(deployer, collector);

    const userTokenId = computeLinkedTokenId(user);
    const otherUserTokenId = computeLinkedTokenId(otherUser);

    // Mock token manager exists on source chain
    await deployTokenManagerLockUnlock(deployer, its);
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(userTokenId)).Value(tokenManager),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(otherUserTokenId)).Value(tokenManager),
      ],
    });

    let result = await user.callContract({
      callee: its,
      funcName: 'linkToken',
      gasLimit: 50_000_000,
      value: 100_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.Buffer(AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2)),
      ],
    });

    assert(result.returnData[0] === userTokenId);

    // Nothing changes for its keys
    let kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(userTokenId)).Value(tokenManager),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(otherUserTokenId)).Value(tokenManager),
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
      gasLimit: 50_000_000,
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
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(userTokenId)).Value(tokenManager),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(otherUserTokenId)).Value(tokenManager),
      ],
    });

    // Assert gas was paid for another cross chain call
    kvs = await gasService.getAccount();
    assertAccount(kvs, {
      balance: 150_000,
      kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
    });
  });

  test('Link egld', async () => {
    await deployContracts(deployer, collector);

    const userTokenId = computeLinkedTokenId(user);

    // Mock token manager exists on source chain
    await deployTokenManagerLockUnlock(deployer, its, deployer, 'EGLD');
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(userTokenId)).Value(tokenManager),
      ],
    });

    let result = await user.callContract({
      callee: its,
      funcName: 'linkToken',
      gasLimit: 50_000_000,
      value: 100_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.Buffer(AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2)),
      ],
    });

    assert(result.returnData[0] === userTokenId);

    // Nothing changes for its keys
    let kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(userTokenId)).Value(tokenManager),
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

  test('Errors', async () => {
    await deployContracts(deployer, collector);

    // Empty token address
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
        ...baseItsKvs(deployer),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeLinkedTokenId(user))).Value(tokenManager),
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
