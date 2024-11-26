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
  deployTokenManagerInterchainToken,
  gateway,
  interchainTokenFactory,
  its,
  MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
  mockGatewayMessageApproved,
  tokenManager,
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

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  await world.terminate();
});

const mockGatewayCall = async (tokenId = INTERCHAIN_TOKEN_ID) => {
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'],
    [
      MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
      Buffer.from(tokenId, 'hex'),
      'TokenName',
      'SYMBOL',
      18,
      Buffer.from(user.toTopU8A()), // minter
    ],
  ).substring(2);

  const { crossChainId, messageHash } = await mockGatewayMessageApproved(payload, deployer);

  return { payload, crossChainId, messageHash };
};

test('Only deploy token manager', async () => {
  const { payload, crossChainId, messageHash } = await mockGatewayCall();

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 100_000_000,
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
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limit & operator roles
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit & operator role
    ],
  });

  // Gateway message approved key was NOT removed
  assertAccount(await gateway.getAccountWithKvs(), {
    kvs: [
      ...baseGatewayKvs(deployer),

      e.kvs.Mapper('messages', crossChainId).Value(messageHash),
    ],
  });
});

test('Only issue esdt', async () => {
  const baseTokenManagerKvs = await deployTokenManagerInterchainToken(deployer, its);

  // Mock token manager already deployed
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.TopBuffer(INTERCHAIN_TOKEN_ID)).Value(tokenManager),
    ],
  });

  const { payload, crossChainId } = await mockGatewayCall();

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 600_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  // Nothing was changed for its
  assertAccount(await its.getAccountWithKvs(), {
    balance: 0n,
    hasKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.TopBuffer(INTERCHAIN_TOKEN_ID)).Value(tokenManager),
    ],
  });
  assertAccount(await tokenManager.getAccountWithKvs(), {
    balance: 0,
    hasKvs: [
      ...baseTokenManagerKvs,

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000001)), // minter role was added to user & its
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000111)),

      // ESDT token deployment was tested on Devnet and it works fine
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_token_callback'),
        e.TopBuffer('00000000'),
      )),
    ],
  });
  assertAccount(await user.getAccountWithKvs(), {
    balance: BigInt('50000000000000000'), // balance was changed
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
      MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
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

  payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'],
    [
      MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
      Buffer.from(INTERCHAIN_TOKEN_ID, 'hex'),
      'TokenName',
      'SYMBOL',
      18,
      Buffer.from(user.toTopU8A()),
    ],
  ).substring(2);

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 100_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

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

  // Mock token manager already deployed, test that gateway is check in this case also
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.TopBuffer(INTERCHAIN_TOKEN_ID)).Value(e.Addr(TOKEN_MANAGER_ADDRESS)),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 20_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Not approved by gateway' });
});
