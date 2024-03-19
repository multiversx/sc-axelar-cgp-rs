import { d, e } from 'xsuite/data';
// @ts-ignore
import data from './data.json';
import { getKeccak256Hash, loadWallet } from './index';
import { Command } from 'commander';
import { Wallet } from 'xsuite';
import { envChain } from 'xsuite/interact';
import { generateProof, INTERCHAIN_TOKEN_ID } from '../tests/helpers';
import createKeccakHash from 'keccak';
import { Buffer } from 'buffer';
import { AbiCoder } from 'ethers';
import { TOKEN_MANAGER_TYPE_LOCK_UNLOCK } from '../tests/itsHelpers';

const chainName = 'MultiversX-D';
const otherChainName = 'ethereum-2';
const otherChainAddress = '0xf786e21509a9d50a9afd033b5940a2b7d872c208';

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

      e.U32(1),
      e.Str(otherChainName),

      e.U32(1),
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

  program.command('deployPingPongInterchain').action(async () => {
    const wallet = await loadWallet();

    const result = await wallet.deployContract({
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
    console.log('Result:', result);

    console.log('Deployed Ping Pong Interchain Contract:', result.address);
  });

  program.command('upgradeIts').action(async () => {
    const wallet = await loadWallet();

    const result = await wallet.upgradeContract({
      callee: envChain.select(data.addressIts),
      code: data.codeIts,
      codeMetadata: ['upgradeable'],
      gasLimit: 300_000_000,
      codeArgs: [],
    });
    console.log('Result:', result);
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
    .argument('tokenId')
    .argument('tokenIdentifier')
    .argument('amount')
    .argument('[gasValue]', '', 0)
    .action(async (tokenId, tokenIdentifier, amount, gasValue = 0) => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: 'interchainTransfer',
        gasLimit: 20_000_000,
        value: tokenIdentifier === 'EGLD' ? BigInt(amount) : 0,
        funcArgs: [
          e.TopBuffer(tokenId),
          e.Str(otherChainName),
          e.Str(otherChainAddress),
          e.TopBuffer(''), // No metadata, uses default
          e.U(gasValue),
        ],
        esdts: (tokenIdentifier !== 'EGLD' ? [{ id: tokenIdentifier, amount: BigInt(amount) }] : []),
      });

      console.log(`Result`, result);
    });

  const executePingPongPayload = (wallet: Wallet) => {
    return AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes', 'bytes'],
      [
        2, // selector receive token with data
        Buffer.from(envChain.select<any>(data.knownTokens)['EGLD']['tokenId'], 'hex'),
        Buffer.from(e.Addr(envChain.select(data.addressPingPongInterchain)).toTopBytes()),
        '10000000000000000',
        Buffer.from(wallet.toTopBytes()),
        Buffer.from(e.Str('ping').toTopBytes()), // data passed to contract, in this case the string "ping"
      ],
    ).substring(2);
  };

  program.command('itsExpressReceiveTokenWithData').action(async () => {
    const wallet = await loadWallet();

    const payload = executePingPongPayload(wallet);

    const result = await wallet.callContract({
      callee: envChain.select(data.addressIts),
      funcName: 'expressReceiveToken',
      gasLimit: 100_000_000,
      value: BigInt('10000000000000000'), // 0.01 EGLD
      funcArgs: [
        payload,
        e.Str('mockCommandId2'),
        e.Str(otherChainName),
      ],
    });

    console.log(`Result`, result);
  });

  program.command('itsApproveExecuteReceiveTokenWithData').action(async () => {
    const wallet = await loadWallet();

    const payload = executePingPongPayload(wallet);

    const payloadHash = createKeccakHash('keccak256').update(Buffer.from(payload, 'hex')).digest('hex');

    const executeData = e.Tuple(
      e.List(e.Str('mockCommandId-3')),
      e.List(e.Str('approveContractCall')),
      e.List(
        e.Buffer(
          e.Tuple(
            e.Str(otherChainName),
            e.Str(otherChainAddress),
            e.Addr(envChain.select(data.addressIts)),
            e.Buffer(Buffer.from(payloadHash, 'hex')),
            e.Str('sourceTxHash'),
            e.U(123), // source event index
          ).toTopBytes(),
        ),
      ),
    );

    const { proof } = generateProof(executeData);

    const result = await wallet.callContract({
      callee: envChain.select(data.address),
      gasLimit: 15_000_000,
      funcName: 'execute',
      funcArgs: [
        executeData,
        proof,
      ],
    });
    console.log('Result:', result);
  });

  program.command('itsExecuteReceiveTokenWithData').action(async () => {
    const wallet = await loadWallet();

    const payload = executePingPongPayload(wallet);

    const result = await wallet.callContract({
      callee: envChain.select(data.addressIts),
      funcName: 'execute',
      gasLimit: 200_000_000,
      funcArgs: [
        e.Str('mockCommandId-3'),
        e.Str(otherChainName),
        e.Str(otherChainAddress),
        payload,
      ],
    });

    console.log(`Result`, result);
  });

  const executeDeployAndRegisterPayload = (wallet: Wallet) => {
    return e.Buffer(
      e.Tuple(
        e.U(4), // selector deploy and register standardized token
        e.Bytes(Buffer.from('bbee65f504a6951e2cc056ad5285b2b580de05f09bb2531d9bf0a8398e29c2bb', 'hex')),
        e.Str('TokenName'),
        e.Str('SYMBOL'),
        e.U8(6),
        e.Buffer(wallet.toTopBytes()),
        e.Buffer(wallet.toTopBytes()),
        e.U(1_000_000),
        e.Buffer(e.Addr(envChain.select(data.addressPingPongInterchain)).toTopBytes()),
      ).toTopBytes(),
    );
  };

  program.command('itsApproveExecuteDeployAndRegisterStandardizedToken').action(async () => {
    const wallet = await loadWallet();

    const payload = executeDeployAndRegisterPayload(wallet);

    const payloadHash = createKeccakHash('keccak256').update(Buffer.from(payload.toTopHex(), 'hex')).digest('hex');

    const executeData = e.Tuple(
      e.List(e.Str('mockCommandId-8')),
      e.List(e.Str('approveContractCall')),
      e.List(
        e.Buffer(
          e.Tuple(
            e.Str(otherChainName),
            e.Str(otherChainAddress),
            e.Addr(envChain.select(data.addressIts)),
            e.Buffer(Buffer.from(payloadHash, 'hex')),
            e.Str('sourceTxHash'),
            e.U(123), // source event index
          ).toTopBytes(),
        ),
      ),
    );

    const { proof } = generateProof(executeData);

    const result = await wallet.callContract({
      callee: envChain.select(data.address),
      gasLimit: 15_000_000,
      funcName: 'execute',
      funcArgs: [
        executeData,
        proof,
      ],
    });
    console.log('Result:', result);
  });

  program.command('itsExecuteDeployAndRegisterStandardizedToken').action(async () => {
    const wallet = await loadWallet();

    const payload = executeDeployAndRegisterPayload(wallet);

    const result = await wallet.callContract({
      callee: envChain.select(data.addressIts),
      funcName: 'execute',
      gasLimit: 150_000_000,
      value: BigInt('50000000000000000'), // 0.05 EGLD, to pay for ESDT issue cost
      funcArgs: [
        e.Str('mockCommandId-8'),
        e.Str(otherChainName),
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
        value: BigInt('50000000000000000'), // 0.05 EGLD, to pay for ESDT issue cost (only on 2nd transaction)
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
