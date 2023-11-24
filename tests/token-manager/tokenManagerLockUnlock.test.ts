import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import createKeccakHash from 'keccak';
import {
  ADDRESS_ZERO,
  INTERCHAIN_TOKEN_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
} from '../helpers';
import {
  baseItsKvs,
  deployContracts,
  deployTokenManagerLockUnlock,
  interchainTokenFactory,
  its,
  tokenManagerLockUnlock,
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

const deployTokenManager = async (itsAddr: SWallet | null = null, mock: boolean = true) => {
  await deployContracts(deployer, otherUser);

  // Re-deploy contract with correct code
  await deployTokenManagerLockUnlock(deployer, itsAddr || its);

  if (mock) {
    // Mock token manager being known by ITS
    await its.setAccount({
      ...(await its.getAccountWithKvs()),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.Bytes(INTERCHAIN_TOKEN_ID)).Value(tokenManagerLockUnlock),
      ],
    });
  }
};

test('Init errors', async () => {
  const mockTokenId = createKeccakHash('keccak256').update('mockTokenId').digest('hex');

  await deployer.deployContract({
    code: 'file:token-manager-lock-unlock/output/token-manager-lock-unlock.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
      e.Bytes(mockTokenId),
      e.Option(deployer),
      e.Option(null),
    ],
  }).assertFail({ code: 4, message: 'Invalid token address' });

  await deployer.deployContract({
    code: 'file:token-manager-lock-unlock/output/token-manager-lock-unlock.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(ADDRESS_ZERO), // zero address
      e.Bytes(mockTokenId),
      e.Option(deployer),
      e.Option(e.Str(TOKEN_ID)),
    ],
  }).assertFail({ code: 4, message: 'Zero address' });
});

test('Init different arguments', async () => {
  const { contract } = await deployer.deployContract({
    code: 'file:token-manager-lock-unlock/output/token-manager-lock-unlock.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      otherUser,
      e.Bytes(INTERCHAIN_TOKEN_ID),
      e.Option(null),
      e.Option(e.Str(TOKEN_ID)),
    ],
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
    code: 'file:token-manager-lock-unlock/output/token-manager-lock-unlock.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      otherUser,
      e.Bytes(INTERCHAIN_TOKEN_ID),
      e.Option(deployer),
      e.Option(e.Str(TOKEN_ID)),
    ],
  });

  kvs = await contract2.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(otherUser),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)), // flow limiter & operator roles for operator
      e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000100)), // flow limiter role for its
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });
});

test('Interchain transfer', async () => {
  await deployTokenManager();

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'interchainTransfer',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Str('sth'), // Will not be taken into account by ITS contract
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens remain in contract
  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...
});

test('Interchain transfer with data', async () => {
  await deployTokenManager();

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'interchainTransfer',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Tuple(e.U32(0), e.Str('sth')), // Specify custom metadata to send to ITS
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens remain in contract
  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...
});

test('Interchain transfer errors', async () => {
  await deployTokenManager(null, false);

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'interchainTransfer',
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
    callee: tokenManagerLockUnlock,
    funcName: 'interchainTransfer',
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

      e.kvs.Mapper('token_manager_address', e.Bytes(INTERCHAIN_TOKEN_ID)).Value(tokenManagerLockUnlock),
    ],
  });

  // Wrong metadata version
  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'interchainTransfer',
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
    callee: tokenManagerLockUnlock,
    funcName: 'setFlowLimit',
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'interchainTransfer',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });
});

test('Call contract with interchain token', async () => {
  await deployTokenManager();

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'callContractWithInterchainToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Str('sth'), // Will be taken into account by ITS
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens remain in contract
  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000110)),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...
});

test('Call contract with interchain token errors', async () => {
  await deployTokenManager(null, false);

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'callContractWithInterchainToken',
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
    callee: tokenManagerLockUnlock,
    funcName: 'callContractWithInterchainToken',
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

      e.kvs.Mapper('token_manager_address', e.Bytes(INTERCHAIN_TOKEN_ID)).Value(tokenManagerLockUnlock),
    ],
  });

  // Test flow limit exceeded
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'setFlowLimit',
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'callContractWithInterchainToken',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });
});

test('Give token', async () => {
  const baseKvs = await deployTokenManagerLockUnlock(deployer, user);

  // Ensure token manager has tokens
  await user.transfer({
    receiver: tokenManagerLockUnlock,
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    gasLimit: 5_000_000,
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'giveToken',
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  });

  // Tokens were sent from contract to otherUser
  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
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

test('Give token flow limit', async () => {
  const baseKvs = await deployTokenManagerLockUnlock(deployer, user);

  // Ensure token manager has tokens
  await user.transfer({
    receiver: tokenManagerLockUnlock,
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    gasLimit: 5_000_000,
  });

  // Set flow limit
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'setFlowLimit',
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(500),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'giveToken',
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(500),
    ],
  });

  // Tokens were sent from contract to otherUser
  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
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
    callee: tokenManagerLockUnlock,
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
    callee: tokenManagerLockUnlock,
    funcName: 'giveToken',
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(500),
    ],
  });

  kvs = await tokenManagerLockUnlock.getAccountWithKvs();
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

test('Give token errors', async () => {
  await deployTokenManagerLockUnlock(deployer, user);

  await otherUser.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'giveToken',
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Not service' });

  // Test flow limit exceeded
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'setFlowLimit',
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'giveToken',
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });

  // Contract has no funds to send
  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'giveToken',
    gasLimit: 20_000_000,
    funcArgs: [
      otherUser,
      e.U(999),
    ],
  }).assertFail({ code: 10, message: 'insufficient funds' });
});

test('Take token', async () => {
  const baseKvs = await deployTokenManagerLockUnlock(deployer, user);

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'takeToken',
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Tokens remain in contract
  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });
});

test('Take token flow limit', async () => {
  const baseKvs = await deployTokenManagerLockUnlock(deployer, user);

  // Set flow limit
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'setFlowLimit',
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(500),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'takeToken',
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 500 }],
  });

  // Tokens remain in contract
  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
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
    callee: tokenManagerLockUnlock,
    funcName: 'takeToken',
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 500 }],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });

  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600,
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'takeToken',
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 500 }],
  });

  kvs = await tokenManagerLockUnlock.getAccountWithKvs();
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

test('Take token errors', async () => {
  await deployTokenManagerLockUnlock(deployer, user);

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'takeToken',
    gasLimit: 20_000_000,
    funcArgs: [],
    value: 1_000,
  }).assertFail({ code: 4, message: 'Not service' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'takeToken',
    gasLimit: 20_000_000,
    funcArgs: [],
    value: 1_000,
  }).assertFail({ code: 4, message: 'Wrong token sent' });

  // Test flow limit exceeded
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'setFlowLimit',
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(999),
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'takeToken',
    gasLimit: 20_000_000,
    funcArgs: [],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 4, message: 'Flow limit exceeded' });
});

test('Transfer operatorship', async () => {
  const baseKvs = await deployTokenManagerLockUnlock(deployer, user, user);

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'transferOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'transferOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
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
    callee: tokenManagerLockUnlock,
    funcName: 'transferOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });
});

test('Propose operatorship', async () => {
  const baseKvs = await deployTokenManagerLockUnlock(deployer, user, user);

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'proposeOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'proposeOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000010)),
    ],
  });

  // Proposed operator can not call this function
  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'proposeOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  // If called multiple times, multiple entries are added
  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'proposeOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  });

  kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000010)),
      e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000010)),
    ],
  });
});

test('Accept operatorship', async () => {
  const baseKvs = await deployTokenManagerLockUnlock(deployer, user, user);

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'acceptOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      user,
    ],
  }).assertFail({ code: 4, message: 'Invalid proposed roles' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'proposeOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  // Propose other
  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'proposeOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      otherUser,
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'acceptOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      user,
    ],
  }).assertFail({ code: 4, message: 'Invalid proposed roles' });

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'acceptOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      user,
    ],
  });

  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
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
    callee: tokenManagerLockUnlock,
    funcName: 'acceptOperatorship',
    gasLimit: 5_000_000,
    funcArgs: [
      user,
    ],
  }).assertFail({ code: 4, message: 'Missing all roles' });
});

test('Add flow limiter', async () => {
  const baseKvs = await deployTokenManagerLockUnlock(deployer, user, user);

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'addFlowLimiter',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'addFlowLimiter',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
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
    callee: tokenManagerLockUnlock,
    funcName: 'removeFlowLimiter',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'addFlowLimiter',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'removeFlowLimiter',
    gasLimit: 5_000_000,
    funcArgs: [
      user,
    ],
  });

  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000010)), // operator role remained
      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'removeFlowLimiter',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  kvs = await tokenManagerLockUnlock.getAccountWithKvs();
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
    callee: tokenManagerLockUnlock,
    funcName: 'setFlowLimit',
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(100),
    ],
  }).assertFail({ code: 4, message: 'Missing any of roles' });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'addFlowLimiter',
    gasLimit: 5_000_000,
    funcArgs: [
      deployer,
    ],
  });

  await user.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'setFlowLimit',
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(100),
    ],
  });

  let kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role

      e.kvs.Mapper('flow_limit').Value(e.U(100)),
    ],
  });

  await deployer.callContract({
    callee: tokenManagerLockUnlock,
    funcName: 'setFlowLimit',
    gasLimit: 5_000_000,
    funcArgs: [
      e.U(200),
    ],
  });

  kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseKvs,

      e.kvs.Mapper('account_roles', deployer).Value(e.U32(0b00000100)), // flow limit role

      e.kvs.Mapper('flow_limit').Value(e.U(200)),
    ],
  });
});
