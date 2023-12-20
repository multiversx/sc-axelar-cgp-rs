import { afterEach, assert, beforeEach, test } from 'vitest';
import { assertAccount, e, SContract, SWallet, SWorld } from 'xsuite';
import {
  ALICE_PUB_KEY,
  BOB_PUB_KEY,
  COMMAND_ID,
  generateMessageHash,
  generateSignature,
  getOperatorsHash,
  MULTISIG_PROVER_PUB_KEY_1,
  MULTISIG_PROVER_PUB_KEY_2,
} from '../helpers';

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

const getHashAndProof = () => {
  const signature = generateSignature(Buffer.from('hash'));
  const data = e.Tuple(
    e.List(e.TopBuffer(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(10),
    e.List(e.TopBuffer(signature)),
  );

  const hash = generateMessageHash(Buffer.from('hash'));

  return { hash: e.TopBuffer(hash), data };
};

test('Validate proof no epoch', async () => {
  await deployContract();

  const { hash, data } = getHashAndProof();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      hash,
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid operators' });
});

test('Validate proof old epoch', async () => {
  await deployContract();

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY], [10], 10);
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(17)),
    ],
  });

  const { hash, data } = getHashAndProof();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      hash,
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid operators' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(17)),
    ],
  });
});

test('Validate proof wrong operators weight', async () => {
  await deployContract();

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY], [10], 10);
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });

  const signature = generateSignature(Buffer.from('wrongHash'));
  const data = e.Tuple(
    e.List(e.TopBuffer(ALICE_PUB_KEY)),
    e.List(e.U(9)), // Wrong weight here
    e.U(10),
    e.List(e.TopBuffer(signature)),
  );
  const hash = generateMessageHash(Buffer.from('hash'));

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      e.TopBuffer(hash),
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid operators' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });
});

test('Validate proof invalid signature', async () => {
  await deployContract();

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY], [10], 10);
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });

  const signature = generateSignature(Buffer.from('wrongHash'));
  const data = e.Tuple(
    e.List(e.TopBuffer(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(10),
    e.List(e.TopBuffer(signature)),
  );
  const hash = generateMessageHash(Buffer.from('hash'));

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      e.TopBuffer(hash),
      data,
    ],
  }).assertFail({ code: 10, message: 'invalid signature' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });
});

test('Validate proof operators repeat', async () => {
  await deployContract();

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY, ALICE_PUB_KEY], [10, 10], 20);
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });

  const signature = generateSignature(Buffer.from('hash'));
  const data = e.Tuple(
    e.List(e.TopBuffer(ALICE_PUB_KEY), e.TopBuffer(ALICE_PUB_KEY)),
    e.List(e.U(10), e.U(10)),
    e.U(20),
    e.List(e.TopBuffer(signature), e.TopBuffer(signature)),
  );
  const hash = generateMessageHash(Buffer.from('hash'));

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      e.TopBuffer(hash),
      data,
    ],
  }).assertFail({ code: 4, message: 'Malformed signers' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });
});

test('Validate proof low signatures weight', async () => {
  await deployContract();

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY], [9], 10);
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });

  const signature = generateSignature(Buffer.from('hash'));
  const data = e.Tuple(
    e.List(e.TopBuffer(ALICE_PUB_KEY)),
    e.List(e.U(9)),
    e.U(10),
    e.List(e.TopBuffer(signature)),
  );
  const hash = generateMessageHash(Buffer.from('hash'));

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      e.TopBuffer(hash),
      data,
    ],
  }).assertFail({ code: 4, message: 'Low signatures weight' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });
});

test('Validate proof only first operator checked', async () => {
  await deployContract();

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY, BOB_PUB_KEY], [10, 10], 10);
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(1)),
    ],
  });

  const signature = generateSignature(Buffer.from('hash'));
  const data = e.Tuple(
    e.List(e.TopBuffer(ALICE_PUB_KEY), e.TopBuffer(BOB_PUB_KEY)),
    e.List(e.U(10), e.U(10)),
    e.U(10),
    e.List(e.TopBuffer(signature), e.TopBuffer(signature)), // wrong signature for bob will not be checked
  );
  const hash = generateMessageHash(Buffer.from('hash'));

  const result = await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      e.TopBuffer(hash),
      data,
    ],
  });
  assert(result.returnData[0] === '01');

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(1)),
    ],
  });
});

test('Validate proof', async () => {
  await deployContract();

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY, BOB_PUB_KEY], [10, 10], 20);
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });

  const signatureData = Buffer.from(COMMAND_ID, 'hex');
  const signature = generateSignature(signatureData);
  const signatureBob = generateSignature(signatureData, './bob.pem');
  const data = e.Tuple(
    e.List(e.TopBuffer(ALICE_PUB_KEY), e.TopBuffer(BOB_PUB_KEY)),
    e.List(e.U(10), e.U(10)),
    e.U(20),
    e.List(e.TopBuffer(signature), e.TopBuffer(signatureBob)),
  );
  const hash = generateMessageHash(signatureData);

  const result = await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      e.TopBuffer(hash),
      data,
    ],
  });
  assert(result.returnData[0] === '');

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });
});

test('Validate proof with multisig prover encoded proof', async () => {
  await deployContract();

  const operatorsHash = getOperatorsHash([MULTISIG_PROVER_PUB_KEY_1, MULTISIG_PROVER_PUB_KEY_2], [10, 10], 10);
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });

  // 00000002 - length of operators
  // ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b6 - first operator public key
  // ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a4449 - second operator public key
  // 00000002 - length of weigths
  // 00000001 0a - length of biguint weight followed by 10 as hex
  // 00000001 0a
  // 00000001 0a - length of biguint threshold followed by 10 as hex
  // 00000002 - length of signatures
  // fdae22df86f53a39985674072ed1442d08a66683e464134b8d17e373a07e8b82137b96087fa7bbbd2764c4e7658564c32480b2bb31ba70c1225350724494e507 - first signature
  // b054d00827810f8384b85c88352dabf81dcc9be76a77617df942e8bd65ca15fadaef5941a0022f29d86fa5bd33c7fc593580930e521e337544716b5901f8810f - second signature
  const data = Buffer.from(
    '00000002ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b6ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a444900000002000000010a000000010a000000010a00000002fdae22df86f53a39985674072ed1442d08a66683e464134b8d17e373a07e8b82137b96087fa7bbbd2764c4e7658564c32480b2bb31ba70c1225350724494e507b054d00827810f8384b85c88352dabf81dcc9be76a77617df942e8bd65ca15fadaef5941a0022f29d86fa5bd33c7fc593580930e521e337544716b5901f8810f',
    'hex',
  );

  const messageHash = Buffer.from('84219fac907aad564fe5f1af58993d1c3f8f288af30b8bff5b50ffb5bba96bc0', 'hex');

  // Signature is invalid because we use mock public keys, but we test if decoding of the raw data works properly
  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      e.TopBuffer(messageHash),
      e.TopBuffer(data)
    ],
  }).assertFail({ code: 10, message: 'invalid signature' });
});
