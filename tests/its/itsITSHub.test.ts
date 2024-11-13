import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import {
  INTERCHAIN_TOKEN_ID,
  MESSAGE_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  OTHER_CHAIN_TOKEN_ADDRESS,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_MANAGER_ADDRESS,
  TOKEN_MANAGER_ADDRESS_2,
  TOKEN_SALT,
} from '../helpers';
import { Buffer } from 'buffer';
import {
  baseGatewayKvs,
  baseItsKvs,
  computeInterchainTokenId,
  deployContracts,
  deployPingPongInterchain,
  gasService,
  gateway,
  interchainTokenFactory,
  its,
  ITS_CHAIN_ADDRESS,
  ITS_HUB_CHAIN_NAME,
  ITS_HUB_ROUTING_IDENTIFIER,
  itsDeployTokenManagerLockUnlock,
  itsDeployTokenManagerMintBurn,
  MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
  MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER,
  MESSAGE_TYPE_INTERCHAIN_TRANSFER,
  MESSAGE_TYPE_RECEIVE_FROM_HUB,
  mockGatewayMessageApproved,
  pingPong,
  TOKEN_MANAGER_TYPE_MINT_BURN,
} from '../itsHelpers';
import { AbiCoder } from 'ethers';

let world: SWorld;
let deployer: SWallet;
let collector: SWallet;
let user: SWallet;
let otherUser: SWallet;

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
  otherUser = await world.createWallet({
    balance: BigInt('10000000000000000'),
  });

  await deployContracts(deployer, collector);

  // Trust ITS Hub chain
  await deployer.callContract({
    callee: its,
    funcName: 'setTrustedAddress',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(ITS_HUB_CHAIN_NAME),
      e.Str(ITS_CHAIN_ADDRESS),
    ],
  });

  // Route original chain through ITS Hub
  await deployer.callContract({
    callee: its,
    funcName: 'setTrustedAddress',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(ITS_HUB_ROUTING_IDENTIFIER),
    ],
  });
});

afterEach(async () => {
  await world.terminate();
});

const mockTransferGatewayCall = async (interchainTokenId: string, payload: string | null = null) => {
  if (!payload) {
    payload = AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
      [
        MESSAGE_TYPE_INTERCHAIN_TRANSFER,
        Buffer.from(interchainTokenId, 'hex'),
        Buffer.from(OTHER_CHAIN_ADDRESS),
        Buffer.from(otherUser.toTopU8A()),
        1_000,
        Buffer.from(''),
      ],
    );

    payload = AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'string', 'bytes'],
      [
        MESSAGE_TYPE_RECEIVE_FROM_HUB,
        OTHER_CHAIN_NAME,
        payload,
      ]
    ).substring(2);
  }

  const { commandId, messageHash } = await mockGatewayMessageApproved(payload, deployer, ITS_HUB_CHAIN_NAME, ITS_CHAIN_ADDRESS);

  return { payload, commandId, messageHash };
};

const mockTransferWithDataGatewayCall = async (tokenId: string, fnc = 'ping') => {
  let payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      MESSAGE_TYPE_INTERCHAIN_TRANSFER,
      Buffer.from(tokenId, 'hex'),
      Buffer.from(OTHER_CHAIN_ADDRESS),
      Buffer.from(pingPong.toTopU8A()),
      1_000,
      Buffer.from(e.Tuple(e.Str(fnc), otherUser).toTopU8A()), // data passed to contract
    ],
  );

  payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'string', 'bytes'],
    [
      MESSAGE_TYPE_RECEIVE_FROM_HUB,
      OTHER_CHAIN_NAME,
      payload,
    ]
  ).substring(2);

  const { commandId, messageHash } = await mockGatewayMessageApproved(payload, deployer, ITS_HUB_CHAIN_NAME, ITS_CHAIN_ADDRESS);

  return { payload, commandId, messageHash };
};

const mockDeployInterchainTokenGatewayCall = async (tokenId = INTERCHAIN_TOKEN_ID) => {
  let payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'],
    [
      MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
      Buffer.from(tokenId, 'hex'),
      'TokenName',
      'SYMBOL',
      18,
      Buffer.from(user.toTopU8A()), // minter
    ],
  );

  payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'string', 'bytes'],
    [
      MESSAGE_TYPE_RECEIVE_FROM_HUB,
      OTHER_CHAIN_NAME,
      payload,
    ]
  ).substring(2);

  const { commandId, messageHash } = await mockGatewayMessageApproved(payload, deployer, ITS_HUB_CHAIN_NAME, ITS_CHAIN_ADDRESS);

  return { payload, commandId, messageHash };
};

const mockDeployTokenManagerGatewayCall = async (tokenId = INTERCHAIN_TOKEN_ID, type = TOKEN_MANAGER_TYPE_MINT_BURN) => {
  let payload = AbiCoder.defaultAbiCoder().encode(
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
  );

  payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'string', 'bytes'],
    [
      MESSAGE_TYPE_RECEIVE_FROM_HUB,
      OTHER_CHAIN_NAME,
      payload,
    ]
  ).substring(2);

  const { commandId, messageHash } = await mockGatewayMessageApproved(payload, deployer, ITS_HUB_CHAIN_NAME, ITS_CHAIN_ADDRESS);

  return { payload, commandId, messageHash };
};

describe('Execute', () => {
  test('Transfer', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerMintBurn(world, user);

    const { payload, commandId } = await mockTransferGatewayCall(computedTokenId);

    await user.callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 20_000_000,
      funcArgs: [
        e.Str(ITS_HUB_CHAIN_NAME),
        e.Str(MESSAGE_ID),
        e.Str(ITS_CHAIN_ADDRESS),
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

        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.Str('1')),
      ],
    });
  });

  test('Transfer with data', async () => {
    await deployPingPongInterchain(deployer);

    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(
      world,
      user,
      true,
      'EGLD',
    );

    const { payload, commandId } = await mockTransferWithDataGatewayCall(computedTokenId);

    await user.callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 50_000_000,
      funcArgs: [
        e.Str(ITS_HUB_CHAIN_NAME),
        e.Str(MESSAGE_ID),
        e.Str(ITS_CHAIN_ADDRESS),
        payload,
      ],
    });

    // Assert ping pong was successfully called with tokens
    const pingPongKvs = await pingPong.getAccountWithKvs();
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
    const tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 99_000,
      kvs: [
        ...baseTokenManagerKvs,
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

  test('Deploy interchain token only deploy token manager', async () => {
    const { payload, commandId, messageHash } = await mockDeployInterchainTokenGatewayCall();

    await user.callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 100_000_000,
      funcArgs: [
        e.Str(ITS_HUB_CHAIN_NAME),
        e.Str(MESSAGE_ID),
        e.Str(ITS_CHAIN_ADDRESS),
        payload,
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

        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.TopBuffer(messageHash)),
      ],
    });
  });

  test('Deploy token manager', async () => {
    const { payload, commandId } = await mockDeployTokenManagerGatewayCall();

    await user.callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 50_000_000,
      funcArgs: [
        e.Str(ITS_HUB_CHAIN_NAME),
        e.Str(MESSAGE_ID),
        e.Str(ITS_CHAIN_ADDRESS),
        payload,
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

        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.Str("1")),
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

    // Can not receive normal messages from ITS Hub chain
    await user.callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 20_000_000,
      funcArgs: [
        e.Str(ITS_HUB_CHAIN_NAME),
        e.Str(MESSAGE_ID),
        e.Str(ITS_CHAIN_ADDRESS),
        payload,
      ],
    }).assertFail({ code: 4, message: 'Untrusted chain' });

    payload = AbiCoder.defaultAbiCoder().encode(
      ['uint256'],
      [
        MESSAGE_TYPE_RECEIVE_FROM_HUB,
      ],
    ).substring(2);

    await deployer.callContract({
      callee: its,
      funcName: 'setTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
      ],
    });

    // Can not receive from hub from other chain than ITS Hub chain
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
    }).assertFail({ code: 4, message: 'Untrusted chain' });

    payload = AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes', 'bytes'],
      [
        MESSAGE_TYPE_RECEIVE_FROM_HUB,
        Buffer.from(OTHER_CHAIN_NAME),
        '0x',
      ]
    ).substring(2);

    // Original source chain is not routed via ITS Hub
    await user.callContract({
      callee: its,
      funcName: 'execute',
      gasLimit: 20_000_000,
      funcArgs: [
        e.Str(ITS_HUB_CHAIN_NAME),
        e.Str(MESSAGE_ID),
        e.Str(ITS_CHAIN_ADDRESS),
        payload,
      ],
    }).assertFail({ code: 4, message: 'Untrusted chain' });
  });
});

describe('Transfers', () => {
  test('Interchain transfer', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''), // No metadata, uses default
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    });

    // Assert NO gas was paid for cross chain call
    let kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0,
      kvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]), // Lock/Unlock token manager holds tokens in the contract
      ],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });

  test('Call contract', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    await user.callContract({
      callee: its,
      funcName: 'callContractWithInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('sth'),
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    });

    // Assert NO gas was paid for cross chain call
    let kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0,
      kvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    let tokenManagerKvs = await tokenManager.getAccountWithKvs();
    assertAccount(tokenManagerKvs, {
      balance: 0n,
      kvs: [
        ...baseTokenManagerKvs,

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]), // Lock/Unlock token manager holds tokens in the contract
      ],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });


  test('Errors', async () => {
    const { computedTokenId, tokenManager, baseTokenManagerKvs } = await itsDeployTokenManagerLockUnlock(world, user);

    // Can not send directly to ITS Hub chain
    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(ITS_HUB_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''), // No metadata, uses default
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    }).assertFail({ code: 4, message: 'Untrusted chain' });

    // Chain is not trusted
    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str('RandomChain'),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''), // No metadata, uses default
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    }).assertFail({ code: 4, message: 'Untrusted chain' });

    // Remove ITS Hub chain address
    await deployer.callContract({
      callee: its,
      funcName: 'removeTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(ITS_HUB_CHAIN_NAME),
      ],
    });

    // Can not route to ITS Hub chain
    await user.callContract({
      callee: its,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Buffer(''), // No metadata, uses default
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    }).assertFail({ code: 4, message: 'Untrusted chain' });
  });
});

describe('Deploy', () => {
  test('Remote token manager', async () => {
    // Mock token manager exists on source chain
    await its.setAccount({
      ...await its.getAccountWithKvs(),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(otherUser))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });

    // Route original chain through ITS Hub
    await deployer.callContract({
      callee: its,
      funcName: 'setTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(OTHER_CHAIN_NAME),
        e.Str(ITS_HUB_ROUTING_IDENTIFIER),
      ],
    });

    // No address for ITS Hub chain
    await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      value: 100_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.U8(2),
        e.Buffer(
          AbiCoder.defaultAbiCoder().encode(
            ['bytes', 'address'],
            [
              OTHER_CHAIN_ADDRESS,
              OTHER_CHAIN_TOKEN_ADDRESS,
            ],
          ).substring(2),
        ),
      ],
    }).assertFail({ code: 4, message: 'Untrusted chain' });

    // Trust ITS Hub chain
    await deployer.callContract({
      callee: its,
      funcName: 'setTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(ITS_HUB_CHAIN_NAME),
        e.Str(ITS_CHAIN_ADDRESS),
      ],
    });

    let result = await user.callContract({
      callee: its,
      funcName: 'deployTokenManager',
      gasLimit: 20_000_000,
      value: 100_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.U8(2),
        e.Buffer(
          AbiCoder.defaultAbiCoder().encode(
            ['bytes', 'address'],
            [
              OTHER_CHAIN_ADDRESS,
              OTHER_CHAIN_TOKEN_ADDRESS,
            ],
          ).substring(2),
        ),
      ],
    });

    assert(result.returnData[0] === computeInterchainTokenId(user));

    // Nothing changes for its keys
    let kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('trusted_address', e.Str(OTHER_CHAIN_NAME)).Value(e.Str(ITS_HUB_ROUTING_IDENTIFIER)),
        e.kvs.Mapper('trusted_address', e.Str(ITS_HUB_CHAIN_NAME)).Value(e.Str(ITS_CHAIN_ADDRESS)),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(user))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computeInterchainTokenId(otherUser))).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });

    // Assert gas was paid for cross chain call
    kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 100_000,
      kvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });

  test('Remote interchain token', async () => {
    const computedTokenId = computeInterchainTokenId(user);
    const computedTokenId2 = computeInterchainTokenId(otherUser);

    // Mock token manager exists on source chain
    await its.setAccount({
      ...await its.getAccountWithKvs(),
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId2)).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });

    // Route original chain through ITS Hub
    await deployer.callContract({
      callee: its,
      funcName: 'setTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(OTHER_CHAIN_NAME),
        e.Str(ITS_HUB_ROUTING_IDENTIFIER),
      ],
    });

    // Trust ITS Hub chain
    await deployer.callContract({
      callee: its,
      funcName: 'setTrustedAddress',
      gasLimit: 10_000_000,
      funcArgs: [
        e.Str(ITS_HUB_CHAIN_NAME),
        e.Str(ITS_CHAIN_ADDRESS),
      ],
    });

    await user.callContract({
      callee: its,
      funcName: 'deployInterchainToken',
      gasLimit: 20_000_000,
      value: 100_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
        e.Str(OTHER_CHAIN_ADDRESS), // minter
      ],
    });

    // Nothing changes for its keys
    let kvs = await its.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseItsKvs(deployer, interchainTokenFactory),

        e.kvs.Mapper('trusted_address', e.Str(OTHER_CHAIN_NAME)).Value(e.Str(ITS_HUB_ROUTING_IDENTIFIER)),
        e.kvs.Mapper('trusted_address', e.Str(ITS_HUB_CHAIN_NAME)).Value(e.Str(ITS_CHAIN_ADDRESS)),

        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS)),
        e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId2)).Value(e.Addr(
          TOKEN_MANAGER_ADDRESS_2)),
      ],
    });

    // Assert gas was paid for cross chain call
    kvs = await gasService.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 100_000,
      kvs: [
        e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
      ],
    });

    // There are events emitted for the Gateway contract, but there is no way to test those currently...
  });
});
