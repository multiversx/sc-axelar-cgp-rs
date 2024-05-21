import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import {
  INTERCHAIN_TOKEN_ID,
  MESSAGE_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
} from '../helpers';
import { Buffer } from 'buffer';
import {
  baseGatewayKvs,
  baseItsKvs,
  computeExpressExecuteHash,
  deployContracts,
  gateway,
  interchainTokenFactory,
  its,
  itsDeployTokenManagerLockUnlock,
  itsDeployTokenManagerMintBurn,
  MESSAGE_TYPE_INTERCHAIN_TRANSFER,
  mockGatewayMessageApproved,
} from '../itsHelpers';
import { AbiCoder } from 'ethers';

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
    timestamp: 0,
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

const mockGatewayCall = async (interchainTokenId: string, payload: string | null = null) => {
  if (!payload) {
    payload = AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
      [
        MESSAGE_TYPE_INTERCHAIN_TRANSFER,
        Buffer.from(interchainTokenId, 'hex'),
        Buffer.from(OTHER_CHAIN_ADDRESS),
        Buffer.from(otherUser.toTopBytes()),
        1_000,
        Buffer.from(''),
      ],
    ).substring(2);
  }

  const { commandId, messageHash } = await mockGatewayMessageApproved(payload, deployer);

  return { payload, commandId, messageHash };
};

test('Transfer mint burn', async () => {
  const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerMintBurn(world, user);

  const { payload, commandId } = await mockGatewayCall(computedTokenId);

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  // Tokens should be minted for otherUser
  const otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    balance: BigInt('10000000000000000'),
    kvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  // Nothing changed for token manager
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: baseTokenManagerKvs,
  });

  // Gateway message was marked as executed
  assertAccount(await gateway.getAccountWithKvs(), {
    kvs: [
      ...baseGatewayKvs(deployer),

      e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.Str("1")),
    ],
  });
});

test('Transfer lock unlock', async () => {
  const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(
    world,
    user,
    true,
  );

  const { payload, commandId } = await mockGatewayCall(computedTokenId);

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  // Tokens should be transfered to otherUser
  const otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    balance: BigInt('10000000000000000'),
    kvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  // Token manager transfered tokens
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      ...baseTokenManagerKvs,

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 99_000 }]),
    ],
  });

  // Gateway message was marked as executed
  assertAccount(await gateway.getAccountWithKvs(), {
    kvs: [
      ...baseGatewayKvs(deployer),

      e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.Str("1")),
    ],
  });
});

test('Flow limit', async () => {
  const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerMintBurn(
    world,
    user,
    1_000,
  );

  let { payload } = await mockGatewayCall(computedTokenId);

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  let tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      ...baseTokenManagerKvs,

      e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(1_000)),
    ],
  });

  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600 - 1,
  });

  // Can not call again because flow limit for this epoch (6 hours) was exceeded
  ({ payload } = await mockGatewayCall(computedTokenId));

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

  // After the required time has passed, tokens can flow again
  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600,
  });

  ({ payload } = await mockGatewayCall(computedTokenId));

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      ...baseTokenManagerKvs,

      e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(1_000)),
      e.kvs.Mapper('flow_in_amount', e.U64(1)).Value(e.U(1_000)),
    ],
  });
});

test('Express executor', async () => {
  const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerMintBurn(
    world,
    user,
  );

  const { payload, commandId } = await mockGatewayCall(computedTokenId);

  const expressExecuteHash = computeExpressExecuteHash(payload);

  // Mock user as express executor
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),

      e.kvs.Mapper('express_execute', e.TopBuffer(expressExecuteHash)).Value(user),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 25_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  // Tokens should be minted for user (express executor)
  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('10000000000000000'),
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

  // Gateway message was marked as executed
  assertAccount(await gateway.getAccountWithKvs(), {
    kvs: [
      ...baseGatewayKvs(deployer),

      e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.Str("1")),
    ],
  });

  // Assert express receive token slot was deleted
  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
    ],
  });

  // Nothing changed for token manager
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      ...baseTokenManagerKvs,
    ],
  });
});

test('Errors', async () => {
  let payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256'],
    [
      MESSAGE_TYPE_INTERCHAIN_TRANSFER,
    ],
  ).substring(2);

  // Invalid other address from other chain
  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str('SomeOtherAddress'),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Not remote service' });

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Not approved by gateway' });

  payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256'],
    [
      4, // message type unknown
    ],
  ).substring(2);

  const { payload: newPayload } = await mockGatewayCall(INTERCHAIN_TOKEN_ID, payload);

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      newPayload,
    ],
  }).assertFail({ code: 4, message: 'Invalid message type' });
});
