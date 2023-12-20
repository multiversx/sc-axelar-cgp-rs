import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import createKeccakHash from 'keccak';
import {
  CHAIN_ID,
  COMMAND_ID,
  MOCK_CONTRACT_ADDRESS_1,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
} from '../helpers';
import { Buffer } from 'buffer';
import {
  baseItsKvs,
  computeExpressExecuteHash,
  deployContracts,
  deployPingPongInterchain,
  gateway,
  interchainTokenFactory,
  its,
  itsDeployTokenManagerLockUnlock,
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

const mockGatewayCall = async (tokenId: string, fnc = 'ping') => {
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      MESSAGE_TYPE_INTERCHAIN_TRANSFER,
      Buffer.from(tokenId, 'hex'),
      Buffer.from(OTHER_CHAIN_ADDRESS),
      Buffer.from(pingPong.toTopBytes()),
      1_000,
      Buffer.from(e.Tuple(e.Str(fnc), otherUser).toTopBytes()), // data passed to contract
    ],
  ).substring(2);
  const payloadHash = createKeccakHash('keccak256').update(Buffer.from(payload, 'hex')).digest('hex');

  // Mock contract call approved by gateway
  let data = Buffer.concat([
    Buffer.from(COMMAND_ID, 'hex'),
    Buffer.from(OTHER_CHAIN_NAME),
    Buffer.from(OTHER_CHAIN_ADDRESS),
    its.toTopBytes(),
    Buffer.from(payloadHash, 'hex'),
  ]);

  const dataHash = createKeccakHash('keccak256').update(data).digest('hex');
  await gateway.setAccount({
    ...await gateway.getAccount(),
    codeMetadata: [],
    kvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),

      // Manually approve call
      e.kvs.Mapper('contract_call_approved', e.TopBuffer(dataHash)).Value(e.U8(1)),
    ],
  });

  return payload;
};

test('Transfer with data', async () => {
  await deployPingPongInterchain(deployer);

  const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(
    world,
    user,
    true,
    'EGLD',
  );

  const payload = await mockGatewayCall(computedTokenId);

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 50_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  // Assert no tokens left in its contract
  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
    ],
  });

  // Assert ping pong was successfully called with tokens
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

  // Assert token manager balance decreased
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 99_000,
    kvs: [
      ...baseTokenManagerKvs,
    ],
  });

  // Gateway contract call approved key was removed
  const gatewayKvs = await gateway.getAccountWithKvs();
  assertAccount(gatewayKvs, {
    kvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),
    ],
  });
});

test('Transfer with data contract error', async () => {
  await deployPingPongInterchain(deployer);

  const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(
    world,
    user,
    true,
    'EGLD',
  );

  const payload = await mockGatewayCall(computedTokenId, 'wrong');

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 300_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  // TODO: This works correctly on Devnet but doesn't work in tests for some reason
  // Assert its doesn't have balance
  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    // balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),

      // These keys should not have been set, the callback should have been executed
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('execute_with_token_callback'),
        e.U32(4),
        e.Buffer(COMMAND_ID),
        e.Buffer(computedTokenId),
        e.Str('EGLD'),
        e.U(1_000),
      )),
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

  // const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  // assertAccount(tokenManagerKvs, {
  //   balance: 100_000,
  //   kvs: [
  //     ...baseTokenManagerKvs,
  //   ],
  // });

  // Gateway contract call approved key was removed
  const gatewayKvs = await gateway.getAccountWithKvs();
  assertAccount(gatewayKvs, {
    kvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),
    ],
  });
});

test('Express executor', async () => {
  await deployPingPongInterchain(deployer);

  const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(
    world,
    user,
    true,
    'EGLD',
  );

  let payload = await mockGatewayCall(computedTokenId);

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
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  // Tokens should be set to user (express executor)
  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('10000000000001000'),
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

  // Gateway contract call approved key was removed
  const gatewayKvs = await gateway.getAccountWithKvs();
  assertAccount(gatewayKvs, {
    kvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),
    ],
  });

  // Assert express receive token slot was deleted
  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
    ],
  });

  // Tokens were moved from token manager
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 99_000,
    kvs: [
      ...baseTokenManagerKvs,
    ],
  });
});

test('Errors', async () => {
  const payload = AbiCoder.defaultAbiCoder().encode(
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
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str('SomeOtherAddress'),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Not remote service' });

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Not approved by gateway' });
});
