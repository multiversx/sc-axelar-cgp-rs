import { afterEach, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import createKeccakHash from 'keccak';
import { ADDRESS_ZERO, INTERCHAIN_TOKEN_ID, TOKEN_ID, TOKEN_ID2 } from '../helpers';
import {
  deployTokenManagerLockUnlock,
  deployTokenManagerMintBurn,
  TOKEN_MANAGER_TYPE_LOCK_UNLOCK,
  TOKEN_MANAGER_TYPE_MINT_BURN,
  tokenManager,
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
  });

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
        },
      ]),
    ],
  });
  otherUser = await world.createWallet();
});

afterEach(async () => {
  await world.terminate();
});

describe('Init', () => {
  test('Errors lock unlock', async () => {
    const mockTokenId = createKeccakHash('keccak256').update('mockTokenId').digest('hex');

    await deployer.deployContract({
      code: 'file:token-manager/output/token-manager.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        e.Addr(ADDRESS_ZERO),
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
        e.TopBuffer(mockTokenId),
        e.Tuple(
          e.Option(deployer),
          e.Option(e.Str(TOKEN_ID)),
        ),
      ],
    }).assertFail({ code: 4, message: 'Zero address' });

    await deployer.deployContract({
      code: 'file:token-manager/output/token-manager.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        deployer,
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
        e.TopBuffer(mockTokenId),
        e.Tuple(
          e.Option(deployer),
          e.Option(null),
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid token address' });
  });

  test('Errors mint burn', async () => {
    const mockTokenId = createKeccakHash('keccak256').update('mockTokenId').digest('hex');

    await deployer.deployContract({
      code: 'file:token-manager/output/token-manager.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        e.Addr(ADDRESS_ZERO),
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.TopBuffer(mockTokenId),
        e.Tuple(
          e.Option(deployer),
          e.Option(e.Str(TOKEN_ID)),
        ),
      ],
    }).assertFail({ code: 4, message: 'Zero address' });

    await deployer.deployContract({
      code: 'file:token-manager/output/token-manager.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        deployer,
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.TopBuffer(mockTokenId),
        e.Tuple(
          e.Option(deployer),
          e.Option(e.Str('EGLD')),
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid token address' });
  });

  test('Different arguments lock unlock', async () => {
    const { contract } = await deployer.deployContract({
      code: 'file:token-manager/output/token-manager.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        otherUser,
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Tuple(
          e.Option(null),
          e.Option(e.Str(TOKEN_ID)),
        ),
      ],
    });

    let kvs = await contract.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        e.kvs.Mapper('interchain_token_service').Value(otherUser),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
        e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000110)), // flow limiter & operator roles for its & zero address
        e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000110)),
        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      ],
    });

    const { contract: contract2 } = await deployer.deployContract({
      code: 'file:token-manager/output/token-manager.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        otherUser,
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Tuple(
          e.Option(deployer),
          e.Option(e.Str(TOKEN_ID)),
        ),
      ],
    });

    kvs = await contract2.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        e.kvs.Mapper('interchain_token_service').Value(otherUser),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
        e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)), // flow limiter & operator roles for operator & its
        e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000110)),
        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      ],
    });
  });

  test('Different arguments mint burn', async () => {
    const { contract } = await deployer.deployContract({
      code: 'file:token-manager/output/token-manager.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        otherUser,
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Tuple(
          e.Option(null),
          e.Option(e.Str(TOKEN_ID)),
        ),
      ],
    });

    let kvs = await contract.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        e.kvs.Mapper('interchain_token_service').Value(otherUser),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_MINT_BURN)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
        e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000110)), // flow limiter & operator roles for its & zero address
        e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000110)),
        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      ],
    });

    const { contract: contract2 } = await deployer.deployContract({
      code: 'file:token-manager/output/token-manager.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        otherUser,
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Tuple(
          e.Option(deployer),
          e.Option(null),
        ),
      ],
    });

    kvs = await contract2.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        e.kvs.Mapper('interchain_token_service').Value(otherUser),
        e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_MINT_BURN)),
        e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
        e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)), // flow limiter & operator roles for its & zero address
        e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000110)),
      ],
    });
  });
});

describe('Flow limit', () => {
  test('Add flow limiter', async () => {
    const baseKvs = await deployTokenManagerLockUnlock(deployer, user, user);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'addFlowLimiter',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'addFlowLimiter',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    });

    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role
      ],
    });
  });

  test('Remove flow limiter', async () => {
    const baseKvs = await deployTokenManagerLockUnlock(deployer, user, user);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'removeFlowLimiter',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'addFlowLimiter',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'removeFlowLimiter',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    });

    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000010)), // operator role remained
        e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'removeFlowLimiter',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    });

    kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000000)), // flow limit role was removed
        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000010)), // operator role remained
      ],
    });
  });

  test('Set flow limit', async () => {
    const baseKvs = await deployTokenManagerLockUnlock(deployer, user, user);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(100),
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'addFlowLimiter',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(100),
      ],
    });

    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role

        e.kvs.Mapper('flow_limit').Value(e.U(100)),
      ],
    });

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(200),
      ],
    });

    kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role

        e.kvs.Mapper('flow_limit').Value(e.U(200)),
      ],
    });
  });
});

describe('Give token lock unlock', () => {
  test('Normal', async () => {
    const baseKvs = await deployTokenManagerLockUnlock(deployer, user);

    // Ensure token manager has tokens
    await user.transfer({
      receiver: tokenManager,
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
      gasLimit: 5_000_000,
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'giveToken',
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(1_000),
      ],
    });

    // Tokens were sent from contract to otherUser
    const kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

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

  test('With flow limit', async () => {
    const baseKvs = await deployTokenManagerLockUnlock(deployer, user);

    // Ensure token manager has tokens
    await user.transfer({
      receiver: tokenManager,
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
      gasLimit: 5_000_000,
    });

    // Set flow limit
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(500),
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'giveToken',
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(500),
      ],
    });

    // Tokens were sent from contract to otherUser
    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

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
      callee: tokenManager,
      funcName: 'giveToken',
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
      callee: tokenManager,
      funcName: 'giveToken',
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(500),
      ],
    });

    kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

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

  test('Errors', async () => {
    await deployTokenManagerLockUnlock(deployer, user);

    await otherUser.callContract({
      callee: tokenManager,
      funcName: 'giveToken',
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(1_000),
      ],
    }).assertFail({ code: 4, message: 'Not service' });

    // Test flow limit exceeded
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(999),
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'giveToken',
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(1_000),
      ],
    }).assertFail({ code: 4, message: 'Flow limit exceeded' });

    // Contract has no funds to send
    await user.callContract({
      callee: tokenManager,
      funcName: 'giveToken',
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(999),
      ],
    }).assertFail({ code: 10, message: 'insufficient funds' });
  });
});

describe('Take token lock unlock', () => {
  test('Normal', async () => {
    const baseKvs = await deployTokenManagerLockUnlock(deployer, user);

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    });

    // Tokens remain in contract
    const kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
      ],
    });
  });

  test('With flow limit', async () => {
    const baseKvs = await deployTokenManagerLockUnlock(deployer, user);

    // Set flow limit
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(500),
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 500 }],
    });

    // Tokens remain in contract
    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('flow_limit').Value(e.U(500)),
        e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 500 }]),
      ],
    });

    await world.setCurrentBlockInfo({
      timestamp: 6 * 3600 - 1,
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 500 }],
    }).assertFail({ code: 4, message: 'Flow limit exceeded' });

    await world.setCurrentBlockInfo({
      timestamp: 6 * 3600,
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 500 }],
    });

    kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('flow_limit').Value(e.U(500)),
        e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),
        e.kvs.Mapper('flow_out_amount', e.U64(1)).Value(e.U(500)),

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
      ],
    });
  });

  test('Errors', async () => {
    await deployTokenManagerLockUnlock(deployer, user);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      value: 1_000,
    }).assertFail({ code: 4, message: 'Not service' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      value: 1_000,
    }).assertFail({ code: 4, message: 'Wrong token sent' });

    // Test flow limit exceeded
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(999),
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    }).assertFail({ code: 4, message: 'Flow limit exceeded' });
  });
});

describe('Operatorship', () => {
  test('Transfer', async () => {
    const baseKvs = await deployTokenManagerLockUnlock(deployer, user, user);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'transferOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'transferOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    });

    let kvs = await tokenManager.getAccountWithKvs();
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
      callee: tokenManager,
      funcName: 'transferOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    });
  });

  test('Propose', async () => {
    const baseKvs = await deployTokenManagerLockUnlock(deployer, user, user);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'proposeOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    });

    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000010)),
      ],
    });

    // Proposed operator can not call this function
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'proposeOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    // If called multiple times, multiple entries are added
    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        otherUser,
      ],
    });

    kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000010)),
        e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000010)),
      ],
    });
  });

  test('Accept', async () => {
    const baseKvs = await deployTokenManagerLockUnlock(deployer, user, user);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'acceptOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    }).assertFail({ code: 4, message: 'Invalid proposed roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    });

    // Propose other
    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        otherUser,
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'acceptOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    }).assertFail({ code: 4, message: 'Invalid proposed roles' });

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'acceptOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    });

    let kvs = await tokenManager.getAccountWithKvs();
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
      callee: tokenManager,
      funcName: 'acceptOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    }).assertFail({ code: 4, message: 'Missing all roles' });
  });
});
