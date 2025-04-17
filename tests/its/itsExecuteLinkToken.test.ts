import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, LSWallet, LSWorld } from 'xsuite';
import {
  ADDRESS_ZERO,
  INTERCHAIN_TOKEN_ID,
  MESSAGE_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  OTHER_CHAIN_TOKEN_ADDRESS,
  TOKEN_IDENTIFIER,
  TOKEN_IDENTIFIER2,
  TOKEN_MANAGER_ADDRESS,
} from '../helpers';
import { Buffer } from 'buffer';
import {
  baseGatewayKvs,
  baseItsKvs,
  deployContracts,
  gateway,
  its,
  ITS_HUB_ADDRESS,
  ITS_HUB_CHAIN,
  itsRegisterCustomTokenLockUnlock,
  MESSAGE_TYPE_LINK_TOKEN,
  mockGatewayMessageApproved,
  TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN,
  TOKEN_MANAGER_TYPE_LOCK_UNLOCK,
  TOKEN_MANAGER_TYPE_MINT_BURN,
  wrapFromItsHubPayload,
} from '../itsHelpers';
import { AbiCoder } from 'ethers';

let world: LSWorld;
let deployer: LSWallet;
let collector: LSWallet;
let user: LSWallet;

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

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  await world.terminate();
});

const mockGatewayCall = async (
  tokenId = INTERCHAIN_TOKEN_ID,
  type = TOKEN_MANAGER_TYPE_MINT_BURN,
  operator = Buffer.from(''),
  tokenIdentifier = TOKEN_IDENTIFIER
) => {
  const originalPayload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'uint256', 'bytes', 'bytes', 'bytes'],
    [
      MESSAGE_TYPE_LINK_TOKEN,
      Buffer.from(tokenId, 'hex'),
      type,
      Buffer.from(OTHER_CHAIN_TOKEN_ADDRESS),
      Buffer.from(tokenIdentifier), // message comes from other chain, so the destination token address is set to a valid ESDT identifier
      operator,
    ]
  );

  const payload = wrapFromItsHubPayload(originalPayload);

  const { crossChainId, messageHash } = await mockGatewayMessageApproved(payload, deployer);

  return { payload, crossChainId, messageHash };
};

test('Execute no operator', async () => {
  const { payload, crossChainId } = await mockGatewayCall();

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 50_000_000,
    funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
  });

  const kvs = await its.getAccount();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [...baseItsKvs(deployer, INTERCHAIN_TOKEN_ID)],
  });

  const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccount();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_MINT_BURN)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_IDENTIFIER)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000110)), // flow limit and operator roles
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),
    ],
  });

  // Gateway message was marked as executed
  assertAccount(await gateway.getAccount(), {
    kvs: [...baseGatewayKvs(deployer), e.kvs.Mapper('messages', crossChainId).Value(e.Str('1'))],
  });
});

test('Execute with operator', async () => {
  const { payload, crossChainId } = await mockGatewayCall(
    INTERCHAIN_TOKEN_ID,
    TOKEN_MANAGER_TYPE_MINT_BURN,
    Buffer.from(user.toTopU8A())
  );

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 50_000_000,
    funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
  });

  const kvs = await its.getAccount();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [...baseItsKvs(deployer, INTERCHAIN_TOKEN_ID)],
  });

  const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccount();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_MINT_BURN)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_IDENTIFIER)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limit and operator roles
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),
    ],
  });

  // Gateway message was marked as executed
  assertAccount(await gateway.getAccount(), {
    kvs: [...baseGatewayKvs(deployer), e.kvs.Mapper('messages', crossChainId).Value(e.Str('1'))],
  });
});

test('Execute egld', async () => {
  const { payload, crossChainId } = await mockGatewayCall(
    INTERCHAIN_TOKEN_ID,
    TOKEN_MANAGER_TYPE_LOCK_UNLOCK,
    Buffer.from(''),
    'EGLD'
  );

  await user.callContract({
    callee: its,
    funcName: 'execute',
    gasLimit: 50_000_000,
    funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
  });

  const kvs = await its.getAccount();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [...baseItsKvs(deployer, INTERCHAIN_TOKEN_ID)],
  });

  const tokenManager = world.newContract(TOKEN_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccount();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
      e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
      e.kvs.Mapper('token_identifier').Value(e.Str('EGLD')),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000110)), // flow limit and operator roles
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),
    ],
  });

  // Gateway message was marked as executed
  assertAccount(await gateway.getAccount(), {
    kvs: [...baseGatewayKvs(deployer), e.kvs.Mapper('messages', crossChainId).Value(e.Str('1'))],
  });
});

test('Errors', async () => {
  let payload = AbiCoder.defaultAbiCoder().encode(['uint256'], [MESSAGE_TYPE_LINK_TOKEN]);
  payload = wrapFromItsHubPayload(payload);

  await user
    .callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 20_000_000,
      funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(OTHER_CHAIN_ADDRESS), payload],
    })
    .assertFail({ code: 4, message: 'Not its hub' });

  await user
    .callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 20_000_000,
      funcArgs: [e.Str(OTHER_CHAIN_NAME), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    })
    .assertFail({ code: 4, message: 'Not its hub' });

  await user
    .callContract({
      callee: its,
      funcName: 'execute',
      value: 100,
      gasLimit: 20_000_000,
      funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    })
    .assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

  await user
    .callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 20_000_000,
      funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    })
    .assertFail({ code: 4, message: 'Not approved by gateway' });

  const { computedTokenId } = await itsRegisterCustomTokenLockUnlock(world, user);

  ({ payload } = await mockGatewayCall(computedTokenId, TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN));

  await user
    .callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 50_000_000,
      funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    })
    .assertFail({ code: 4, message: 'Can not deploy native interchain token' });

  ({ payload } = await mockGatewayCall(
    INTERCHAIN_TOKEN_ID,
    TOKEN_MANAGER_TYPE_MINT_BURN,
    Buffer.from(''),
    'INVALID_ESDT'
  ));

  await user
    .callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 50_000_000,
      funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    })
    .assertFail({ code: 4, message: 'Invalid token identifier' });

  ({ payload } = await mockGatewayCall(INTERCHAIN_TOKEN_ID, TOKEN_MANAGER_TYPE_MINT_BURN, Buffer.from('wrong')));

  // Operator is not a valid MultiversX address
  await user
    .callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 50_000_000,
      funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    })
    .assertFail({ code: 4, message: 'Invalid MultiversX address' });

  ({ payload } = await mockGatewayCall(computedTokenId));

  await user
    .callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 50_000_000,
      funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    })
    .assertFail({ code: 4, message: 'Token manager already exists' });
});
