import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import {
  COMMAND_ID,
  MOCK_CONTRACT_ADDRESS_1,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_SALT,
} from '../helpers';
import { Buffer } from 'buffer';
import {
  baseItsKvs,
  computeExpressExecuteHash,
  computeInterchainTokenId,
  deployContracts,
  deployPingPongInterchain,
  gateway,
  interchainTokenFactory,
  its,
  itsDeployTokenManagerLockUnlock,
  MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
  MESSAGE_TYPE_INTERCHAIN_TRANSFER,
  MESSAGE_TYPE_INTERCHAIN_TRANSFER,
  pingPong,
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

test('Express execute', async () => {
  const { computedTokenId } = await itsDeployTokenManagerLockUnlock(world, user);

  // Remove '0x' from beginning of hex strings encoded by Ethereum
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      MESSAGE_TYPE_INTERCHAIN_TRANSFER,
      Buffer.from(computedTokenId, 'hex'),
      Buffer.from(OTHER_CHAIN_ADDRESS),
      Buffer.from(otherUser.toTopBytes()),
      100_000,
      Buffer.from(''),
    ],
  ).substring(2);

  await user.callContract({
    callee: its,
    funcName: 'expressExecute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
    esdts: [{ id: TOKEN_ID, amount: 100_000 }],
  });

  // Assert express execute with hash set
  const expressExecuteHash = computeExpressExecuteHash(payload);

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),

      e.kvs.Mapper('express_execute', e.TopBuffer(expressExecuteHash)).Value(user),
    ],
  });

  // Other user received the tokens
  const otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    balance: BigInt('10000000000000000'),
    allKvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 100_000 }]),
    ],
  });
});

test('Express execute with data', async () => {
  await deployPingPongInterchain(deployer);

  const computedTokenId = computeInterchainTokenId(user);

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
        e.Option(e.Str('EGLD')),
      ).toTopBytes()),
    ],
  });

  // Remove '0x' from beginning of hex strings encoded by Ethereum
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      MESSAGE_TYPE_INTERCHAIN_TRANSFER,
      Buffer.from(computedTokenId, 'hex'),
      Buffer.from(OTHER_CHAIN_ADDRESS),
      Buffer.from(pingPong.toTopBytes()),
      1_000,
      Buffer.from(e.Tuple(e.Str('ping'), otherUser).toTopBytes()), // data passed to contract
    ],
  ).substring(2);

  await user.callContract({
    callee: its,
    funcName: 'expressExecute',
    gasLimit: 30_000_000,
    value: 1_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  // Assert express execute with hash set
  const expressExecuteHash = computeExpressExecuteHash(payload);

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),

      e.kvs.Mapper('express_execute', e.TopBuffer(expressExecuteHash)).Value(user),
    ],
  });

  // Assert ping pong was successfully called
  const pingPongKvs = await pingPong.getAccountWithKvs();
  assertAccount(pingPongKvs, {
    balance: 1_000,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
      e.kvs.Mapper('deadline').Value(e.U64(10)),
      e.kvs.Mapper('activationTimestamp').Value(e.U64(0)),
      e.kvs.Mapper('maxFunds').Value(e.Option(null)),

      // User mapper
      e.kvs.Mapper('user_address_to_id', otherUser).Value(e.U32(1)),
      e.kvs.Mapper('user_id_to_address', e.U32(1)).Value(otherUser),
      e.kvs.Mapper('user_count').Value(e.U32(1)),

      e.kvs.Mapper('userStatus', e.U32(1)).Value(e.U8(1)),
    ],
  });
});

test('Express execute with data error', async () => {
  await deployPingPongInterchain(deployer);

  const computedTokenId = computeInterchainTokenId(user);

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
        e.Option(e.Str('EGLD')),
      ).toTopBytes()),
    ],
  });

  // Remove '0x' from beginning of hex strings encoded by Ethereum
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      MESSAGE_TYPE_INTERCHAIN_TRANSFER,
      Buffer.from(computedTokenId, 'hex'),
      Buffer.from(OTHER_CHAIN_ADDRESS),
      Buffer.from(pingPong.toTopBytes()),
      1_000,
      Buffer.from(e.Tuple(e.Str('wrong')).toTopBytes()), // wrong data passed to contract
    ],
  ).substring(2);

  await user.callContract({
    callee: its,
    funcName: 'expressExecute',
    gasLimit: 300_000_000,
    value: 1_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  // Assert express execute hash NOT set
  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    // balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
    ],
  });

  // Assert ping pong was NOT called
  const pingPongKvs = await pingPong.getAccountWithKvs();
  assertAccount(pingPongKvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
      e.kvs.Mapper('deadline').Value(e.U64(10)),
      e.kvs.Mapper('activationTimestamp').Value(e.U64(0)),
      e.kvs.Mapper('maxFunds').Value(e.Option(null)),
    ],
  });

  // Assert user still has initial balance
  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('10000000000000000'),
  });
});

test('Express execute errors', async () => {
  const computedTokenId = computeInterchainTokenId(user);

  let payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
      Buffer.from(computedTokenId, 'hex'),
      Buffer.from(OTHER_CHAIN_ADDRESS),
      Buffer.from(otherUser.toTopBytes()),
      100_000,
      Buffer.from(''),
    ],
  ).substring(2);

  await user.callContract({
    callee: its,
    funcName: 'expressExecute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
    esdts: [{ id: TOKEN_ID, amount: 100_000 }],
  }).assertFail({ code: 4, message: 'Invalid express message type' });

  payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      MESSAGE_TYPE_INTERCHAIN_TRANSFER,
      Buffer.from(computedTokenId, 'hex'),
      Buffer.from(OTHER_CHAIN_ADDRESS),
      Buffer.from(otherUser.toTopBytes()),
      100_000,
      Buffer.from(''),
    ],
  ).substring(2);

  await user.callContract({
    callee: its,
    funcName: 'expressExecute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Token manager does not exist' });

  // Deploy token manager for TOKEN_ID
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
        e.Option(e.Str(TOKEN_ID)),
      ).toTopBytes()),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: 'expressExecute',
    gasLimit: 20_000_000,
    value: 100_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Wrong token or amount sent' });

  await user.callContract({
    callee: its,
    funcName: 'expressExecute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
    esdts: [{ id: TOKEN_ID, amount: 99_999 }],
  }).assertFail({ code: 4, message: 'Wrong token or amount sent' });

  // Can not call twice for same call
  await user.callContract({
    callee: its,
    funcName: 'expressExecute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
    esdts: [{ id: TOKEN_ID, amount: 100_000 }],
  });

  await user.callContract({
    callee: its,
    funcName: 'expressExecute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Express executor already set' });

  // Mock command executed
  await gateway.setAccount({
    ...await gateway.getAccount(),
    codeMetadata: [],
    kvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),

      e.kvs.Mapper('command_executed', e.TopBuffer(COMMAND_ID)).Value(e.U8(1)),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: 'expressExecute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Already executed' });
});
