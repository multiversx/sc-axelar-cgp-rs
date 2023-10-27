import { d, e } from 'xsuite/data';
// @ts-ignore
import data from './data.json';
import { loadWallet, program } from './index';
import { Command } from 'commander';
import { Wallet } from 'xsuite';
import { envChain } from 'xsuite/interact';
import { generateProof, MOCK_CONTRACT_ADDRESS_2 } from '../tests/helpers';
import createKeccakHash from 'keccak';
import { Buffer } from 'buffer';

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

  program.command('deployPingPongInterchain').action(async () => {
    const wallet = await loadWallet();

    const result = await wallet.deployContract({
      code: data.codePingPongInterchain,
      codeMetadata: ["upgradeable"],
      gasLimit: 100_000_000,
      codeArgs: [
        e.Addr(envChain.select(data.addressIts)),
        e.U(BigInt('10000000000000000')), // 0.01 EGLD
        e.U64(3600), // deadline after 1 hour
        e.Option(null),
      ]
    });
    console.log('Result:', result);

    console.log('Deployed Ping Pong Interchain Contract:', result.address);
  });

  program.command('upgradeTokenManagerMintBurn').action(async () => {
    const wallet = await loadWallet();

    const result = await wallet.upgradeContract({
      callee: envChain.select(data.addressTokenManagerMintBurn),
      code: data.codeTokenManagerMintBurn,
      codeMetadata: ["upgradeable"],
      gasLimit: 100_000_000,
      codeArgs: [
        wallet,
        e.Bytes('699fcfca47501d1619d08531652f17d000332fbf7bab5f00d7d5746089dc1f43'),
        wallet,
        e.Option(null),
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

      console.log(`Registered canonical token: ${ tokenIdentifier } with id ${ tokenId }`);
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

  program.command('itsDeployAndRegisterStandardizedToken').action(async () => {
    const wallet = await loadWallet();

    const result = await wallet.callContract({
      callee: envChain.select(data.addressIts),
      funcName: "deployAndRegisterStandardizedToken",
      gasLimit: 300_000_000,
      value: BigInt('50000000000000000'), // 0.05 EGLD, to pay for ESDT issue cost
      funcArgs: [
        e.Str('SALT2'),
        e.Str('ITSToken'),
        e.Str('ITST'),
        e.U8(6),
        e.U(1_000_000),
        wallet,
      ],
    });

    console.log(`Result`, result);
  });

  program.command('itsInterchainTransfer')
    .argument('tokenId')
    .argument('tokenIdentifier')
    .argument('amount')
    .action(async (tokenId, tokenIdentifier, amount) => {
      const wallet = await loadWallet();

      const result = await wallet.callContract({
        callee: envChain.select(data.addressIts),
        funcName: "interchainTransfer",
        gasLimit: 20_000_000,
        value: tokenIdentifier === 'EGLD' ? BigInt(amount) : 0,
        funcArgs: [
          e.Bytes(tokenId),
          e.Str(otherChainName),
          e.Str(otherChainAddress),
          e.Buffer(''), // No metadata, uses default
        ],
        esdts: (tokenIdentifier !== 'EGLD' ? [{ id: tokenIdentifier, amount: BigInt(amount) }] : [])
      });

      console.log(`Result`, result);
    });

  const executePingPongPayload = (wallet: Wallet) => {
    return e.Buffer(
      e.Tuple(
        e.U(2), // selector receive token with data
        e.Bytes(envChain.select<any>(data.knownTokens)['EGLD']['tokenId']),
        e.Buffer(e.Addr(envChain.select(data.addressPingPongInterchain)).toTopBytes()), // destination address
        e.U(BigInt('10000000000000000')),
        e.Buffer(wallet.toTopBytes()), // source address (in this case address for ping)
        e.Buffer(
          e.Str("ping").toTopBytes() // data passed to contract
        )
      ).toTopBytes()
    );
  };

  program.command('itsExpressReceiveToken').action(async () => {
    const wallet = await loadWallet();

    const payload = executePingPongPayload(wallet);

    const result = await wallet.callContract({
      callee: envChain.select(data.addressIts),
      funcName: "expressReceiveToken",
      gasLimit: 100_000_000,
      value: BigInt('10000000000000000'),
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

    const payloadHash = createKeccakHash('keccak256').update(Buffer.from(payload.toTopHex(), 'hex')).digest('hex');

    const executeData = e.Tuple(
      e.List(e.Str('mockCommandId-1')),
      e.List(e.Str('approveContractCall')),
      e.List(
        e.Buffer(
          e.Tuple(
            e.Str(otherChainName),
            e.Str(otherChainAddress),
            e.Addr(envChain.select(data.addressIts)),
            e.Buffer(Buffer.from(payloadHash, 'hex'),),
            e.Str('sourceTxHash'),
            e.U(123) // source event index
          ).toTopBytes()
        )
      )
    );

    const { proof } = generateProof(executeData);

    const result = await wallet.callContract({
      callee: envChain.select(data.address),
      gasLimit: 15_000_000,
      funcName: 'execute',
      funcArgs: [
        executeData,
        proof
      ]
    });
    console.log('Result:', result);
  });

  program.command('itsExecuteReceiveTokenWithData').action(async () => {
    const wallet = await loadWallet();

    const payload = executePingPongPayload(wallet);

    const result = await wallet.callContract({
      callee: envChain.select(data.addressIts),
      funcName: "execute",
      gasLimit: 200_000_000,
      funcArgs: [
        e.Str('mockCommandId-1'),
        e.Str(otherChainName),
        e.Str(otherChainAddress),
        payload,
      ],
    });

    console.log(`Result`, result);
  });
}
