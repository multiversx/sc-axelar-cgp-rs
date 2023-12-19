import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, SContract, SWallet, SWorld } from 'xsuite';
import { ALICE_PUB_KEY, BOB_PUB_KEY, getOperatorsHash, MOCK_PUB_KEY_1, MOCK_PUB_KEY_2 } from './helpers';

let world: SWorld;
let deployer: SWallet;
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
  });
});

afterEach(async () => {
  await world.terminate();
});

const deployContract = async () => {
  ({ contract, address } = await deployer.deployContract({
    code: 'file:auth/output/auth.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [],
  }));

  const pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0n,
    allKvs: [],
  });
};

test('Transfer operatorship not owner', async () => {
  await deployContract();

  const otherWallet = await world.createWallet();

  const data = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(10),
  );

  await otherWallet.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'transferOperatorship',
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' });
});

test('Transfer operatorship invalid operators none', async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(),
    e.List(e.U(10)),
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'transferOperatorship',
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid operators' });
});

test('Transfer operatorship invalid operators duplicate', async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY), e.Bytes(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'transferOperatorship',
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid operators' });
});

test('Transfer operatorship invalid operators duplicate 2', async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(
      e.Bytes(ALICE_PUB_KEY),
      e.Bytes(BOB_PUB_KEY),
      e.Bytes(MOCK_PUB_KEY_1),
      e.Bytes(BOB_PUB_KEY),
      e.Bytes(MOCK_PUB_KEY_2),
    ),
    e.List(e.U(10)),
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'transferOperatorship',
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid operators' });
});

test('Transfer operatorship invalid weights', async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY)),
    e.List(), // not enough weights
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'transferOperatorship',
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid weights' });
});

test('Transfer operatorship invalid threshold zero', async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(0),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'transferOperatorship',
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid threshold' });
});

test('Transfer operatorship invalid threshold less', async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(11),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'transferOperatorship',
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid threshold' });
});

test('Transfer operatorship duplicate operators', async () => {
  await deployContract();

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY], [10], 10);
  await contract.setAccount({
    ...await contract.getAccount(),
    owner: deployer,
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.Bytes(operatorsHash)).Value(e.U64(1)),
    ],
  });

  const data = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'transferOperatorship',
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Duplicate operators' });
});

test('Transfer operatorship', async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'transferOperatorship',
    funcArgs: [
      data,
    ],
  });

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY], [10], 10);

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('hash_for_epoch', e.U64(1)).Value(e.Bytes(operatorsHash)),

      e.kvs.Mapper('epoch_for_hash', e.Bytes(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(1)),
    ],
  });
});

test('Deploy with recent operators', async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(10),
  );
  const data2 = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY), e.Bytes(BOB_PUB_KEY)),
    e.List(e.U(10), e.U(2)),
    e.U(12),
  );

  ({ contract, address } = await deployer.deployContract({
    code: 'file:auth/output/auth.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      data,
      data2,
    ],
  }));

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY], [10], 10);
  const operatorsHash2 = getOperatorsHash([ALICE_PUB_KEY, BOB_PUB_KEY], [10, 2], 12);

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      // epoch 1
      e.kvs.Mapper('hash_for_epoch', e.U64(1)).Value(e.Bytes(operatorsHash)),
      e.kvs.Mapper('epoch_for_hash', e.Bytes(operatorsHash)).Value(e.U64(1)),

      // epoch 2
      e.kvs.Mapper('hash_for_epoch', e.U64(2)).Value(e.Bytes(operatorsHash2)),
      e.kvs.Mapper('epoch_for_hash', e.Bytes(operatorsHash2)).Value(e.U64(2)),

      e.kvs.Mapper('current_epoch').Value(e.U64(2)),
    ],
  });
});
