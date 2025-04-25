import { assert, beforeEach, describe, test } from 'vitest';
import { assertAccount, d, e, FSContract, FSWallet, FSWorld } from 'xsuite';
import {
  baseGatewayKvs,
  computeCanonicalInterchainTokenDeploySalt,
  computeInterchainTokenDeploySalt,
  computeInterchainTokenIdRaw,
  computeLinkedTokenId,
  defaultWeightedSigners,
  ESDT_SYSTEM_CONTRACT,
  ITS_HUB_ADDRESS,
  ITS_HUB_CHAIN,
  MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
  MESSAGE_TYPE_INTERCHAIN_TRANSFER,
  MESSAGE_TYPE_LINK_TOKEN,
  MESSAGE_TYPE_REGISTER_TOKEN_METADATA,
  TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN,
  TOKEN_MANAGER_TYPE_LOCK_UNLOCK,
  TOKEN_MANAGER_TYPE_MINT_BURN,
  wrapFromItsHubPayload,
  wrapToItsHubPayload,
} from '../itsHelpers';
import {
  ADDRESS_ZERO,
  CHAIN_NAME,
  DOMAIN_SEPARATOR,
  getKeccak256Hash,
  getMessageHash,
  INTERCHAIN_TOKEN_ID,
  MESSAGE_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  OTHER_CHAIN_TOKEN_ADDRESS,
  TOKEN_IDENTIFIER_EGLD,
  TOKEN_SALT,
} from '../helpers';
import { AbiCoder } from 'ethers';
import { Buffer } from 'buffer';
import { getAddressShard } from 'xsuite/dist/data/utils';

let world: FSWorld;
let deployer: FSWallet;
let user: FSWallet;
let collector: FSWallet;

let fsGateway: FSContract;
let fsGasService: FSContract;
let fsTokenManager: FSContract;
let fsIts: FSContract;
let fsPingPong: FSContract;

beforeEach(async () => {
  world = await FSWorld.start();

  deployer = await world.createWallet({
    balance: 10n ** 18n,
  });
  user = await world.createWallet({
    balance: 10n ** 20n,
  });
  collector = await world.createWallet();
});

async function getCallContractDataFromEsdtAsync(hash: string) {
  const tx = await world.proxy.getTx(hash);

  const relevantLogs = tx.smartContractResults.filter((result: any) => result.sender === ESDT_SYSTEM_CONTRACT)[0].logs
    .events;

  return Buffer.from(relevantLogs.filter((log: any) => log.identifier === 'callContract')[0].data, 'base64').toString(
    'hex'
  );
}

const deployContracts = async () => {
  ({ contract: fsGateway } = await deployer.deployContract({
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [e.U(16), e.TopBuffer(DOMAIN_SEPARATOR), e.U64(3600), deployer, defaultWeightedSigners],
  }));

  ({ contract: fsGasService } = await deployer.deployContract({
    code: 'file:gas-service/output/gas-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [collector],
  }));

  ({ contract: fsTokenManager } = await deployer.deployContract({
    code: 'file:token-manager/output/token-manager.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
      e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN),
      e.TopBuffer(INTERCHAIN_TOKEN_ID),
      e.Tuple(e.Option(null), e.Option(null)),
    ],
  }));

  ({ contract: fsIts } = await deployer.deployContract({
    code: 'file:interchain-token-service/output/interchain-token-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 200_000_000,
    codeArgs: [
      fsGateway,
      fsGasService,
      fsTokenManager,

      deployer,
      e.Str(CHAIN_NAME),
      e.Str(ITS_HUB_ADDRESS),

      e.U32(1),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }));
};

const deployNewEsdt = async () => {
  // First deploys a new token manager contract
  let result = await user.callContract({
    callee: fsIts,
    funcName: 'deployInterchainToken',
    gasLimit: 100_000_000,
    funcArgs: [
      e.TopBuffer(TOKEN_SALT),
      e.Str('TokenName'),
      e.Str('SYMBOL'),
      e.U8(18),
      e.U(10n ** 18n),
      e.Addr(ADDRESS_ZERO),
    ],
  });
  const deploySalt = computeInterchainTokenDeploySalt(user);
  const computedTokenId = computeInterchainTokenIdRaw(deploySalt);

  assert(result.returnData[0] === computedTokenId);

  // Second deploys a new ESDT token
  await user.callContract({
    callee: fsIts,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000,
    value: 50000000000000000n,
    funcArgs: [
      e.TopBuffer(TOKEN_SALT),
      e.Str('TokenName'),
      e.Str('SYMBOL'),
      e.U8(18),
      e.U(10n ** 18n),
      e.Addr(ADDRESS_ZERO),
    ],
  });

  // Third mints ESDT token to user
  await user.callContract({
    callee: fsIts,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000,
    funcArgs: [
      e.TopBuffer(TOKEN_SALT),
      e.Str('TokenName'),
      e.Str('SYMBOL'),
      e.U8(18),
      e.U(10n ** 18n),
      e.Addr(ADDRESS_ZERO),
    ],
  });

  const tokenIdentifier = d.Str().fromTop(
    (
      await fsIts.query({
        funcName: 'registeredTokenIdentifier',
        funcArgs: [e.TopBuffer(computedTokenId)],
      })
    ).returnData[0]
  );

  return { computedTokenId, tokenIdentifier };
};

async function mockFSGatewayMessageApproved(
  payload: string,
  operator: FSWallet,
  sourceChain: string = ITS_HUB_CHAIN,
  sourceAddress: string = ITS_HUB_ADDRESS
) {
  const payloadHash = getKeccak256Hash(Buffer.from(payload, 'hex'));

  const messageHash = getMessageHash(sourceChain, MESSAGE_ID, sourceAddress, fsIts, payloadHash);

  const crossChainId = e.Tuple(e.Str(sourceChain), e.Str(MESSAGE_ID));

  // Mock call approved by gateway
  await fsGateway.setAccount({
    ...(await fsGateway.getAccount()),
    codeMetadata: ['payable'],
    kvs: [
      ...baseGatewayKvs(operator),

      // Manually approve message
      e.kvs.Mapper('messages', crossChainId).Value(messageHash),
    ],
  });

  return { crossChainId, messageHash };
}

const mockDeployInterchainTokenGatewayCall = async () => {
  const originalPayload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'],
    [
      MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
      Buffer.from(INTERCHAIN_TOKEN_ID, 'hex'),
      'TokenName',
      'SYMBOL',
      18,
      Buffer.from(user.toTopU8A()), // minter
    ]
  );

  const payload = wrapFromItsHubPayload(originalPayload);

  const { crossChainId, messageHash } = await mockFSGatewayMessageApproved(payload, deployer);

  return { payload, crossChainId, messageHash };
};

const mockExecuteInterchainTransferWithDataGatewayCall = async (
  tokenId: string,
  contract: FSContract,
  fnc = 'ping'
) => {
  const contractPayload = Buffer.from(e.Tuple(e.Str(fnc), collector).toTopU8A());

  const originalPayload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      MESSAGE_TYPE_INTERCHAIN_TRANSFER,
      Buffer.from(tokenId, 'hex'),
      Buffer.from(OTHER_CHAIN_ADDRESS),
      Buffer.from(contract.toTopU8A()),
      1_000,
      contractPayload, // data passed to contract
    ]
  );

  const payload = wrapFromItsHubPayload(originalPayload);

  const { crossChainId, messageHash } = await mockFSGatewayMessageApproved(payload, deployer);

  return { payload, crossChainId, messageHash, contractPayload };
};

test(
  'Interchain transfer ABI payload',
  async () => {
    await deployContracts();

    const { computedTokenId, tokenIdentifier } = await deployNewEsdt();

    const { hash } = await user.callContract({
      callee: fsIts,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str('otherChainUser'),
        e.Buffer(''), // No data
        e.U(10n ** 16n),
      ],
      esdts: [
        { id: tokenIdentifier, amount: 10n ** 17n },
        { id: TOKEN_IDENTIFIER_EGLD, amount: 10n ** 16n },
      ],
    });

    const tx = await world.proxy.getTx(hash);

    const relevantResult = tx.smartContractResults.filter(
      (result: any) => result.sender === user.toString() && result.receiver === fsIts.toString()
    )[0];
    // Message was validate in gateway
    const relevantEvent = relevantResult.logs.events.filter((result: any) => result.identifier === 'callContract')[0];

    const topics = relevantEvent.topics.map((topic: any) => Buffer.from(topic, 'base64'));

    assert(topics[0].toString() == 'contract_call_event');
    assert(topics[1].toString('hex') == fsIts.toTopHex());
    assert(topics[2].toString() == ITS_HUB_CHAIN);
    assert(topics[3].toString() == ITS_HUB_ADDRESS);

    // Assert call contract was made with correct ABI encoded payload
    const innerAbiPayload = AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
      [
        MESSAGE_TYPE_INTERCHAIN_TRANSFER,
        Buffer.from(computedTokenId, 'hex'),
        user.toTopU8A(),
        Buffer.from('otherChainUser'),
        10n ** 17n,
        Buffer.from(''),
      ]
    );

    const expectedAbiPayload = wrapToItsHubPayload(innerAbiPayload);

    assert(Buffer.from(relevantEvent.data, 'base64').toString('hex') === expectedAbiPayload);

    assert(topics[4].toString('hex') == getKeccak256Hash(Buffer.from(expectedAbiPayload, 'hex')));

    // Cross chain call was initiated, gas service received funds
    assertAccount(await fsGasService.getAccount(), {
      balance: 10n ** 16n,
    });
  },
  { timeout: 60_000 }
);

test(
  'Factory deploy remote interchain token ESDT async call and ABI Payload',
  async () => {
    await deployContracts();

    const { computedTokenId } = await deployNewEsdt();

    const { hash } = await user.callContract({
      callee: fsIts,
      funcName: 'deployRemoteInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    const callContractLogData = await getCallContractDataFromEsdtAsync(hash);

    // Assert call contract was made with correct ABI encoded payload
    const innerAbiPayload = AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'],
      [
        MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
        Buffer.from(computedTokenId, 'hex'),
        'TokenName',
        'SYMBOL',
        18,
        Buffer.from(''),
      ]
    );

    const expectedAbiPayload = wrapToItsHubPayload(innerAbiPayload);

    assert(callContractLogData === expectedAbiPayload);
  },
  { timeout: 60_000 }
);

test(
  'Send to hub ABI payload deploy remote interchain token',
  async () => {
    await deployContracts();

    const { computedTokenId } = await deployNewEsdt();

    const { hash } = await user.callContract({
      callee: fsIts,
      funcName: 'deployRemoteInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    const callContractLogData = await getCallContractDataFromEsdtAsync(hash);

    // Assert call contract was made with correct ABI encoded payload
    const innerAbiPayload = AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'],
      [
        MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
        Buffer.from(computedTokenId, 'hex'),
        'TokenName',
        'SYMBOL',
        18,
        Buffer.from(''),
      ]
    );

    const expectedAbiPayload = wrapToItsHubPayload(innerAbiPayload);

    assert(callContractLogData === expectedAbiPayload);
  },
  { timeout: 60_000 }
);

test(
  'Register token metadata ESDT async call and ABI payload + link token ABI payload',
  async () => {
    await deployContracts();

    // Deploy a new interchain token just so we have an ESDT token to use
    let result = await user.callContract({
      callee: fsIts,
      funcName: 'deployInterchainToken',
      gasLimit: 100_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str('TokenName'),
        e.Str('SYMBOL'),
        e.U8(18),
        e.U(1_000),
        e.Addr(ADDRESS_ZERO),
      ],
    });

    const deploySalt = computeInterchainTokenDeploySalt(user);
    const computedTokenId = computeInterchainTokenIdRaw(deploySalt);

    assert(result.returnData[0] === computedTokenId);

    // Second deploys a new ESDT token
    await user.callContract({
      callee: fsIts,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      value: 50000000000000000n,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str('TokenName'),
        e.Str('SYMBOL'),
        e.U8(18),
        e.U(1_000),
        e.Addr(ADDRESS_ZERO),
      ],
    });

    const tokenIdentifier = d.Str().fromTop(
      (
        await fsIts.query({
          funcName: 'registeredTokenIdentifier',
          funcArgs: [e.TopBuffer(computedTokenId)],
        })
      ).returnData[0]
    );

    /**
     * Assert register token metadata
     */

    // The cross chain call is actually done in the callback after the async call to getTokenProperties finishes
    const { hash } = await user.callContract({
      callee: fsIts,
      funcName: 'registerTokenMetadata',
      gasLimit: 100_000_000,
      funcArgs: [e.Str(tokenIdentifier)],
      value: 100,
    });

    let callContractLogData = await getCallContractDataFromEsdtAsync(hash);

    // Assert call contract was made with correct ABI encoded payload
    let expectedAbiPayload = AbiCoder.defaultAbiCoder()
      .encode(['uint256', 'bytes', 'uint8'], [MESSAGE_TYPE_REGISTER_TOKEN_METADATA, Buffer.from(tokenIdentifier), 18])
      .substring(2);

    assert(callContractLogData === expectedAbiPayload);

    // Cross chain call was initiated, gas service received funds
    assertAccount(await fsGasService.getAccount(), {
      balance: 100n,
    });

    /**
     * Assert register custom token
     */

    result = await user.callContract({
      callee: fsIts,
      funcName: 'registerCustomToken',
      gasLimit: 100_000_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(tokenIdentifier),
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
        e.Addr(ADDRESS_ZERO),
      ],
    });

    const computedTokenIdLink = computeLinkedTokenId(user);

    assert(result.returnData[0] === computedTokenIdLink);

    /**
     * Assert link token
     */

    const linkParams = AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2);
    result = await user.callContract({
      callee: fsIts,
      funcName: 'linkToken',
      gasLimit: 30_000_000,
      value: 100_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.Buffer(linkParams),
      ],
    });

    assert(result.returnData[0] === computedTokenIdLink);

    const tx = await world.proxy.getTx(result.hash);

    callContractLogData = Buffer.from(
      tx.logs.events.filter((log: any) => log.identifier === 'callContract')[0].data,
      'base64'
    ).toString('hex');

    // Assert call contract was made with correct ABI encoded payload
    const innerAbiPayload = AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'uint256', 'bytes', 'bytes', 'bytes'],
      [
        MESSAGE_TYPE_LINK_TOKEN,
        Buffer.from(result.returnData[0], 'hex'),
        TOKEN_MANAGER_TYPE_MINT_BURN,
        Buffer.from(tokenIdentifier),
        Buffer.from(OTHER_CHAIN_TOKEN_ADDRESS),
        Buffer.from(linkParams, 'hex'),
      ]
    );

    expectedAbiPayload = wrapToItsHubPayload(innerAbiPayload);

    assert(callContractLogData === expectedAbiPayload);

    // Cross chain call was initiated, gas service received funds
    assertAccount(await fsGasService.getAccount(), {
      balance: 100_100n,
    });
  },
  { timeout: 120_000 }
);

test(
  'Execute deploy interchain token ESDT async call',
  async () => {
    await deployContracts();

    const { payload } = await mockDeployInterchainTokenGatewayCall();

    // First deploys a new token manager contract
    await user.callContract({
      callee: fsIts,
      funcName: 'execute',
      gasLimit: 600_000_000,
      funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    });

    // Second deploys a new token manager contract
    const { hash } = await user.callContract({
      callee: fsIts,
      funcName: 'execute',
      gasLimit: 600_000_000,
      value: 50000000000000000n,
      funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
    });

    const tx = await world.proxy.getTx(hash);

    // Message was validate in gateway
    const relevantEvent = tx.logs.events.filter((result: any) => result.identifier === 'validateMessage')[0];
    const topics = relevantEvent.topics.map((topic: any) => Buffer.from(topic, 'base64').toString());

    assert(topics[0] == 'message_executed_event');
    assert(topics[1] == ITS_HUB_CHAIN);
    assert(topics[2] == MESSAGE_ID);
  },
  { timeout: 60_000 }
);

describe('Execute interchain transfer with data', () => {
  const registerEgldCanonical = async () => {
    // Register EGLD canonical token
    const deploySalt = computeCanonicalInterchainTokenDeploySalt('EGLD');
    const computedTokenId = computeInterchainTokenIdRaw(deploySalt);

    const result = await user.callContract({
      callee: fsIts,
      funcName: 'registerCanonicalInterchainToken',
      gasLimit: 20_000_000,
      funcArgs: [e.Str('EGLD')],
    });
    assert(result.returnData[0] === computedTokenId);

    // Do an interchain transfer first so Token Manager has enough funds
    await user.callContract({
      callee: fsIts,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str('otherChainUser'),
        e.Buffer(''), // No data
        e.U(10n ** 16n),
      ],
      value: 10n ** 18n,
    });

    return computedTokenId;
  };

  const checkItsProxyTokens = async (fsProxyContract: FSContract, contractPayload: Buffer, computedTokenId: string) => {
    const { tokenIdentifier } = await deployNewEsdt();

    await user
      .callContract({
        callee: fsProxyContract,
        funcName: 'executeWithInterchainToken',
        gasLimit: 100_000_000,
        funcArgs: [
          e.Str(OTHER_CHAIN_NAME),
          e.Str(MESSAGE_ID),
          e.Str(OTHER_CHAIN_ADDRESS),
          e.Buffer(contractPayload),
          e.TopBuffer(computedTokenId),
        ],
        esdts: [{ id: tokenIdentifier, amount: 1_000 }],
      })
      .assertFail({ code: 'returnMessage', message: 'Can not send any payment' });

    await user
      .callContract({
        callee: fsProxyContract,
        funcName: 'executeWithInterchainToken',
        gasLimit: 100_000_000,
        value: 1_000,
        funcArgs: [
          e.Str(OTHER_CHAIN_NAME),
          e.Str(MESSAGE_ID),
          e.Str(OTHER_CHAIN_ADDRESS),
          e.Buffer(contractPayload),
          e.TopBuffer(computedTokenId),
        ],
      })
      .assertFail({ code: 'signalError', message: 'Can not send any payment' });
  };

  test(
    'Same shard',
    async () => {
      await deployContracts();

      // Deploy contract on same Shard
      ({ contract: fsPingPong } = await deployer.deployContract({
        code: 'file:ping-pong-interchain/output/ping-ping-interchain.wasm',
        codeMetadata: ['upgradeable'],
        gasLimit: 100_000_000,
        codeArgs: [fsIts, e.U(1_000), e.U64(10), e.Option(null)],
      }));

      const computedTokenId = await registerEgldCanonical();

      const { payload } = await mockExecuteInterchainTransferWithDataGatewayCall(computedTokenId, fsPingPong);

      await user.callContract({
        callee: fsIts,
        funcName: 'execute',
        gasLimit: 100_000_000,
        funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
      });

      // Assert ping pong was successfully called with tokens
      const pingPongKvs = await fsPingPong.getAccount();
      assertAccount(pingPongKvs, {
        balance: 1_000,
        hasKvs: [
          e.kvs.Mapper('interchain_token_service').Value(fsIts),
          e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
          e.kvs.Mapper('maxFunds').Value(e.Option(null)),

          // User mapper
          e.kvs.Mapper('user_address_to_id', collector).Value(e.U32(1)),
          e.kvs.Mapper('user_id_to_address', e.U32(1)).Value(collector),
          e.kvs.Mapper('user_count').Value(e.U32(1)),

          e.kvs.Mapper('userStatus', e.U32(1)).Value(e.U8(1)),
        ],
      });
    },
    { timeout: 60_000 }
  );

  test(
    'Different shard async call not supported',
    async () => {
      await deployContracts();

      // Make sure accounts are on different shards
      assert(getAddressShard(deployer) != getAddressShard(user));

      // Deploy contract on another Shard
      ({ contract: fsPingPong } = await user.deployContract({
        code: 'file:ping-pong-interchain/output/ping-ping-interchain.wasm',
        codeMetadata: ['upgradeable'],
        gasLimit: 100_000_000,
        codeArgs: [fsIts, e.U(1_000), e.U64(10), e.Option(null)],
      }));

      const computedTokenId = await registerEgldCanonical();

      const { payload } = await mockExecuteInterchainTransferWithDataGatewayCall(computedTokenId, fsPingPong);

      await user
        .callContract({
          callee: fsIts,
          funcName: 'execute',
          gasLimit: 100_000_000,
          funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
        })
        .assertFail({ code: 'signalError', message: 'sync execution request is not in the same shard' });
    },
    { timeout: 60_000 }
  );

  test(
    'Different shard async call proxy all cases',
    async () => {
      await deployContracts();

      // Make sure accounts are on different shards
      assert(getAddressShard(deployer) != getAddressShard(user));

      // Deploy contract on another Shard
      ({ contract: fsPingPong } = await user.deployContract({
        code: 'file:ping-pong-interchain/output/ping-ping-interchain.wasm',
        codeMetadata: ['upgradeable'],
        gasLimit: 100_000_000,
        codeArgs: [fsIts, e.U(1_000), e.U64(10), e.Option(null)],
      }));

      // Deploy proxy on same Shard
      const { contract: fsProxyContract } = await deployer.deployContract({
        code: 'file:interchain-token-service-proxy/output/interchain-token-service-proxy.wasm',
        codeMetadata: ['upgradeable'],
        gasLimit: 100_000_000,
        codeArgs: [fsIts, fsPingPong, e.U64(20_000_000)],
      });

      // Make sure its and proxy is no same shard, and ping pong is on another shard
      assert(getAddressShard(fsIts) == getAddressShard(fsProxyContract));
      assert(getAddressShard(fsProxyContract) != getAddressShard(fsPingPong));

      // Allow contract to be called by proxy
      await user.callContract({
        callee: fsPingPong,
        funcName: 'setInterchainTokenService',
        funcArgs: [fsProxyContract],
        gasLimit: 10_000_000,
      });

      const computedTokenId = await registerEgldCanonical();

      // Need to call proxy contract from other chain instead
      const { payload, contractPayload } = await mockExecuteInterchainTransferWithDataGatewayCall(
        computedTokenId,
        fsProxyContract
      );

      // User can not execute through Proxy directly if call is not failed
      await user
        .callContract({
          callee: fsProxyContract,
          funcName: 'executeWithInterchainToken',
          gasLimit: 100_000_000,
          funcArgs: [
            e.Str(OTHER_CHAIN_NAME),
            e.Str(MESSAGE_ID),
            e.Str(OTHER_CHAIN_ADDRESS),
            e.Buffer(contractPayload),
            e.TopBuffer(computedTokenId),
          ],
        })
        .assertFail({ code: 'signalError', message: 'Call is not allowed' });

      // Too little gas provided, Proxy prevents gas attacks in a sync way
      await user
        .callContract({
          callee: fsIts,
          funcName: 'execute',
          gasLimit: 50_000_000,
          funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
        })
        .assertFail({ code: 'signalError', message: 'error signalled by smartcontract' });

      // ITS will sync call -> Proxy Contract async call -> Ping Pong contract
      await user.callContract({
        callee: fsIts,
        funcName: 'execute',
        gasLimit: 60_000_000,
        funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payload],
      });

      // Assert ping pong was successfully called with tokens
      let pingPongKvs = await fsPingPong.getAccount();
      assertAccount(pingPongKvs, {
        balance: 1_000,
        hasKvs: [
          e.kvs.Mapper('interchain_token_service').Value(fsProxyContract),
          e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
          e.kvs.Mapper('maxFunds').Value(e.Option(null)),

          // User mapper
          e.kvs.Mapper('user_address_to_id', collector).Value(e.U32(1)),
          e.kvs.Mapper('user_id_to_address', e.U32(1)).Value(collector),
          e.kvs.Mapper('user_count').Value(e.U32(1)),

          e.kvs.Mapper('userStatus', e.U32(1)).Value(e.U8(1)),
        ],
      });

      // Do another call for `ping` in the Ping Pong contract, which will fail and tokens will remain the in the proxy contract
      const { payload: payloadAgain } = await mockExecuteInterchainTransferWithDataGatewayCall(
        computedTokenId,
        fsProxyContract
      );

      // Proxy async call will fail
      // ITS will sync call -> Proxy Contract async call -> Ping Pong contract
      await user
        .callContract({
          callee: fsIts,
          funcName: 'execute',
          gasLimit: 100_000_000,
          funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payloadAgain],
        })
        .assertFail({ code: 'returnMessage', message: 'can only ping once' });

      // Even if proxy async call failed, gateway message was still validated
      await user
        .callContract({
          callee: fsIts,
          funcName: 'execute',
          gasLimit: 100_000_000,
          funcArgs: [e.Str(ITS_HUB_CHAIN), e.Str(MESSAGE_ID), e.Str(ITS_HUB_ADDRESS), payloadAgain],
        })
        .assertFail({ code: 'signalError', message: 'Not approved by gateway' });

      // Assert ping pong kvs remain unchanged
      pingPongKvs = await fsPingPong.getAccount();
      assertAccount(pingPongKvs, {
        balance: 1_000,
        hasKvs: [
          e.kvs.Mapper('interchain_token_service').Value(fsProxyContract),
          e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
          e.kvs.Mapper('maxFunds').Value(e.Option(null)),

          // User mapper
          e.kvs.Mapper('user_address_to_id', collector).Value(e.U32(1)),
          e.kvs.Mapper('user_id_to_address', e.U32(1)).Value(collector),
          e.kvs.Mapper('user_count').Value(e.U32(1)),

          e.kvs.Mapper('userStatus', e.U32(1)).Value(e.U8(1)),
        ],
      });

      // Assert proxy contract has tokens because async call failed
      const proxyKvs = await fsProxyContract.getAccount();
      assertAccount(proxyKvs, {
        balance: 1_000,
        kvs: [
          e.kvs.Mapper('interchain_token_service').Value(fsIts),
          e.kvs.Mapper('contract_address').Value(fsPingPong),
          e.kvs.Mapper('min_gas_for_execution').Value(e.U64(20_000_000)),

          // Failed calls holds all the information required to retry a call
          e.kvs
            .Mapper(
              'failed_calls',
              e.Str(OTHER_CHAIN_NAME),
              e.Str(MESSAGE_ID),
              e.Str(OTHER_CHAIN_ADDRESS),
              e.Buffer(contractPayload),
              e.TopBuffer(computedTokenId)
            )
            .Value(e.Tuple(e.Str('EGLD'), e.U(1_000))),
        ],
      });

      // User can now execute failed call through Proxy directly, but can not send any tokens
      await checkItsProxyTokens(fsProxyContract, contractPayload, computedTokenId);

      // User can now execute failed call through Proxy directly, although async call still fails in this case
      await user
        .callContract({
          callee: fsProxyContract,
          funcName: 'executeWithInterchainToken',
          gasLimit: 100_000_000,
          funcArgs: [
            e.Str(OTHER_CHAIN_NAME),
            e.Str(MESSAGE_ID),
            e.Str(OTHER_CHAIN_ADDRESS),
            e.Buffer(contractPayload),
            e.TopBuffer(computedTokenId),
          ],
        })
        .assertFail({ code: 'returnMessage', message: 'can only ping once' });

      // Assert proxy contract still has tokens because async call failed
      assertAccount(await fsProxyContract.getAccount(), {
        balance: 1_000,
        kvs: [
          e.kvs.Mapper('interchain_token_service').Value(fsIts),
          e.kvs.Mapper('contract_address').Value(fsPingPong),
          e.kvs.Mapper('min_gas_for_execution').Value(e.U64(20_000_000)),

          // Failed calls still holds all the information required to retry a call
          e.kvs
            .Mapper(
              'failed_calls',
              e.Str(OTHER_CHAIN_NAME),
              e.Str(MESSAGE_ID),
              e.Str(OTHER_CHAIN_ADDRESS),
              e.Buffer(contractPayload),
              e.TopBuffer(computedTokenId)
            )
            .Value(e.Tuple(e.Str('EGLD'), e.U(1_000))),
        ],
      });

      // Remove keys from Ping Pong contract so retrying call succeeds
      await fsPingPong.setAccount({
        ...(await fsPingPong.getAccount()),
        balance: 0,
        codeMetadata: ['payable'],
        kvs: [
          e.kvs.Mapper('interchain_token_service').Value(fsProxyContract),
          e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
          e.kvs.Mapper('maxFunds').Value(e.Option(null)),
        ],
      });

      // User can now execute failed call through Proxy directly, which will now work
      await user.callContract({
        callee: fsProxyContract,
        funcName: 'executeWithInterchainToken',
        gasLimit: 100_000_000,
        funcArgs: [
          e.Str(OTHER_CHAIN_NAME),
          e.Str(MESSAGE_ID),
          e.Str(OTHER_CHAIN_ADDRESS),
          e.Buffer(contractPayload),
          e.TopBuffer(computedTokenId),
        ],
      });

      // Assert proxy no longer has tokens and no failed calls
      assertAccount(await fsProxyContract.getAccount(), {
        balance: 0,
        kvs: [
          e.kvs.Mapper('interchain_token_service').Value(fsIts),
          e.kvs.Mapper('contract_address').Value(fsPingPong),
          e.kvs.Mapper('min_gas_for_execution').Value(e.U64(20_000_000)),
        ],
      });

      // Assert ping pong was executed correctly
      pingPongKvs = await fsPingPong.getAccount();
      assertAccount(pingPongKvs, {
        balance: 1_000,
        hasKvs: [
          e.kvs.Mapper('interchain_token_service').Value(fsProxyContract),
          e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
          e.kvs.Mapper('maxFunds').Value(e.Option(null)),

          // User mapper
          e.kvs.Mapper('user_address_to_id', collector).Value(e.U32(1)),
          e.kvs.Mapper('user_id_to_address', e.U32(1)).Value(collector),
          e.kvs.Mapper('user_count').Value(e.U32(1)),

          e.kvs.Mapper('userStatus', e.U32(1)).Value(e.U8(1)),
        ],
      });
    },
    { timeout: 60_000 }
  );

  test('Proxy contract management', async () => {
    await deployContracts();

    const { contract: fsProxyContract } = await deployer.deployContract({
      code: 'file:interchain-token-service-proxy/output/interchain-token-service-proxy.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [fsIts, fsIts, e.U64(20_000_000)],
    });

    await user
      .callContract({
        callee: fsProxyContract,
        funcName: 'setMinGasForExecution',
        gasLimit: 10_000_000,
        funcArgs: [e.U64(10_000_000)],
      })
      .assertFail({ code: 'signalError', message: 'Endpoint can only be called by owner' });

    await deployer
      .callContract({
        callee: fsProxyContract,
        funcName: 'setMinGasForExecution',
        gasLimit: 10_000_000,
        funcArgs: [e.U64(10_000_000)],
      });

    assertAccount(await fsProxyContract.getAccount(), {
      kvs: [
        e.kvs.Mapper('interchain_token_service').Value(fsIts),
        e.kvs.Mapper('contract_address').Value(fsIts),
        e.kvs.Mapper('min_gas_for_execution').Value(e.U64(10_000_000)),
      ],
    });
  });
});
