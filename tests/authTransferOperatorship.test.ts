import { afterEach, beforeEach, test } from "vitest";
import { assertAccount } from "xsuite/assert";
import { FWorld, FWorldContract, FWorldWallet } from "xsuite/world";
import { e } from "xsuite/data";
import { ALICE_ADDR, BOB_ADDR, getOperatorsHash } from './helpers';

let world: FWorld;
let deployer: FWorldWallet;
let contract: FWorldContract;
let address: string;

beforeEach(async () => {
  world = await FWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  })

  deployer = await world.createWallet({
    balance: 10_000_000_000n,
  });
});

afterEach(async () => {
  await world.terminate();
});

const deployContract = async () => {
  ({ contract, address } = await deployer.deployContract({
    code: "file:auth/output/auth.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: []
  }));

  const pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0n,
    allPairs: [],
  });
}

test("Transfer operatorship not owner", async () => {
  await deployContract();

  const otherWallet = await world.createWallet();

  const data = e.Tuple(
    e.List(e.Addr(ALICE_ADDR)),
    e.List(e.U(10)),
    e.U(10),
  );

  await otherWallet.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "transferOperatorship",
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' });
});

test("Transfer operatorship invalid operators none", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(),
    e.List(e.U(10)),
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "transferOperatorship",
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid operators' });
});

test("Transfer operatorship invalid operators duplicate", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Addr(ALICE_ADDR), e.Addr(ALICE_ADDR)),
    e.List(e.U(10)),
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "transferOperatorship",
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid operators' });
});

test("Transfer operatorship invalid weights", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Addr(ALICE_ADDR)),
    e.List(), // not enough weights
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "transferOperatorship",
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid weights' });
});

test("Transfer operatorship invalid threshold zero", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Addr(ALICE_ADDR)),
    e.List(e.U(10)),
    e.U(0),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "transferOperatorship",
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid threshold' });
});

test("Transfer operatorship invalid threshold less", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Addr(ALICE_ADDR)),
    e.List(e.U(10)),
    e.U(11),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "transferOperatorship",
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Invalid threshold' });
});

test("Transfer operatorship duplicate operators", async () => {
  await deployContract();

  const operatorsHash = getOperatorsHash([ALICE_ADDR], [10], 10);
  await contract.setAccount({
    ...await contract.getAccount(),
    owner: deployer,
    pairs: [
      // Manually add epoch for hash & current epoch
      e.p.Mapper("epoch_for_hash", e.Bytes(operatorsHash)).Value(e.U64(1)),
    ]
  });

  const data = e.Tuple(
    e.List(e.Addr(ALICE_ADDR)),
    e.List(e.U(10)),
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "transferOperatorship",
    funcArgs: [
      data,
    ],
  }).assertFail({ code: 4, message: 'Duplicate operators' });
});

test("Transfer operatorship", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Addr(ALICE_ADDR)),
    e.List(e.U(10)),
    e.U(10),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "transferOperatorship",
    funcArgs: [
      data,
    ],
  });

  const operatorsHash = getOperatorsHash([ALICE_ADDR], [10], 10);

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("hash_for_epoch", e.U64(1)).Value(e.Bytes(operatorsHash)),

      e.p.Mapper("epoch_for_hash", e.Bytes(operatorsHash)).Value(e.U64(1)),

      e.p.Mapper("current_epoch").Value(e.U64(1)),
    ],
  });
});

test("Deploy with recent operators", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Addr(ALICE_ADDR)),
    e.List(e.U(10)),
    e.U(10),
  );
  const data2 = e.Tuple(
    e.List(e.Addr(ALICE_ADDR), e.Addr(BOB_ADDR)),
    e.List(e.U(10), e.U(2)),
    e.U(12),
  );

  ({ contract, address } = await deployer.deployContract({
    code: "file:auth/output/auth.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      data,
      data2,
    ],
  }));

  const operatorsHash = getOperatorsHash([ALICE_ADDR], [10], 10);
  const operatorsHash2 = getOperatorsHash([ALICE_ADDR, BOB_ADDR], [10, 2], 12);

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      // epoch 1
      e.p.Mapper("hash_for_epoch", e.U64(1)).Value(e.Bytes(operatorsHash)),
      e.p.Mapper("epoch_for_hash", e.Bytes(operatorsHash)).Value(e.U64(1)),

      // epoch 2
      e.p.Mapper("hash_for_epoch", e.U64(2)).Value(e.Bytes(operatorsHash2)),
      e.p.Mapper("epoch_for_hash", e.Bytes(operatorsHash2)).Value(e.U64(2)),

      e.p.Mapper("current_epoch").Value(e.U64(2)),
    ],
  });
});