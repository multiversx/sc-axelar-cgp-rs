import { assert, beforeEach, test } from 'vitest';
import { assertAccount, d, e, FSWallet, FSWorld } from 'xsuite';
import {
  computeInterchainTokenId,
  ESDT_SYSTEM_CONTRACT,
  ITS_HUB_CHAIN_NAME,
  MESSAGE_TYPE_LINK_TOKEN,
  MESSAGE_TYPE_REGISTER_TOKEN_METADATA,
  TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN,
  TOKEN_MANAGER_TYPE_MINT_BURN,
} from '../itsHelpers';
import {
  ADDRESS_ZERO,
  CHAIN_NAME,
  DOMAIN_SEPARATOR,
  INTERCHAIN_TOKEN_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  OTHER_CHAIN_TOKEN_ADDRESS,
  TOKEN_SALT,
} from '../helpers';
import { AbiCoder } from 'ethers';

let world: FSWorld;
let deployer: FSWallet;
let user: FSWallet;
let collector: FSWallet;

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

test(
  'Register token metadata async call with cross chain call + link token with cross chain call',
  async () => {
    const { contract: fsGateway } = await deployer.deployContract({
      code: 'file:gateway/output/gateway.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [e.U(16), e.TopBuffer(DOMAIN_SEPARATOR), e.U64(3600), e.Addr(ADDRESS_ZERO)],
    });
    const { contract: fsGasService } = await deployer.deployContract({
      code: 'file:gas-service/output/gas-service.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [collector],
    });

    const { contract: fsTokenManager } = await deployer.deployContract({
      code: 'file:token-manager/output/token-manager.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        deployer,
        e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN),
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Tuple(e.Option(null), e.Option(null)),
      ],
    });

    const { contract: fsIts } = await deployer.deployContract({
      code: 'file:interchain-token-service/output/interchain-token-service.wasm',
      codeMetadata: ['upgradeable'],
      gasLimit: 200_000_000,
      codeArgs: [
        fsGateway,
        fsGasService,
        fsTokenManager,

        deployer,
        e.Str(CHAIN_NAME),

        e.U32(2),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(ITS_HUB_CHAIN_NAME), // Set trusted address for ITS hub

        e.U32(2),
        e.Str(OTHER_CHAIN_ADDRESS),
        e.Str('axelar157hl7gpuknjmhtac2qnphuazv2yerfagva7lsu9vuj2pgn32z22qa26dk4'),
      ],
    });
    // Set interchain token factory on its to user
    await deployer.callContract({
      callee: fsIts,
      funcName: 'setInterchainTokenFactory',
      funcArgs: [user],
      gasLimit: 10_000_000,
    });

    // First deploys a new token manager contract
    let result = await user.callContract({
      callee: fsIts,
      funcName: 'deployInterchainToken',
      gasLimit: 100_000_000,
      // value: 10n ** 16n,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
        e.TopBuffer(''),
      ],
    });
    const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), TOKEN_SALT);

    assert(result.returnData[0] === computedTokenId);

    // Second deploys a new ESDT token
    await user.callContract({
      callee: fsIts,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      value: 10n ** 17n,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(''),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
        e.TopBuffer(''),
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
     * Assert link token
     */

    const linkParams = AbiCoder.defaultAbiCoder().encode(['bytes'], [OTHER_CHAIN_ADDRESS]).substring(2);
    result = await user.callContract({
      callee: fsIts,
      funcName: 'linkToken',
      gasLimit: 20_000_000,
      value: 100_000,
      funcArgs: [
        e.TopBuffer(TOKEN_SALT),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(OTHER_CHAIN_TOKEN_ADDRESS),
        e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
        e.Buffer(linkParams),
      ],
    });

    assert(result.returnData[0] === computeInterchainTokenId(e.Addr(ADDRESS_ZERO)));

    const tx = await world.proxy.getTx(result.hash);

    callContractLogData = Buffer.from(
      tx.logs.events.filter((log: any) => log.identifier === 'callContract')[0].data,
      'base64'
    ).toString('hex');

    // Assert call contract was made with correct ABI encoded payload
    expectedAbiPayload = AbiCoder.defaultAbiCoder()
      .encode(
        ['uint256', 'bytes32', 'uint256', 'bytes', 'bytes', 'bytes'],
        [
          MESSAGE_TYPE_LINK_TOKEN,
          Buffer.from(result.returnData[0], 'hex'),
          TOKEN_MANAGER_TYPE_MINT_BURN,
          Buffer.from(tokenIdentifier),
          Buffer.from(OTHER_CHAIN_TOKEN_ADDRESS),
          Buffer.from(linkParams, 'hex'),
        ]
      )
      .substring(2);

    assert(callContractLogData === expectedAbiPayload);

    // Cross chain call was initiated, gas service received funds
    assertAccount(await fsGasService.getAccount(), {
      balance: 100_100n,
    });
  },
  { timeout: 120_000 }
);
