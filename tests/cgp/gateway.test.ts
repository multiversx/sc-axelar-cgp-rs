import { afterEach, assert, beforeEach, test } from 'vitest';
import { assertAccount, e, SContract, SWallet, SWorld } from 'xsuite';
import createKeccakHash from 'keccak';
import {
  DOMAIN_SEPARATOR,
  COMMAND_ID,
  MOCK_CONTRACT_ADDRESS_1,
  MOCK_CONTRACT_ADDRESS_2,
  PAYLOAD_HASH,
  TOKEN_ID,
  TOKEN_ID2, ALICE_PUB_KEY, getKeccak256Hash, getSignersHash, ADDRESS_ZERO, BOB_PUB_KEY,
} from '../helpers';

let world: SWorld;
let deployer: SWallet;
let firstUser: SWallet;
let contract: SContract;
let address: string;

beforeEach(async () => {
  world = await SWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  });

  deployer = await world.createWallet({
    balance: 10_000_000_000n,
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 100_000,
        },
        {
          id: TOKEN_ID2,
          amount: 10_000,
        },
      ]),
    ],
  });
  firstUser = await world.createWallet();
});

afterEach(async () => {
  await world.terminate();
});

const baseKvs = () => {
  const signersHash = getSignersHash([{ signer: ALICE_PUB_KEY, weight: 10 }], 10, getKeccak256Hash('nonce1'));

  return [
    e.kvs.Mapper('previous_signers_retention').Value(e.U(16)),
    e.kvs.Mapper('domain_separator').Value(e.TopBuffer(DOMAIN_SEPARATOR)),
    e.kvs.Mapper('minimum_rotation_delay').Value(e.U64(3600)),

    e.kvs.Mapper('operator').Value(firstUser),
    e.kvs.Mapper('signer_hash_by_epoch', e.U(1)).Value(e.TopBuffer(signersHash)),
    e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(signersHash)).Value(e.U(1)),
    e.kvs.Mapper('epoch').Value(e.U(1)),
  ];
};

const deployContract = async () => {
  const weightedSigners = e.Tuple(
    e.List(e.Tuple(e.TopBuffer(ALICE_PUB_KEY), e.U(10))),
    e.U(10),
    e.TopBuffer(getKeccak256Hash('nonce1')),
  );

  ({ contract, address } = await deployer.deployContract({
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.U(16),
      e.TopBuffer(DOMAIN_SEPARATOR),
      e.U64(3600),
      firstUser,
      weightedSigners,
    ],
  }));

  assertAccount(await contract.getAccountWithKvs(), {
    balance: 0n,
    kvs: baseKvs(),
  });
};

test('Init', async () => {
  // With zero address and no signer
  ({ contract, address } = await deployer.deployContract({
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.U(16),
      e.TopBuffer(DOMAIN_SEPARATOR),
      e.U64(3600),
      e.Addr(ADDRESS_ZERO),
    ],
  }));

  assertAccount(await contract.getAccountWithKvs(), {
    balance: 0n,
    kvs: [
      e.kvs.Mapper('previous_signers_retention').Value(e.U(16)),
      e.kvs.Mapper('domain_separator').Value(e.TopBuffer(DOMAIN_SEPARATOR)),
      e.kvs.Mapper('minimum_rotation_delay').Value(e.U64(3600)),
    ],
  });
});

test('Upgrade', async () => {
  await deployContract();

  // Upgrade with no operator and no signers
  await deployer.upgradeContract({
    callee: contract,
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(ADDRESS_ZERO),
    ],
  });

  assertAccount(await contract.getAccountWithKvs(), {
    balance: 0n,
    kvs: baseKvs(),
  });

  const weightedSigners = e.Tuple(
    e.List(e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(5))),
    e.U(5),
    e.TopBuffer(getKeccak256Hash('nonce2')),
  );

  // Upgrade with new operator and new signers
  await deployer.upgradeContract({
    callee: contract,
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
      weightedSigners,
    ],
  });

  const signersHash = getSignersHash([{ signer: BOB_PUB_KEY, weight: 5 }], 5, getKeccak256Hash('nonce2'));

  assertAccount(await contract.getAccountWithKvs(), {
    balance: 0n,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('signer_hash_by_epoch', e.U(2)).Value(e.TopBuffer(signersHash)),
      e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(signersHash)).Value(e.U(2)),
      e.kvs.Mapper('epoch').Value(e.U(2)),
    ],
  });
});

test('Call contract', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'callContract',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      e.Str('payload'),
    ],
  });

  // This only emits an event, and there is no way to test those currently...
  assertAccount(await contract.getAccountWithKvs(), {
    balance: 0,
    kvs: baseKvs(),
  });
});

test('Validate message invalid', async () => {
  await deployContract();

  const result = await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateMessage',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('messageId'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      e.TopBuffer(PAYLOAD_HASH),
    ],
  });
  assert(result.returnData[0] === '');

  assertAccount(await contract.getAccountWithKvs(), {
    balance: 0,
    kvs: baseKvs(),
  });
});

test('Validate message valid', async () => {
  await deployContract();

  const messageData = Buffer.concat([
    Buffer.from('ethereum'),
    Buffer.from('messageId'),
    Buffer.from('0x4976da71bF84D750b5451B053051158EC0A4E876'),
    deployer.toTopU8A(),
    Buffer.from(PAYLOAD_HASH, 'hex'),
  ]);
  const messageHash = getKeccak256Hash(messageData);

  const command_id = getKeccak256Hash('ethereum_messageId');

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ['payable'],
    kvs: [
      ...baseKvs(),

      // Manually approve message
      e.kvs.Mapper('messages', e.TopBuffer(command_id)).Value(e.TopBuffer(messageHash)),
    ],
  });

  const result = await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateMessage',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('messageId'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      e.TopBuffer(PAYLOAD_HASH),
    ],
  });
  assert(result.returnData[0] === '01');

  assertAccount(await contract.getAccountWithKvs(), {
    balance: 0,
    kvs: [
      ...baseKvs(),

      // Message was executed
      e.kvs.Mapper('messages', e.TopBuffer(command_id)).Value(e.Str('1')),
    ],
  });
});
