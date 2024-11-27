import { d, e } from 'xsuite/data';
// @ts-ignore
import data from './data.json';
import { firstSigners, firstSignersHash, loadWallet } from './index';
import { Command } from 'commander';
import { Wallet } from 'xsuite';
import { envChain } from 'xsuite/interact';
import { generateMessageSignature, generateProof, getKeccak256Hash, INTERCHAIN_TOKEN_ID } from '../tests/helpers';
import { Buffer } from 'buffer';
import { AbiCoder } from 'ethers';
import {
  MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
  MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER,
  MESSAGE_TYPE_INTERCHAIN_TRANSFER,
  TOKEN_MANAGER_TYPE_LOCK_UNLOCK,
} from '../tests/itsHelpers';

// TODO: Update these when needed
const chainName = 'multiversx';

const itsHubChainName = 'axelar';
const itsHubChainAddress = 'axelar10jzzmv5m7da7dn2xsfac0yqe7zamy34uedx3e28laq0p6f3f8dzqp649fp';

const otherChainName = 'avalanche-fuji';
const otherChainAddress = 'hub';

const deployBaseTokenManager = async (deployer: Wallet) => {
  // Deploy parameters don't matter since they will be overwritten
  const result = await deployer.deployContract({
    code: data.codeBaseTokenManager,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
      e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
      e.TopBuffer(INTERCHAIN_TOKEN_ID),
      e.Tuple(
        e.Option(deployer),
        e.Option(e.Str('EGLD')),
      ),
    ],
  });
  console.log('Result Base Token Manager:', result);

  return result;
};

const deployIts = async (deployer: Wallet, baseTokenManager: string) => {
  const result = await deployer.deployContract({
    code: data.codeIts,
    codeMetadata: ['upgradeable'],
    gasLimit: 200_000_000,
    codeArgs: [
      e.Addr(envChain.select(data.addressGateway)),
      e.Addr(envChain.select(data.addressGasService)),
      e.Addr(baseTokenManager),

      deployer,
      e.Str(chainName),

      e.U32(2),
      e.Str(itsHubChainName),
      e.Str(otherChainName),

      e.U32(2),
      e.Str(itsHubChainAddress),
      e.Str(otherChainAddress),
    ],
  });
  console.log('Result Interchain Token Service:', result);

  return result;
};

const deployInterchainTokenFactory = async (deployer: Wallet, its: string) => {
  const result = await deployer.deployContract({
    code: data.codeInterchainTokenFactory,
    codeMetadata: ['upgradeable'],
    gasLimit: 200_000_000,
    codeArgs: [
      e.Addr(its),
    ],
  });
  console.log('Result Interchain Token Factory:', result);

  // Set interchain token factory contract on its
  await deployer.callContract({
    callee: e.Addr(its),
    funcName: 'setInterchainTokenFactory',
    funcArgs: [
      e.Addr(result.address),
    ],
    gasLimit: 10_000_000,
  });
  console.log('Set interchain token factory contract on ITS:', result);

  return result;
};

export const setupITSCommands = (program: Command) => {
  setupInterchainTokenFactoryCommands(program);

  program.command('deployIts').action(async () => {
    const wallet = await loadWallet();

    const resultBaseTokenManager = await deployBaseTokenManager(wallet);
    const resultIts = await deployIts(wallet, resultBaseTokenManager.address);
    const resultInterchainTokenFactory = await deployInterchainTokenFactory(wallet, resultIts.address);

    console.log('Deployed Base Token Manager Contract:', resultBaseTokenManager.address);
    console.log('Deployed Interchain Token Service Contract:', resultIts.address);
    console.log('Deployed Interchain Token Factory Contract:', resultInterchainTokenFactory.address);
  });

  program.command('deployPingPong').action(async () => {
    const wallet = await loadWallet();

    const resultInterchain = await wallet.deployContract({
      code: data.codePingPongInterchain,
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        e.Addr(envChain.select(data.addressIts)),
        e.U(BigInt('10000000000000000')), // 0.01 EGLD
        e.U64(3600), // deadline after 1 hour
        e.Option(null),
      ],
    });
    console.log('Result:', resultInterchain);

    const result = await wallet.deployContract({
      code: data.codePingPongInterchain,
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        e.Addr(envChain.select(data.addressGateway)),
        e.U(BigInt('10000000000000000')), // 0.01 EGLD
        e.U64(3600), // deadline after 1 hour
        e.Option(null),
      ],
    });
    console.log('Result:', result);

    console.log('Deployed Ping Pong Interchain Contract:', resultInterchain.address);
    console.log('Deployed Ping Pong Contract:', result.address);
  });

  program.command('upgradePingPong').action(async () => {
    const wallet = await loadWallet();

    let result = await wallet.upgradeContract({
      callee: envChain.select(data.addressPingPongInterchain),
      code: data.codePingPongInterchain,
      codeMetadata: ['upgradeable'],
      gasLimit: 300_000_000,
      codeArgs: [],
    });
    console.log('Result Ping Pong Interchain:', result);
  });

  program.command('upgradeIts').action(async () => {
    const wallet = await loadWallet();

    let result = await wallet.upgradeContract({
      callee: envChain.select(data.addressIts),
      code: data.codeIts,
      codeMetadata: ['upgradeable'],
      gasLimit: 300_000_000,
      codeArgs: [],
    });
    console.log('Result ITS:', result);

    result = await wallet.upgradeContract({
      callee: envChain.select(data.addressInterchainTokenFactory),
      code: data.codeInterchainTokenFactory,
      codeMetadata: ['upgradeable'],
      gasLimit: 300_000_000,
      codeArgs: [],
    });
    console.log('Result Interchain Token Factory:', result);
  });

  program.command('upgradeBaseTokenManager').action(async () => {
    const wallet = await loadWallet();

    const result = await wallet.upgradeContract({
      callee: envChain.select(data.addressBaseTokenManager),
      code: data.codeBaseTokenManager,
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        wallet,
        e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
        e.TopBuffer(INTERCHAIN_TOKEN_ID),
        e.Tuple(
          e.Option(wallet),
          e.Option(e.Str('EGLD')),
        ),
      ],
    });
    console.log('Result:', result);
  });

  program.command('itsInterchainTransfer')
    .argument('tokenIdentifier')
    .argument('amount')
    .argument('destinationAddress')
    .argument('[gasValue]', '', 1000)
    .argument('[gasToken]')
    .action(async (tokenIdentifier, amount, destinationAddress, gasValue = 1000, gasToken = null) => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: 'interchainTransfer',
        gasLimit: 20_000_000,
        value: tokenIdentifier === 'EGLD' ? BigInt(amount) : 0,
        funcArgs: [
          e.TopBuffer(envChain.select(data.knownTokens)[tokenIdentifier].tokenId),
          e.Str(otherChainName),
          e.TopBuffer(destinationAddress),
          e.TopBuffer(''), // No metadata, uses default
          e.U(BigInt(gasValue)),
        ],
        esdts: (tokenIdentifier !== 'EGLD' ? [
          { id: tokenIdentifier, amount: BigInt(amount) },
          ...(gasToken ? [{ id: gasToken, amount: BigInt(gasValue) }] : []),
        ] : []),
      });

      console.log(`Result`, result);
    });

  program.command('callContractWithInterchainToken')
    .argument('tokenIdentifier')
    .argument('amount')
    .action(async (tokenIdentifier, amount) => {
      const wallet = await loadWallet();

      const abiCoded = AbiCoder.defaultAbiCoder().encode(['uint256'], [amount]).slice(2);

      const metadata = Buffer.concat([
        Buffer.from('fd3282c122c6c14b1eccebcb1743d5c55e15b2b2426c1aca9fda66db269e8cc6', 'hex'),
        Buffer.from(abiCoded, 'hex'),
        Buffer.from('F12372616f9c986355414BA06b3Ca954c0a7b0dC', 'hex')
      ]);

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: 'callContractWithInterchainToken',
        gasLimit: 20_000_000,
        funcArgs: [
          e.TopBuffer('dfbbd97a4e0c3ec2338d800be851dca6d08d4779398d4070d5cb18d2ebfe62d7'),
          e.Str(otherChainName),
          e.TopBuffer('94EC28e6Fceb5B3ce1AFb316520a03487b5dE027'),
          e.TopBuffer(metadata),
          e.U(BigInt(0)),
        ],
        esdts: [{ id: tokenIdentifier, amount: BigInt(amount) }],
      });

      console.log(`Result`, result);
    });

  /*******************************
    ITS Execute test flow
  ********************************/

  // Update this if wanting to test again
  const executePingPongMessageId = 'executePingPongMessageId';
  const executePingPongPayload = (wallet: Wallet) => {
    const tokenId = envChain.select<any>(data.knownTokens)['EGLD'].tokenId;

    return AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
      [
        MESSAGE_TYPE_INTERCHAIN_TRANSFER,
        Buffer.from(tokenId, 'hex'),
        Buffer.from(otherChainAddress),
        Buffer.from(e.Addr(envChain.select(data.addressPingPongInterchain)).toTopU8A()),
        '10000000000000000',
        Buffer.from(e.Tuple(e.Str('ping'), wallet).toTopU8A()), // data passed to contract
      ],
    ).substring(2);
  };

  program.command('itsExecuteInterchainTransferWithData').action(async () => {
    const wallet = await loadWallet();

    const payload = executePingPongPayload(wallet);

    const result = await wallet.callContract({
      callee: envChain.select(data.addressIts),
      funcName: 'execute',
      gasLimit: 100_000_000,
      funcArgs: [
        e.Str(otherChainName),
        e.Str(executePingPongMessageId),
        e.Str(otherChainAddress),
        payload,
      ],
    });

    console.log(`Result`, result);
  });

  /*******************************
    ITS Deploy Interchain Token test flow
  ********************************/

  // Update this if wanting to test again
  const executeDeployInterchainTokenMessageId = 'executeDeployInterchainTokenMessageId';
  const executeDeployInterchainTokenPayload = (wallet: Wallet) => {
    const tokenId = 'bbee65f504a6951e2cc056ad5285b2b580de05f09bb2531d9bf0a8398e29c2bb';

    return AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'],
      [
        MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN,
        Buffer.from(tokenId, 'hex'),
        'TokenName',
        'SYMBOL',
        6,
        Buffer.from(wallet.toTopU8A()), // minter
      ],
    ).substring(2);
  };

  program.command('itsApproveExecuteDeployInterchainToken').action(async () => {
    const wallet = await loadWallet();

    const payload = executeDeployInterchainTokenPayload(wallet);

    const payloadHash = getKeccak256Hash(Buffer.from(payload, 'hex'));

    const message = e.Tuple(
      e.Str(otherChainName),
      e.Str(executeDeployInterchainTokenMessageId),
      e.Str(otherChainAddress),
      e.Addr(envChain.select(data.addressIts)),
      e.TopBuffer(payloadHash),
    );

    const result = await wallet.callContract({
      callee: envChain.select(data.addressGateway),
      gasLimit: 15_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(
          firstSigners, [
            generateMessageSignature(firstSignersHash, e.List(message)),
          ],
        ),
      ],
    });
    console.log('Result:', result);
  });

  // Needs to be called 2 times to fully finish the token deployment!
  program.command('itsExecuteDeployInterchainToken').action(async () => {
    const wallet = await loadWallet();

    const payload = executeDeployInterchainTokenPayload(wallet);

    const result = await wallet.callContract({
      callee: envChain.select(data.addressIts),
      funcName: 'execute',
      gasLimit: 150_000_000,
      // value: BigInt('50000000000000000'), // 0.05 EGLD, to pay for ESDT issue cost (only on 2nd transaction)
      funcArgs: [
        e.Str(otherChainName),
        e.Str(executeDeployInterchainTokenMessageId),
        e.Str(otherChainAddress),
        payload,
      ],
    });

    console.log(`Result`, result);
  });

  // TODO:
  /*******************************
   ITS Deploy Token Manager test flow
   ********************************/

    // Update this if wanting to test again
  const executeDeployTokenManagerMessageId = 'executeDeployTokenManagerMessageId';
  const executeDeployTokenManagerPayload = (wallet: Wallet) => {
    const tokenId = 'aaee65f504a6951e2cc056ad5285b2b580de05f09bb2531d9bf0a8398e29c2bb';
    const tokenIdentifier = 'ITSTT-9a9969';

    return AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'uint8', 'bytes'],
      [
        MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER,
        Buffer.from(tokenId, 'hex'),
        TOKEN_MANAGER_TYPE_LOCK_UNLOCK,
        Buffer.from(
          e.Tuple(
            e.Option(wallet), // operator
            e.Option(e.Str(tokenIdentifier)),
          ).toTopU8A(),
        ),
      ],
    ).substring(2);
  };

  program.command('itsApproveExecuteDeployTokenManager').action(async () => {
    const wallet = await loadWallet();

    const payload = executeDeployTokenManagerPayload(wallet);

    const payloadHash = getKeccak256Hash(Buffer.from(payload, 'hex'));

    const message = e.Tuple(
      e.Str(otherChainName),
      e.Str(executeDeployTokenManagerMessageId),
      e.Str(otherChainAddress),
      e.Addr(envChain.select(data.addressIts)),
      e.TopBuffer(payloadHash),
    );

    const result = await wallet.callContract({
      callee: envChain.select(data.addressGateway),
      gasLimit: 15_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(
          firstSigners, [
            generateMessageSignature(firstSignersHash, e.List(message)),
          ],
        ),
      ],
    });
    console.log('Result:', result);
  });

  program.command('itsExecuteDeployTokenManager').action(async () => {
    const wallet = await loadWallet();

    const payload = executeDeployTokenManagerPayload(wallet);

    const result = await wallet.callContract({
      callee: envChain.select(data.addressIts),
      funcName: 'execute',
      gasLimit: 100_000_000,
      funcArgs: [
        e.Str(otherChainName),
        e.Str(executeDeployTokenManagerMessageId),
        e.Str(otherChainAddress),
        payload,
      ],
    });

    console.log(`Result`, result);
  });
};

const setupInterchainTokenFactoryCommands = (program: Command) => {
  // Needs to be called 3 times to fully finish the token deployment!
  program.command('itsDeployInterchainToken')
    .action(async () => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressInterchainTokenFactory),
        funcName: 'deployInterchainToken',
        gasLimit: 150_000_000,
        // value: BigInt('50000000000000000'), // 0.05 EGLD, to pay for ESDT issue cost (only on 2nd transaction)
        funcArgs: [
          e.TopBuffer(getKeccak256Hash('ITSTT')),
          e.Str('ITSTestToken'),
          e.Str('ITSTT'),
          e.U8(6),
          e.U(1_000_000_000_000), // 1M tokens
          wallet,
        ],
      });

      console.log(`Result`, result);
    });

  program.command('itsDeployRemoteInterchainToken')
    .action(async () => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressInterchainTokenFactory),
        funcName: 'deployRemoteInterchainToken',
        gasLimit: 100_000_000,
        value: BigInt('10000000000000000'), // 0.01 EGLD, to pay for cross chain gas
        funcArgs: [
          e.Str(chainName),
          e.TopBuffer(getKeccak256Hash('ITSTT')),
          wallet,
          e.Str(otherChainName),
        ],
      });

      console.log(`Result`, result);
    });

  program.command('itsRegisterCanonicalInterchainToken')
    .argument('tokenIdentifier')
    .action(async (tokenIdentifier) => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressInterchainTokenFactory),
        funcName: 'registerCanonicalInterchainToken',
        gasLimit: 30_000_000,
        funcArgs: [
          e.Str(tokenIdentifier),
        ],
      });

      const tokenId = Buffer.from(d.TopBuffer().topDecode(result.returnData[0])).toString('hex');

      console.log(`Registered canonical interchain token: ${tokenIdentifier} with id ${tokenId}`);
    });

  program.command('itsDeployRemoteCanonicalInterchainToken')
    .argument('tokenIdentifier')
    .action(async (tokenIdentifier) => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressInterchainTokenFactory),
        funcName: 'deployRemoteCanonicalInterchainToken',
        gasLimit: 100_000_000,
        value: BigInt('10000000000000000'), // 0.01 EGLD, to pay for cross chain gas
        funcArgs: [
          e.Str(chainName),
          e.Str(tokenIdentifier),
          e.Str(otherChainName),
        ],
      });

      console.log(`Result`, result);
    });
};
