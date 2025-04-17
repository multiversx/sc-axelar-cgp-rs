import { d, e } from 'xsuite/data';
// @ts-ignore
import data from './data.json';
import { loadWallet } from './index';
import { Command } from 'commander';
import { Wallet } from 'xsuite';
import { envChain } from 'xsuite/interact';
import { ADDRESS_ZERO, getKeccak256Hash, INTERCHAIN_TOKEN_ID } from '../tests/helpers';
import { Buffer } from 'buffer';
import { TOKEN_MANAGER_TYPE_LOCK_UNLOCK } from '../tests/itsHelpers';
import { AbiCoder } from 'ethers';

const deployBaseTokenManager = async (deployer: Wallet) => {
  console.log('Deploying base token manager...');

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
  console.log('Deploying ITS...');

  const itsTrustedChains: string[] = envChain.select(data.itsTrustedChains).map((name: string) => e.Str(name));

  const result = await deployer.deployContract({
    code: data.codeIts,
    codeMetadata: ['upgradeable'],
    gasLimit: 200_000_000,
    codeArgs: [
      e.Addr(envChain.select(data.addressGateway)),
      e.Addr(envChain.select(data.addressGasService)),
      e.Addr(baseTokenManager),

      deployer,
      e.Str(envChain.select(data.axelar).chainName),
      e.Str(envChain.select(data.itsHubAddress)),

      e.U32(itsTrustedChains.length),
      ...itsTrustedChains,
    ],
  });
  console.log('Result Interchain Token Service:', result);

  return result;
};

export const setupITSCommands = (program: Command) => {
  setupITSFactoryCommands(program);

  program.command('deployIts').action(async () => {
    const wallet = await loadWallet();

    const resultBaseTokenManager = await deployBaseTokenManager(wallet);
    const resultIts = await deployIts(wallet, resultBaseTokenManager.address);

    console.log('Deployed Base Token Manager Contract:', resultBaseTokenManager.address);
    console.log('Deployed Interchain Token Service Contract:', resultIts.address);
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
    .argument('otherChainName')
    .argument('destinationAddress')
    .argument('[gasValue]', '', '5000000000000000') // 0.005 EGLD
    .argument('[gasToken]', '', 'EGLD-000000')
    .action(async (
      tokenIdentifier,
      amount,
      otherChainName,
      destinationAddress,
      gasValue,
      gasToken,
    ) => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: 'interchainTransfer',
        gasLimit: 20_000_000,
        value: tokenIdentifier === 'EGLD' ? BigInt(amount) : 0,
        funcArgs: [
          e.TopBuffer(envChain.select(data.itsKnownTokens)[tokenIdentifier].tokenId),
          e.Str(otherChainName),
          e.TopBuffer(destinationAddress),
          e.TopBuffer(''), // No metadata, uses default
          e.U(BigInt(gasValue)),
        ],
        esdts: (tokenIdentifier !== 'EGLD' ? [
          { id: tokenIdentifier, amount: BigInt(amount) },
          { id: gasToken, amount: BigInt(gasValue) },
        ] : []),
      });

      console.log(`Result`, result);
    });

  program.command('callContractWithInterchainToken')
    .argument('tokenIdentifier')
    .argument('amount')
    .argument('otherChainName')
    .argument('destinationAddress')
    .argument('[gasValue]', '', '5000000000000000') // 0.005 EGLD
    .argument('[gasToken]', '', 'EGLD-000000')
    .action(async (
      tokenIdentifier,
      amount,
      otherChainName,
      destinationAddress,
      gasValue,
      gasToken,
    ) => {
      const wallet = await loadWallet();

      const abiCoded = AbiCoder.defaultAbiCoder().encode(['uint256'], [amount]).slice(2);

      const metadata = Buffer.concat([
        Buffer.from('fd3282c122c6c14b1eccebcb1743d5c55e15b2b2426c1aca9fda66db269e8cc6', 'hex'),
        Buffer.from(abiCoded, 'hex'),
        Buffer.from('F12372616f9c986355414BA06b3Ca954c0a7b0dC', 'hex'),
      ]);

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: 'callContractWithInterchainToken',
        gasLimit: 20_000_000,
        value: tokenIdentifier === 'EGLD' ? BigInt(amount) : 0,
        funcArgs: [
          e.TopBuffer(envChain.select(data.itsKnownTokens)[tokenIdentifier].tokenId),
          e.Str(otherChainName),
          e.TopBuffer('94EC28e6Fceb5B3ce1AFb316520a03487b5dE027'),
          e.TopBuffer(metadata),
          e.U(BigInt(0)),
        ],
        esdts: (tokenIdentifier !== 'EGLD' ? [
          { id: tokenIdentifier, amount: BigInt(amount) },
          { id: gasToken, amount: BigInt(gasValue) },
        ] : []),
      });

      console.log(`Result`, result);
    });
};

const setupITSFactoryCommands = (program: Command) => {
  // Needs to be called 3 times to fully finish the token deployment!
  program.command('itsDeployInterchainToken')
    .argument('[tokenName]')
    .argument('[tokenSymbol]')
    .argument('[decimals]')
    .argument('[supply]')
    .action(async (
      tokenName = 'ITSTestToken',
      tokenSymbol = 'ITSTT',
      decimals = '18',
      supply = '1000000000000000000000000' // 1M tokens
    ) => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: 'deployInterchainToken',
        gasLimit: 150_000_000,
        // value: BigInt('50000000000000000'), // 0.05 EGLD, to pay for ESDT issue cost (only on 2nd transaction)
        funcArgs: [
          e.TopBuffer(getKeccak256Hash(tokenSymbol)),
          e.Str(tokenName),
          e.Str(tokenSymbol),
          e.U8(BigInt(decimals)),
          e.U(BigInt(supply)),
          e.Addr(ADDRESS_ZERO),
        ],
      });

      console.log(`Result`, result);
    });

  program.command('itsDeployRemoteInterchainToken')
    .argument('otherChainName')
    .argument('[tokenSymbol]')
    .action(async (otherChainName, tokenSymbol = 'ITSTT') => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: 'deployRemoteInterchainToken',
        gasLimit: 100_000_000,
        value: BigInt('5000000000000000'), // 0.005 EGLD, to pay for cross chain gas
        funcArgs: [
          e.TopBuffer(getKeccak256Hash(tokenSymbol)),
          e.Addr(ADDRESS_ZERO),
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
        callee: envChain.select(data.addressIts),
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
    .argument('otherChainName')
    .action(async (tokenIdentifier, otherChainName) => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: 'deployRemoteCanonicalInterchainToken',
        gasLimit: 100_000_000,
        value: BigInt('5000000000000000'), // 0.005 EGLD, to pay for cross chain gas
        funcArgs: [
          e.Str(tokenIdentifier),
          e.Str(otherChainName),
        ],
      });

      console.log(`Result`, result);
    });
};
