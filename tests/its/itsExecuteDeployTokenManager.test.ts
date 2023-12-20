import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import createKeccakHash from 'keccak';
import {
  CHAIN_ID,
  COMMAND_ID,
  INTERCHAIN_TOKEN_ID,
  MOCK_CONTRACT_ADDRESS_1,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_ID_MANAGER_ADDRESS,
} from '../helpers';
import { Buffer } from 'buffer';
import {
  baseItsKvs,
  deployContracts,
  gateway,
  interchainTokenFactory,
  its,
  itsDeployTokenManagerLockUnlock,
  MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER,
} from '../itsHelpers';
import { AbiCoder } from 'ethers';

let world: SWorld;
let deployer: SWallet;
let collector: SWallet;
let user: SWallet;

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

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  await world.terminate();
});

const mockGatewayCall = async (tokenId = INTERCHAIN_TOKEN_ID) => {
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'uint8', 'bytes'],
    [
      MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER,
      Buffer.from(tokenId, 'hex'),
      0, // Mint/Burn
      Buffer.from(
        e.Tuple(
          e.Option(its),
          e.Option(e.Str(TOKEN_ID)),
        ).toTopBytes(),
      ),
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

test('Execute', async () => {
  const payload = await mockGatewayCall();

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

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, INTERCHAIN_TOKEN_ID),
    ],
  });

  const tokenManager = world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit and operator roles
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

  const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(
    world,
    user,
  );

  payload = await mockGatewayCall(computedTokenId);

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
  }).assertFail({ code: 4, message: 'Token manager already exists' });
});
