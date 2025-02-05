import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, LSWallet, LSWorld } from 'xsuite';
import {
  ADDRESS_ZERO,
  CANONICAL_INTERCHAIN_TOKEN_ID,
  CHAIN_NAME,
  CHAIN_NAME_HASH,
  getKeccak256Hash,
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
  computeCanonicalInterchainTokenDeploySalt,
  computeInterchainTokenId,
  computeInterchainTokenDeploySalt,
  deployContracts,
  deployInterchainTokenFactory,
  deployIts,
  deployTokenManagerInterchainToken,
  deployTokenManagerLockUnlock,
  gasService,
  interchainTokenFactory,
  its,
  TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN,
  TOKEN_MANAGER_TYPE_LOCK_UNLOCK,
  tokenManager,
  TOKEN_MANAGER_TYPE_MINT_BURN,
  computeLinkedTokenDeploySalt,
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
});

afterEach(async () => {
  await world.terminate();
});

const deployAndMockTokenManagerInterchainToken = async (burnRole: boolean = false, minter: LSWallet = null) => {
  await deployContracts(deployer, collector);

  let baseTokenManagerKvs;
  if (!burnRole) {
    baseTokenManagerKvs = await deployTokenManagerInterchainToken(deployer, its);
  } else {
    baseTokenManagerKvs = await deployTokenManagerInterchainToken(
      deployer,
      interchainTokenFactory,
      its,
      TOKEN_ID,
      true,
      minter || interchainTokenFactory
    );
  }

  const deploySalt = computeInterchainTokenDeploySalt(user);
  const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), deploySalt);

  // Mock token manager already deployed as not being canonical so contract deployment is not tried again
  await its.setAccount({
    ...(await its.getAccount()),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
    ],
  });

  return { baseTokenManagerKvs, computedTokenId };
};

const deployAndMockTokenManagerLockUnlock = async (
  tokenId: string = TOKEN_ID,
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

  const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), deploySalt);

  // Mock token manager already deployed as not being canonical so contract deployment is not tried again
  await its.setAccount({
    ...(await its.getAccount()),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
    ],
  });
  return { baseTokenManagerKvs, computedTokenId };
};

test(
  'Init & upgrade',
  async () => {
    await deployContracts(deployer, collector, false);
    await deployIts(deployer);

    await deployer
      .deployContract({
        code: 'file:interchain-token-factory/output/interchain-token-factory.wasm',
        codeMetadata: ['upgradeable'],
        gasLimit: 100_000_000,
        codeArgs: [e.Addr(ADDRESS_ZERO)],
      })
      .assertFail({ code: 4, message: 'Zero address' });

    await deployer
      .deployContract({
        code: 'file:interchain-token-factory/output/interchain-token-factory.wasm',
        codeMetadata: ['upgradeable'],
        gasLimit: 100_000_000,
        codeArgs: [deployer],
      })
      .assertFail({ code: 4, message: 'Not a smart contract address' });

    await deployInterchainTokenFactory(deployer, false);

    await deployer
      .upgradeContract({
        callee: interchainTokenFactory,
        code: 'file:interchain-token-factory/output/interchain-token-factory.wasm',
        codeMetadata: ['upgradeable'],
        gasLimit: 100_000_000,
        codeArgs: [deployer],
      })
      .assertFail({ code: 4, message: 'wrong number of arguments' });

    // On upgrade storage is not updated
    await deployer.upgradeContract({
      callee: interchainTokenFactory,
      code: 'file:interchain-token-factory/output/interchain-token-factory.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [],
    });

    const kvs = await interchainTokenFactory.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('chain_name_hash').Value(e.TopBuffer(CHAIN_NAME_HASH)),
      ],
    });
  },
  { timeout: 30_000 }
);

describe('Deploy interchain token', () => {
  test('Only deploy token manager minter mint', async () => {
    await deployContracts(deployer, collector);

    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployInterchainToken',
        gasLimit: 100_000_000,
        value: BigInt('50000000000000000'),
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str('Token Name'),
          e.Str('TOKEN-SYMBOL'),
          e.U8(18),
          e.U(1_000),
          user, // minter
        ],
      })
      .assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployInterchainToken',
      gasLimit: 100_000_000,
      value: 0,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18), e.U(1_000), user],
    });

    const salt = computeInterchainTokenDeploySalt(user);
    const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), salt);

    const kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [...baseItsKvs(deployer, interchainTokenFactory, computedTokenId)],
    });

    // Interchain token factory gets roles over token manager
    const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
        e.kvs.Mapper('account_roles', interchainTokenFactory).Value(e.U32(0b00000110)), // flow limit and operator roles
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),
      ],
    });
  });

  test('Only deploy token manager minter no mint', async () => {
    await deployContracts(deployer, collector);

    // ITS contract can not be the minter
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployInterchainToken',
        gasLimit: 100_000_000,
        value: 0,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18), e.U(0), its],
      })
      .assertFail({ code: 4, message: 'Invalid minter' });

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployInterchainToken',
      gasLimit: 100_000_000,
      value: 0,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18), e.U(0), user],
    });

    const salt = computeInterchainTokenDeploySalt(user);
    const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), salt);

    const kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [...baseItsKvs(deployer, interchainTokenFactory, computedTokenId)],
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
        callee: interchainTokenFactory,
        funcName: 'deployInterchainToken',
        gasLimit: 100_000_000,
        value: 0,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str('Token Name'),
          e.Str('TOKEN-SYMBOL'),
          e.U8(18),
          e.U(0),
          e.Addr(ADDRESS_ZERO),
        ],
      })
      .assertFail({ code: 4, message: 'Zero supply token' });
  });

  test('Only issue esdt minter mint', async () => {
    const { baseTokenManagerKvs, computedTokenId } = await deployAndMockTokenManagerInterchainToken();

    // Insufficient funds for issuing ESDT
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        value: 0,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18), e.U(1_000), user],
      })
      .assertFail({ code: 10, message: 'execution failed' });

    // Insufficient funds for issuing ESDT
    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      value: BigInt('50000000000000000'),
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18), e.U(1_000), user],
    });

    assertAccount(await its.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(tokenManager),
      ],
    });
    assertAccount(await tokenManager.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseTokenManagerKvs,

        e.kvs.Mapper('account_roles', interchainTokenFactory).Value(e.U32(0b00000001)), // minter role
        e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limiter & operator roles

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

  test('Only issue esdt minter no mint', async () => {
    const { baseTokenManagerKvs, computedTokenId } = await deployAndMockTokenManagerInterchainToken();

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      value: BigInt('50000000000000000'),
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
        e.U(0),
        user, // minter
      ],
    });

    assertAccount(await its.getAccount(), {
      balance: 0n,
      hasKvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

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
          .Value(e.Tuple(e.Str('deploy_token_callback'), e.TopBuffer('00000000'))),
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
        callee: interchainTokenFactory,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        value: BigInt('50000000000000000'),
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18), e.U(1_000), user],
      })
      .assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18), e.U(1_000), user],
    });

    // Assert user got all roles
    let kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseTokenManagerKvs,

        e.kvs.Mapper('account_roles', interchainTokenFactory).Value(e.U32(0b00000000)), // roles removed
        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000111)), // all roles
      ],
    });

    // Assert tokens were minted
    kvs = await user.getAccount();
    assertAccount(kvs, {
      balance: BigInt('100000000000000000'),
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_ID,
            amount: 101_000,
          },
          {
            id: TOKEN_ID2,
            amount: 10_000,
          },
        ]),
      ],
    });
  });

  test('Only mint no minter', async () => {
    const { baseTokenManagerKvs } = await deployAndMockTokenManagerInterchainToken(true);

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
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

        e.kvs.Mapper('account_roles', interchainTokenFactory).Value(e.U32(0b00000000)), // roles removed
        e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000111)), // operator & flow limiter & minter role
      ],
    });

    // Assert tokens were minted
    kvs = await user.getAccount();
    assertAccount(kvs, {
      balance: BigInt('100000000000000000'),
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_ID,
            amount: 101_000,
          },
          {
            id: TOKEN_ID2,
            amount: 10_000,
          },
        ]),
      ],
    });
  });
});

describe('Approvals deploy remote interchain token', () => {
  test('Approve deploy remote interchain token', async () => {
    await deployAndMockTokenManagerInterchainToken(true, deployer);

    // Token manager not found
    await user
      .callContract({
        callee: interchainTokenFactory,
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
        callee: interchainTokenFactory,
        funcName: 'approveDeployRemoteInterchainToken',
        gasLimit: 150_000_000,
        funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME), e.Buffer(OTHER_CHAIN_ADDRESS.slice(2))],
      })
      .assertFail({ code: 4, message: 'Not minter' });

    await deployer
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'approveDeployRemoteInterchainToken',
        gasLimit: 150_000_000,
        funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str('unknown'), e.Buffer(OTHER_CHAIN_ADDRESS.slice(2))],
      })
      .assertFail({ code: 4, message: 'Invalid chain name' });

    await deployer.callContract({
      callee: interchainTokenFactory,
      funcName: 'approveDeployRemoteInterchainToken',
      gasLimit: 150_000_000,
      funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME), e.Buffer(OTHER_CHAIN_ADDRESS.slice(2))],
    });

    const deploySalt = computeInterchainTokenDeploySalt(user);
    const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), deploySalt);

    const approvalKey = getKeccak256Hash(
      Buffer.concat([
        Buffer.from(getKeccak256Hash('deploy-approval'), 'hex'),
        e.Tuple(deployer, e.TopBuffer(computedTokenId), e.Str(OTHER_CHAIN_NAME)).toNestU8A(),
      ])
    );
    const destinationMinterHash = getKeccak256Hash(Buffer.from(OTHER_CHAIN_ADDRESS.slice(2), 'hex'));

    assertAccount(await interchainTokenFactory.getAccount(), {
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),

        e.kvs
          .Mapper('approved_destination_minters', e.TopBuffer(approvalKey))
          .Value(e.TopBuffer(destinationMinterHash)),
      ],
    });
  });

  test('Revoke deploy remote interchain token', async () => {
    await deployAndMockTokenManagerInterchainToken(true, deployer);

    const deploySalt = computeInterchainTokenDeploySalt(user);

    const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), deploySalt);

    const approvalKey = getKeccak256Hash(
      Buffer.concat([
        Buffer.from(getKeccak256Hash('deploy-approval'), 'hex'),
        e.Tuple(deployer, e.TopBuffer(computedTokenId), e.Str(OTHER_CHAIN_NAME)).toNestU8A(),
      ])
    );
    const destinationMinterHash = getKeccak256Hash(Buffer.from(OTHER_CHAIN_ADDRESS.slice(2), 'hex'));

    // Mock approval
    await interchainTokenFactory.setAccount({
      ...(await interchainTokenFactory.getAccount()),
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),

        e.kvs
          .Mapper('approved_destination_minters', e.TopBuffer(approvalKey))
          .Value(e.TopBuffer(destinationMinterHash)),
      ],
    });

    // Nothing will happen since it is not the correct minter
    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'revokeDeployRemoteInterchainToken',
      gasLimit: 150_000_000,
      funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    await deployer.callContract({
      callee: interchainTokenFactory,
      funcName: 'revokeDeployRemoteInterchainToken',
      gasLimit: 150_000_000,
      funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    // Approval was deleted
    assertAccount(await interchainTokenFactory.getAccount(), {
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),
      ],
    });
  });
});

describe('Deploy remote interchain token', () => {
  test('ESDT with no minter', async () => {
    await deployAndMockTokenManagerInterchainToken(true);

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployRemoteInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    assertAccount(await interchainTokenFactory.getAccount(), {
      balance: 100_000_000n,
      hasKvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('chain_name_hash').Value(e.TopBuffer(CHAIN_NAME_HASH)),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs.Mapper('CB_CLOSURE................................').Value(
          e.Tuple(
            e.Str('deploy_remote_token_callback'),
            e.U32(6),
            e.Buffer(computeInterchainTokenDeploySalt(user)),
            e.Str(OTHER_CHAIN_NAME),
            e.Str(TOKEN_ID.split('-')[0]),
            e.Buffer(''), // minter
            e.U(100_000_000n),
            e.Buffer(user.toTopU8A())
          )
        ),
      ],
    });
  });

  test('EGLD with no minter', async () => {
    await deployAndMockTokenManagerLockUnlock('EGLD');

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployRemoteInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    assertAccount(await interchainTokenFactory.getAccount(), {
      balance: 0,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),
      ],
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
        callee: interchainTokenFactory,
        funcName: 'deployRemoteInterchainToken',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
      })
      .assertFail({ code: 10, message: 'error signalled by smartcontract' });

    await deployAndMockTokenManagerLockUnlock();

    const { baseTokenManagerKvs } = await deployAndMockTokenManagerInterchainToken(true);

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      kvs: [...baseTokenManagerKvs, e.kvs.Mapper('token_identifier').Value(e.Str(''))],
    });

    // No token identifier
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployRemoteInterchainToken',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
      })
      .assertFail({ code: 4, message: 'panic occurred' });
  });
});

describe('Deploy remote interchain token with minter', () => {
  test('With destination minter same as minter', async () => {
    await deployAndMockTokenManagerInterchainToken(true);

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployRemoteInterchainTokenWithMinter',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        interchainTokenFactory, // minter
        e.Str(OTHER_CHAIN_NAME),
      ],
    });

    assertAccount(await interchainTokenFactory.getAccount(), {
      balance: 100_000_000n,
      hasKvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs.Mapper('CB_CLOSURE................................').Value(
          e.Tuple(
            e.Str('deploy_remote_token_callback'),
            e.U32(6),
            e.Buffer(computeInterchainTokenDeploySalt(user)),
            e.Str(OTHER_CHAIN_NAME),
            e.Str(TOKEN_ID.split('-')[0]),
            e.Buffer(interchainTokenFactory.toTopU8A()), // destination minter
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
        callee: interchainTokenFactory,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          deployer, // minter
          e.Str(OTHER_CHAIN_NAME),
          e.TopBuffer(OTHER_CHAIN_ADDRESS.slice(2)),
        ],
      })
      .assertFail({ code: 4, message: 'Remote deployment not approved' });

    // Approve destination minter
    await deployer.callContract({
      callee: interchainTokenFactory,
      funcName: 'approveDeployRemoteInterchainToken',
      gasLimit: 150_000_000,
      funcArgs: [user, e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME), e.Buffer(OTHER_CHAIN_ADDRESS.slice(2))],
    });

    // Wrong destination minter
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          deployer, // minter
          e.Str(OTHER_CHAIN_NAME),
          e.TopBuffer('AABB'),
        ],
      })
      .assertFail({ code: 4, message: 'Remote deployment not approved' });

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployRemoteInterchainTokenWithMinter',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        deployer, // minter
        e.Str(OTHER_CHAIN_NAME),
        e.TopBuffer(OTHER_CHAIN_ADDRESS.slice(2)),
      ],
    });

    assertAccount(await interchainTokenFactory.getAccount(), {
      balance: 100_000_000n,
      hasKvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs.Mapper('CB_CLOSURE................................').Value(
          e.Tuple(
            e.Str('deploy_remote_token_callback'),
            e.U32(6),
            e.Buffer(computeInterchainTokenDeploySalt(user)),
            e.Str(OTHER_CHAIN_NAME),
            e.Str(TOKEN_ID.split('-')[0]),
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
        callee: interchainTokenFactory,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Addr(ADDRESS_ZERO), // minter
          e.Str(OTHER_CHAIN_NAME),
        ],
      })
      .assertFail({ code: 10, message: 'error signalled by smartcontract' });

    await deployAndMockTokenManagerLockUnlock();

    // Lock unlock token manager doesn't have any minter
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          user, // minter
          e.Str(OTHER_CHAIN_NAME),
        ],
      })
      .assertFail({ code: 4, message: 'Not minter' });

    const { baseTokenManagerKvs } = await deployAndMockTokenManagerInterchainToken(true);

    // Wrong minter
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          user, // minter
          e.Str(OTHER_CHAIN_NAME),
        ],
      })
      .assertFail({ code: 4, message: 'Not minter' });

    // ITS can not be the minter
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          its, // minter
          e.Str(OTHER_CHAIN_NAME),
        ],
      })
      .assertFail({ code: 4, message: 'Invalid minter' });

    // Can not specify destination minter if minter is zero address
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.TopBuffer(TOKEN_SALT), e.Addr(ADDRESS_ZERO), e.Str(OTHER_CHAIN_NAME), e.TopBuffer('AABB')],
      })
      .assertFail({ code: 4, message: 'Invalid minter' });

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      kvs: [...baseTokenManagerKvs, e.kvs.Mapper('token_identifier').Value(e.Str(''))],
    });

    // No token identifier
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployRemoteInterchainTokenWithMinter',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Addr(ADDRESS_ZERO), // minter
          e.Str(OTHER_CHAIN_NAME),
        ],
      })
      .assertFail({ code: 4, message: 'panic occurred' });
  });
});

describe('Register canonical interchain token', () => {
  test('Register', async () => {
    await deployContracts(deployer, collector);

    const result = await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'registerCanonicalInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [e.Str(TOKEN_ID)],
    });

    const salt = computeCanonicalInterchainTokenDeploySalt();
    const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), salt);

    assert(result.returnData[0] === computedTokenId);

    const kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [...baseItsKvs(deployer, interchainTokenFactory, computedTokenId)],
    });

    const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
    const tokenManagerKvs = await tokenManager.getAccount();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
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
        callee: interchainTokenFactory,
        funcName: 'registerCanonicalInterchainToken',
        gasLimit: 20_000_000,
        funcArgs: [e.Str('NOTTOKEN')],
      })
      .assertFail({ code: 4, message: 'Invalid token identifier' });

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'registerCanonicalInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [e.Str(TOKEN_ID)],
    });

    // Can not register same canonical token twice
    await otherUser
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'registerCanonicalInterchainToken',
        gasLimit: 20_000_000,
        funcArgs: [e.Str(TOKEN_ID)],
      })
      .assertFail({ code: 10, message: 'error signalled by smartcontract' });
  });
});

describe('Deploy remote canonical interchain token', () => {
  test('ESDT token', async () => {
    await deployAndMockTokenManagerLockUnlock(TOKEN_ID, CANONICAL_INTERCHAIN_TOKEN_ID);

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployRemoteCanonicalInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.Str(TOKEN_ID), e.Str(OTHER_CHAIN_NAME)],
    });

    assertAccount(await interchainTokenFactory.getAccount(), {
      balance: 100_000_000n,
      hasKvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('chain_name_hash').Value(e.TopBuffer(CHAIN_NAME_HASH)),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs.Mapper('CB_CLOSURE................................').Value(
          e.Tuple(
            e.Str('deploy_remote_token_callback'),
            e.U32(6),
            e.Buffer(computeCanonicalInterchainTokenDeploySalt()),
            e.Str(OTHER_CHAIN_NAME),
            e.Str(TOKEN_ID.split('-')[0]),
            e.Buffer(''), // empty minter
            e.U(100_000_000n),
            e.Buffer(user.toTopU8A())
          )
        ),
      ],
    });
  });

  test('EGLD token', async () => {
    await deployAndMockTokenManagerLockUnlock('EGLD', CANONICAL_INTERCHAIN_TOKEN_ID);

    await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'deployRemoteCanonicalInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.Str('EGLD'), e.Str(OTHER_CHAIN_NAME)],
    });

    assertAccount(await interchainTokenFactory.getAccount(), {
      balance: 0,
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(its),
        e.kvs.Mapper('chain_name_hash').Value(e.TopBuffer(CHAIN_NAME_HASH)),
      ],
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
        callee: interchainTokenFactory,
        funcName: 'deployRemoteCanonicalInterchainToken',
        gasLimit: 20_000_000,
        funcArgs: [e.Str('NOTTOKEN'), e.Str(OTHER_CHAIN_NAME)],
      })
      .assertFail({ code: 4, message: 'Invalid token identifier' });

    // No token manager
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployRemoteCanonicalInterchainToken',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.Str(TOKEN_ID), e.Str(OTHER_CHAIN_NAME)],
      })
      .assertFail({ code: 10, message: 'error signalled by smartcontract' });

    const { baseTokenManagerKvs } = await deployAndMockTokenManagerLockUnlock(TOKEN_ID, CANONICAL_INTERCHAIN_TOKEN_ID);

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      kvs: [...baseTokenManagerKvs, e.kvs.Mapper('token_identifier').Value('')],
    });

    // No token identifier
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'deployRemoteCanonicalInterchainToken',
        gasLimit: 150_000_000,
        value: 100_000_000n,
        funcArgs: [e.Str(TOKEN_ID), e.Str(OTHER_CHAIN_NAME)],
      })
      .assertFail({ code: 4, message: 'panic occurred' });
  });
});

describe('Register custom token', () => {
  test('Register custom token', async () => {
    await deployContracts(deployer, collector);

    let result = await user.callContract({
      callee: interchainTokenFactory,
      funcName: 'registerCustomToken',
      gasLimit: 100_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(TOKEN_ID),
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK), // Lock/unlock
        user,
      ],
    });

    const salt = computeLinkedTokenDeploySalt(user);
    const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), salt);

    assert(result.returnData[0] === computedTokenId);

    let kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

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
        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
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
      callee: interchainTokenFactory,
      funcName: 'registerCustomToken',
      gasLimit: 100_000_000,
      funcArgs: [e.TopBuffer(TOKEN_SALT2), e.Str(TOKEN_ID), e.U8(TOKEN_MANAGER_TYPE_MINT_BURN), user],
    });

    kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(result.returnData[0])).Value(e.Addr(TOKEN_MANAGER_ADDRESS_2)),
      ],
    });
  });

  test('Errors', async () => {
    await deployContracts(deployer, collector);

    // Can only be called by interchain token factory
    await user
      .callContract({
        callee: interchainTokenFactory,
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

    // Can not deploy type interchain token, error coming from ITS contract
    await user
      .callContract({
        callee: interchainTokenFactory,
        funcName: 'registerCustomToken',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer(TOKEN_SALT),
          e.Str(TOKEN_ID),
          e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN),
          e.Addr(ADDRESS_ZERO),
        ],
      })
      .assertFail({ code: 10, message: 'error signalled by smartcontract' });
  });
});

describe('Link token', () => {
  test('Link', async () => {
    await deployContracts(deployer, collector);

    const userTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), computeLinkedTokenDeploySalt(user));
    const otherUserTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), computeLinkedTokenDeploySalt(otherUser));

    // Mock token manager exists on source chain
    await deployTokenManagerLockUnlock(deployer, its);
    await its.setAccount({
      ...(await its.getAccount()),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(userTokenId)).Value(tokenManager),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(otherUserTokenId)).Value(tokenManager),
      ],
    });

    let result = await user.callContract({
      callee: interchainTokenFactory,
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
        ...baseItsKvs(deployer, interchainTokenFactory),

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
      callee: interchainTokenFactory,
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
        ...baseItsKvs(deployer, interchainTokenFactory),

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

  test('Errors', async () => {
    await deployContracts(deployer, collector);

    // Empty token address, error from ITS
    await user
      .callContract({
        callee: interchainTokenFactory,
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
      .assertFail({ code: 10, message: 'error signalled by smartcontract' });
  });
});
