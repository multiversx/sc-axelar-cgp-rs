import { assert, beforeEach, test } from 'vitest';
import { assertAccount, d, e, FSContract, FSWallet, FSWorld } from 'xsuite';
import {
  baseGatewayKvs,
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

let world: FSWorld;
let deployer: FSWallet;
let user: FSWallet;
let collector: FSWallet;

let fsGateway: FSContract;
let fsGasService: FSContract;
let fsTokenManager: FSContract;
let fsIts: FSContract;

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

  return computedTokenId;
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

test(
  'Interchain transfer ABI payload',
  async () => {
    await deployContracts();

    const computedTokenId = await deployNewEsdt();

    const tokenIdentifier = d.Str().fromTop(
      (
        await fsIts.query({
          funcName: 'registeredTokenIdentifier',
          funcArgs: [e.TopBuffer(computedTokenId)],
        })
      ).returnData[0]
    );

    const { hash } = await user.callContract({
      callee: fsIts,
      funcName: 'interchainTransfer',
      gasLimit: 20_000_000,
      funcArgs: [
        e.TopBuffer(computedTokenId),
        e.Str(OTHER_CHAIN_NAME),
        e.Str('otherChainUser'),
        e.Buffer(''), // No metadata, uses default
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

    const computedTokenId = await deployNewEsdt();

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

    const computedTokenId = await deployNewEsdt();

    const { hash } = await user.callContract({
      callee: fsIts,
      funcName: 'deployRemoteInterchainToken',
      gasLimit: 150_000_000,
      value: 100_000_000n,
      funcArgs: [e.TopBuffer(TOKEN_SALT), e.Str(OTHER_CHAIN_NAME)],
    });

    const callContractLogData = await getCallContractDataFromEsdtAsync(hash);

    // Assert call contract was made with correct ABI encoded payload
    const innerAbiPayload = AbiCoder.defaultAbiCoder()
      .encode(
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
