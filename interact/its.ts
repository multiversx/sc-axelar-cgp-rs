import { d, e } from 'xsuite/data';
// @ts-ignore
import data from './data.json';
import { loadWallet } from './index';
import { Command } from 'commander';
import { Wallet } from 'xsuite';
import { envChain } from 'xsuite/interact';
import { its } from '../tests/itsHelpers';
import { TOKEN_ID } from '../tests/helpers';

const chainName = 'multiversx-devnet';
const otherChainName = 'ethereum-2';
const otherChainAddress = '0xf786e21509a9d50a9afd033b5940a2b7d872c208';

export const deployRemoteAddressValidator = async (wallet: Wallet) => {
  const result = await wallet.deployContract({
    code: data.codeRemoteAddressValidator,
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Str(chainName),

      e.U32(1),
      e.Str(otherChainName),

      e.U32(1),
      e.Str(otherChainAddress)
    ]
  });
  console.log('Result Remote Address Validator:', result);

  return result;
}

const deployTokenManagerMintBurn = async (deployer: Wallet) => {
  const result = await deployer.deployContract({
    code: data.codeTokenManagerMintBurn,
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
      e.Bytes('699fcfca47501d1619d08531652f17d000332fbf7bab5f00d7d5746089dc1f43'),
      deployer,
      e.Option(null),
    ]
  });
  console.log('Result Token Manager Mint Burn:', result);

  return result;
}

const deployTokenManagerLockUnlock = async (deployer: Wallet) => {
  const result = await deployer.deployContract({
    code: data.codeTokenManagerLockUnlock,
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
      e.Bytes('699fcfca47501d1619d08531652f17d000332fbf7bab5f00d7d5746089dc1f43'),
      deployer,
      e.Option(e.Str('EGLD')),
    ]
  });
  console.log('Result Token Manager Lock Unlock:', result);

  return result;
}

const deployIts = async (deployer: Wallet, remoteAddressValidator: string, tokenManagerMintBurn: string, tokenManagerLockUnlock: string) => {
  const result = await deployer.deployContract({
    code: data.codeIts,
    codeMetadata: ["upgradeable"],
    gasLimit: 300_000_000,
    codeArgs: [
      e.Addr(envChain.select(data.address)),
      e.Addr(envChain.select(data.addressGasService)),
      e.Addr(remoteAddressValidator),
      e.Addr(tokenManagerMintBurn),
      e.Addr(tokenManagerLockUnlock),
    ]
  });
  console.log('Result Interchain Token Service:', result);

  return result;
};

export const setupITSCommands = (program: Command) => {
  program.command('deployIts').action(async () => {
    const wallet = await loadWallet();

    const resultRemoteAddressValidator = await deployRemoteAddressValidator(wallet);
    const resultTokenManagerMintBurn = await deployTokenManagerMintBurn(wallet);
    const resultTokenManagerLockUnlock = await deployTokenManagerLockUnlock(wallet);
    const resultIts = await deployIts(wallet, resultRemoteAddressValidator.address, resultTokenManagerMintBurn.address, resultTokenManagerLockUnlock.address);

    console.log('Deployed Remote Address Validator Contract:', resultRemoteAddressValidator.address);
    console.log('Deployed Token Manager Mint Burn Contract:', resultTokenManagerMintBurn.address);
    console.log('Deployed Token Manager Lock Unlock Contract:', resultTokenManagerLockUnlock.address);
    console.log('Deployed Interchain Token Service Contract:', resultIts.address);
  });

  program.command('upgradeIts').action(async () => {
    const wallet = await loadWallet();

    const result = await wallet.upgradeContract({
      callee: envChain.select(data.addressIts),
      code: data.codeIts,
      codeMetadata: ["upgradeable"],
      gasLimit: 300_000_000,
      codeArgs: [
        e.Addr(envChain.select(data.address)),
        e.Addr(envChain.select(data.addressGasService)),
        e.Addr(envChain.select(data.addressRemoteAddressValidator)),
        e.Addr(envChain.select(data.addressTokenManagerMintBurn)),
        e.Addr(envChain.select(data.addressTokenManagerLockUnlock)),
      ]
    });
    console.log('Result:', result);
  });

  program.command('itsRegisterCanonicalToken')
    .argument('tokenIdentifier')
    .action(async (tokenIdentifier) => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: "registerCanonicalToken",
        gasLimit: 20_000_000,
        funcArgs: [
          e.Str(tokenIdentifier)
        ],
      });

      const tokenId = Buffer.from(d.Bytes(32).topDecode(result.returnData[0])).toString('hex');

      console.log(`Registered canonical token: ${tokenIdentifier} with id ${tokenId}`);
    });

  program.command('itsDeployRemoteCanonicalToken')
    .argument('tokenId')
    .action(async (tokenId) => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: "deployRemoteCanonicalToken",
        gasLimit: 150_000_000,
        value: BigInt('10000000000000000'), // 0.01 EGLD, to pay for cross chain gas
        funcArgs: [
          e.Bytes(tokenId),
          e.Str(otherChainName),
        ],
      });

      console.log(`Result`, result);
    });
}
