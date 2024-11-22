import { Command } from 'commander';
import { envChain } from 'xsuite/interact';
import { World } from 'xsuite/world';
// @ts-ignore
import data from './data.json';
import { d, e } from 'xsuite/data';
import {
  ALICE_PUB_KEY,
  BOB_PUB_KEY,
  CAROL_PUB_KEY,
  generateMessageSignature,
  generateProof, generateRotateSignersSignature,
  getKeccak256Hash,
  getSignersHashAndEncodable,
  MOCK_CONTRACT_ADDRESS_2,
} from '../tests/helpers';
import { setupITSCommands } from './its';
import { Buffer } from 'buffer';
import { setupTestCommands } from './test';

export const world = World.new({
  proxyUrl: envChain.publicProxyUrl(),
  chainId: envChain.id(),
  gasPrice: 1000000000,
});

export const loadWallet = () => world.newWalletFromFile('wallet.json');

export const program = new Command();

setupITSCommands(program);
setupTestCommands(program);

export const [firstSigners, firstSignersHash] = getSignersHashAndEncodable(
  [
    { signer: ALICE_PUB_KEY, weight: 10 },
  ],
  10,
  0,
);

const [latestSigners, latestSignersHash] = getSignersHashAndEncodable(
  [
    { signer: ALICE_PUB_KEY, weight: 5 },
    { signer: BOB_PUB_KEY, weight: 6 },
    { signer: CAROL_PUB_KEY, weight: 7 },
  ],
  10,
  1,
);

program.command('deploy').action(async () => {
  const wallet = await loadWallet();

  const resultGateway = await wallet.deployContract({
    code: data.codeGateway,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.U(16),
      e.TopBuffer(envChain.select(data.domainSeparator)),
      e.U64(3600),
      wallet,
      firstSigners,
      latestSigners,
    ],
  });
  console.log('Result Gateway:', resultGateway);

  // Deploy gas service
  const resultGasService = await wallet.deployContract({
    code: data.codeGasService,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(envChain.select(data.gasCollector)),
    ],
  });
  console.log('Result Gas Service:', resultGasService);

  console.log('Deployed Gateway Contract:', resultGateway.address);
  console.log('Deployed Gas Service Contract:', resultGasService.address);
});

program.command('deployGovernance').action(async () => {
  const wallet = await loadWallet();

  const resultGovernance = await wallet.deployContract({
    code: data.codeGovernance,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(envChain.select(data.addressGateway)),
      e.Str(envChain.select(data.governance.chain)),
      e.Str(envChain.select(data.governance.address)),
      e.U64(envChain.select(data.governance.minimumTimeDelay)),
    ],
  });
  console.log('Result Governance:', resultGovernance);

  // Change owner of gateway contract to be governance contract
  const resultChangeOwner = await wallet.callContract({
    callee: e.Addr(envChain.select(data.addressGateway)),
    value: 0,
    gasLimit: 6_000_000,
    funcName: 'ChangeOwnerAddress',
    funcArgs: [e.Addr(resultGovernance.address)],
  });
  console.log('Result Change Owner Gateway:', resultChangeOwner);

  // Change owner of governance contract to be itself
  const resultChangeOwnerGovernance = await wallet.callContract({
    callee: resultGovernance.address,
    value: 0,
    gasLimit: 6_000_000,
    funcName: 'ChangeOwnerAddress',
    funcArgs: [e.Addr(resultGovernance.address)],
  });
  console.log('Result Change Owner Governance:', resultChangeOwnerGovernance);

  console.log('Deployed Governance Contract:', resultGovernance.address);
});

program.command('upgrade').action(async () => {
  const wallet = await loadWallet();

  let result = await wallet.upgradeContract({
    callee: envChain.select(data.addressGasService),
    code: data.codeGasService,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [],
  });
  console.log('Result Gas Service:', result);

  result = await wallet.upgradeContract({
    callee: envChain.select(data.addressGateway),
    code: data.codeGateway,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [],
  });
  console.log('Result Gateway:', result);
});

program.command('callContract').action(async () => {
  const wallet = await loadWallet();
  const result = await wallet.callContract({
    callee: envChain.select(data.addressGateway),
    funcName: 'callContract',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str('ethereum-2'),
      e.Str('0xFb7378D0997B0092bE6bBf278Ca9b8058C24752f'),
      e.TopBuffer(Buffer.from(
        '095ea7b30000000000000000000000004a24b5268a5d286f1602a965ac72913b997858d50000000000000000000000000000000000000000000000000000000000000000',
        'hex',
      )),
    ],
  });
  console.log('Result:', result);
});

program.command('approveMessages').action(async () => {
  const wallet = await loadWallet();

  const message = e.Tuple(
    e.Str('ethereum'),
    e.Str('messageId'),
    e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
    e.Addr(MOCK_CONTRACT_ADDRESS_2),
    e.TopBuffer(getKeccak256Hash('payloadHash')),
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

program.command('rotateSigners')
  .argument('[valid]', '', false)
  .action(async (latest: boolean = false) => {
    const wallet = await loadWallet();

    const createdAt = 2055833;

    // This should be changed to a new value if we want the transaction to actually succeed
    const [newSigners, newSignersHash] = getSignersHashAndEncodable(
      [
        { signer: '0657816ab49e697cf1573c442eb93ffb470bfff7bbae6fc3151de5ce2373700e', weight: 1 },
        { signer: '2c61dd97791628ef5570f4eb96c458f8b07604580e99c431fe1ee4f8e3507525', weight: 1 },
        { signer: '2ea16de592f6c6ca0593c9f0e4f3bb754ccc0d35fe40b56b4edd43bb29abe61d', weight: 1 },
      ],
      2,
      createdAt,
    );

    let proof;
    if (latest) {
      proof = generateProof(
        latestSigners, [
          generateRotateSignersSignature(latestSignersHash, newSigners),
          generateRotateSignersSignature(latestSignersHash, newSigners, './bob.pem'),
          null,
        ],
      );
    } else {
      // Operator (wallet) can still rotate signers anyway
      proof = generateProof(
        firstSigners, [
          generateRotateSignersSignature(firstSignersHash, newSigners),
        ],
      );
    }

    const result = await wallet.callContract({
      callee: envChain.select(data.addressGateway),
      gasLimit: 20_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newSigners,
        proof,
      ],
    });
    console.log('Result:', result);
  });

program.command('isMessageApproved')
  .action(async () => {
    const result = await world.query({
      callee: e.Addr(envChain.select(data.addressGateway)),
      funcName: 'isMessageApproved',
      funcArgs: [
        e.Str('ethereum'),
        e.Str('messageId'),
        e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
        e.Addr(MOCK_CONTRACT_ADDRESS_2),
        e.TopBuffer(getKeccak256Hash('payloadHash')),
      ],
    });
    console.log('Result:', d.Bool().fromTop(result.returnData[0]));
  });

program.command('isMessageExecuted')
  .action(async () => {
    const result = await world.query({
      callee: e.Addr(envChain.select(data.addressGateway)),
      funcName: 'isMessageExecuted',
      funcArgs: [
        e.Str('ethereum'),
        e.Str('messageId'),
      ],
    });
    console.log('Result:', d.Bool().topDecode(result.returnData[0]));
  });

program.parse(process.argv);
