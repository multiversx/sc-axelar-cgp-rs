import { Command } from 'commander';
import { envChain } from 'xsuite/interact';
import { World } from 'xsuite/world';
// @ts-ignore
import data from './data.json';
import { e } from 'xsuite/data';
import {
  ALICE_PUB_KEY,
  BOB_PUB_KEY,
  generateProof,
  generateSignature,
  MOCK_CONTRACT_ADDRESS_2,
} from '../tests/helpers';
import { executeGateway } from './generateProofRaw';
import { setupITSCommands } from './its';

const world = World.new({
  proxyUrl: envChain.publicProxyUrl(),
  chainId: envChain.id(),
  gasPrice: 1000000000,
});

export const loadWallet = () => world.newWalletFromFile('wallet.json');

export const program = new Command();

setupITSCommands(program);

program.command('deploy').action(async () => {
  const wallet = await loadWallet();

  const recentOperator = e.Tuple(
    e.List(e.Addr(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(10),
  );
  const recent_operator2 = e.Tuple(
    e.List(e.Addr(ALICE_PUB_KEY), e.Addr(BOB_PUB_KEY)),
    e.List(e.U(10), e.U(2)),
    e.U(12),
  );

  const resultAuth = await wallet.deployContract({
    code: data.codeAuth,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      recentOperator, // Auth contract needs to be deployed with some recent operators!
      recent_operator2,
    ],
  });
  console.log('Result Auth:', resultAuth);

  const resultGateway = await wallet.deployContract({
    code: data.codeGateway,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(resultAuth.address),
      e.Str(envChain.select(data.chainId)),
    ],
  });
  console.log('Result:', resultGateway);

  // Change owner of auth contract to be gateway contract
  const resultChangeOwner = await wallet.callContract({
    callee: resultAuth.address,
    value: 0,
    gasLimit: 6_000_000,
    funcName: 'ChangeOwnerAddress',
    funcArgs: [e.Addr(resultGateway.address)],
  });
  console.log('Result Change Owner:', resultChangeOwner);

  // Deploy gas receiver
  const resultGasReceiver = await wallet.deployContract({
    code: data.codeGasReceiver,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(envChain.select(data.gasCollector)),
    ],
  });
  console.log('Result Gas Receiver:', resultGasReceiver);

  console.log('Deployed Auth Contract:', resultAuth.address);
  console.log('Deployed Gateway Contract:', resultGateway.address);
  console.log('Deployed Gas Receiver Contract:', resultGasReceiver.address);
});

program.command('upgrade').action(async () => {
  const wallet = await loadWallet();
  const result = await wallet.upgradeContract({
    callee: envChain.select(data.addressGateway),
    code: data.codeGateway,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      envChain.select(data.addressAuth),
      e.Str(envChain.select(data.chainId)),
    ],
  });
  console.log('Result:', result);
});

program.command('ClaimDeveloperRewards').action(async () => {
  const wallet = await loadWallet();
  const result = await wallet.callContract({
    callee: envChain.select(data.addressGateway),
    funcName: 'ClaimDeveloperRewards',
    gasLimit: 10_000_000,
  });
  console.log('Result:', result);
});

program.command('callContract').action(async () => {
  const wallet = await loadWallet();
  const result = await wallet.callContract({
    callee: envChain.select(data.addressGateway),
    funcName: 'callContract',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str('ethereum-2'),
      e.Bytes(Buffer.from('Fb7378D0997B0092bE6bBf278Ca9b8058C24752f', 'hex')),
      e.Bytes(Buffer.from(
        '095ea7b30000000000000000000000004a24b5268a5d286f1602a965ac72913b997858d50000000000000000000000000000000000000000000000000000000000000000',
        'hex',
      )),
    ],
  });
  console.log('Result:', result);
});

program.command('executeApproveContractCall').action(async () => {
  const wallet = await loadWallet();

  const executeData = e.Tuple(
    e.List(e.Str('commandId')),
    e.List(e.Str('approveContractCall')),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str('ethereum'),
          e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
          e.Addr(MOCK_CONTRACT_ADDRESS_2),
          e.Str('payloadHash'),
          e.Str('sourceTxHash'),
          e.U(123),
        ).toTopBytes(),
      ),
    ),
  );

  const proof = generateProof(executeData);

  const result = await wallet.callContract({
    callee: envChain.select(data.addressGateway),
    gasLimit: 15_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(executeData, proof),
    ],
  });
  console.log('Result:', result);
});

program.command('executeApproveContractCallRaw').action(async () => {
  const wallet = await loadWallet();

  const transaction = await executeGateway(
    'approveContractCall',
    'commandId',
    'ethereum',
    '0x4976da71bF84D750b5451B053051158EC0A4E876',
    MOCK_CONTRACT_ADDRESS_2,
    Buffer.from('payloadHash'),
    'sourceTxHash',
    123,
    wallet.toString(),
  );

  const result = await wallet.executeTx({
    receiver: envChain.select(data.addressGateway),
    gasLimit: 20_000_000,
    data: transaction.getData().toString(),
    value: 0,
  });
  console.log('Result:', result);
});

program.command('executeTransferOperatorship')
  .argument('[valid]', '', false)
  .action(async (valid: boolean = false) => {
    const wallet = await loadWallet();

    const executeData = e.Tuple(
      e.List(e.Str('commandIdExecute3')),
      e.List(e.Str('transferOperatorship')),
      e.List(
        e.Buffer(
          e.Tuple(
            e.List(e.Addr(BOB_PUB_KEY)),
            e.List(e.U(2)),
            e.U(2),
          ).toTopBytes(),
        ),
      ),
    );

    let proof;
    if (valid) {
      const signature = generateSignature(Buffer.from(executeData.toTopHex(), 'hex'));
      const signatureBob = generateSignature(Buffer.from(executeData.toTopHex(), 'hex'), './bob.pem');

      proof = e.Tuple(
        e.List(e.Addr(ALICE_PUB_KEY), e.Addr(BOB_PUB_KEY)),
        e.List(e.U(10), e.U(2)),
        e.U(12),
        e.List(e.Bytes(signature), e.Bytes(signatureBob)),
      );
    } else {
      proof = generateProof(executeData);
    }

    const result = await wallet.callContract({
      callee: envChain.select(data.addressGateway),
      gasLimit: 20_000_000,
      funcName: 'execute',
      funcArgs: [
        e.Tuple(executeData, proof),
      ],
    });
    console.log('Result:', result);
  });

program.parse(process.argv);
