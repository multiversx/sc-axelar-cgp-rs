import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import {
  INTERCHAIN_TOKEN_ID,
  MESSAGE_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_MANAGER_ADDRESS,
} from '../helpers';
import { Buffer } from 'buffer';
import {
  baseGatewayKvs,
  baseItsKvs,
  deployContracts,
  gateway,
  interchainTokenFactory,
  its,
  itsDeployTokenManagerLockUnlock,
  MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER,
  mockGatewayMessageApproved, TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN,
  TOKEN_MANAGER_TYPE_MINT_BURN,
} from '../itsHelpers';
import { AbiCoder } from 'ethers';

let world: SWorld;
let deployer: SWallet;
let collector: SWallet;
let user: SWallet;

beforeEach(async () => {
  world = await SWorld.start();
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

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  await world.terminate();
});

const mockGatewayCall = async (tokenId = INTERCHAIN_TOKEN_ID, type = TOKEN_MANAGER_TYPE_MINT_BURN) => {
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'uint8', 'bytes'],
    [
      MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER,
      Buffer.from(tokenId, 'hex'),
      type,
      Buffer.from(
        e.Tuple(
          e.Option(its),
          e.Option(e.Str(TOKEN_ID)),
        ).toTopU8A(),
      ),
    ],
  ).substring(2);

  const { crossChainId, messageHash } = await mockGatewayMessageApproved(payload, deployer);

  return { payload, crossChainId, messageHash };
};

test('Execute', async () => {
  const { payload, crossChainId } = await mockGatewayCall();

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 50_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, INTERCHAIN_TOKEN_ID),
    ],
  });

  const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_MINT_BURN)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit and operator roles
    ],
  });

  // Gateway message was marked as executed
  assertAccount(await gateway.getAccountWithKvs(), {
    kvs: [
      ...baseGatewayKvs(deployer),

      e.kvs.Mapper('messages', crossChainId).Value(e.Str('1')),
    ],
  });
});

test('Errors', async () => {
  let payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256'],
    [
      MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER,
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

  const { computedTokenId } = await itsDeployTokenManagerLockUnlock(
    world,
    user,
  );

  ({ payload } = await mockGatewayCall(computedTokenId, TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN));

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 50_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Can not deploy' });

  ({ payload } = await mockGatewayCall(computedTokenId));

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 50_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Token manager already exists' });
});
