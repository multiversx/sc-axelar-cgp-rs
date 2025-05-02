import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, LSWallet, LSWorld } from 'xsuite';
import { MESSAGE_ID, OTHER_CHAIN_ADDRESS, OTHER_CHAIN_NAME, TOKEN_IDENTIFIER, TOKEN_IDENTIFIER2 } from '../helpers';
import { Buffer } from 'buffer';
import {
  baseGatewayKvs,
  baseItsKvs,
  deployContracts,
  deployPingPongInterchain,
  gateway,
  its,
  ITS_HUB_ADDRESS,
  ITS_HUB_CHAIN,
  itsRegisterCanonicalToken,
  MESSAGE_TYPE_INTERCHAIN_TRANSFER,
  mockGatewayMessageApproved,
  pingPong,
  wrapFromItsHubPayload,
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
    timestamp: 0,
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
  otherUser = await world.createWallet({
    balance: BigInt('10000000000000000'),
  });

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  await world.terminate();
});

const mockGatewayCall = async (tokenId: string, fnc = 'ping') => {
  const originalPayload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      MESSAGE_TYPE_INTERCHAIN_TRANSFER,
      Buffer.from(tokenId, 'hex'),
      Buffer.from(OTHER_CHAIN_ADDRESS),
      Buffer.from(pingPong.toTopU8A()),
      1_000,
      Buffer.from(e.Tuple(e.Str(fnc), otherUser).toTopU8A()), // data passed to contract
    ]
  );

  const payload = wrapFromItsHubPayload(originalPayload);

  const { crossChainId, messageHash } = await mockGatewayMessageApproved(payload, deployer);

  return { payload, crossChainId, messageHash };
};

test('Transfer with data', async () => {
  await deployPingPongInterchain(deployer);

  const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsRegisterCanonicalToken(
    world,
    user,
    true,
    'EGLD'
  );

  const { payload, crossChainId } = await mockGatewayCall(computedTokenId);

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 100_000_000,
    funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
  });

  await user
    .callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 100_000_000,
      funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    })
    .assertFail({ code: 4, message: 'Not approved by gateway' });

  // Assert no tokens left in its contract & lock removed
  const kvs = await its.getAccount();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [...baseItsKvs(deployer, computedTokenId)],
  });

  // Assert ping pong was successfully called with tokens
  const pingPongKvs = await pingPong.getAccount();
  assertAccount(pingPongKvs, {
    balance: 1_000,
    kvs: [
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
  const tokenManagerKvs = await tokenManager.getAccount();
  assertAccount(tokenManagerKvs, {
    balance: 99_000,
    kvs: [...baseTokenManagerKvs],
  });

  // Gateway message was marked as executed
  assertAccount(await gateway.getAccount(), {
    kvs: [...baseGatewayKvs(deployer), e.kvs.Mapper('messages', crossChainId).Value(e.Str('1'))],
  });
});

test('Transfer with data contract error', async () => {
  await deployPingPongInterchain(deployer);

  const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsRegisterCanonicalToken(
    world,
    user,
    true,
    'EGLD'
  );

  const { payload, crossChainId, messageHash } = await mockGatewayCall(computedTokenId, 'wrong');

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 300_000_000,
    funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

  // Assert its doesn't have balance
  assertAccount(await its.getAccount(), {
    balance: 0n,
    kvs: [...baseItsKvs(deployer, computedTokenId)],
  });
  // Assert ping pong was NOT called
  assertAccount(await pingPong.getAccount(), {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
      e.kvs.Mapper('deadline').Value(e.U64(10)),
      e.kvs.Mapper('activationTimestamp').Value(e.U64(0)),
      e.kvs.Mapper('maxFunds').Value(e.Option(null)),
    ],
  });
  // Assert token manager still has tokens
  assertAccount(await tokenManager.getAccount(), {
    balance: 100_000,
    kvs: [...baseTokenManagerKvs],
  });

  // Gateway message was NOT marked as executed
  assertAccount(await gateway.getAccount(), {
    kvs: [...baseGatewayKvs(deployer), e.kvs.Mapper('messages', crossChainId).Value(messageHash)],
  });
});

test('Errors', async () => {
  const payload = AbiCoder.defaultAbiCoder().encode(['uint256'], [MESSAGE_TYPE_INTERCHAIN_TRANSFER]).substring(2);

  // Invalid other address from other chain
  await user
    .callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 20_000_000,
      funcArgs: [e.Str(OTHER_CHAIN_NAME), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    })
    .assertFail({ code: 4, message: 'Not its hub' });
});
