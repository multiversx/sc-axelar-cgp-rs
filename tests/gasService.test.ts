import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, SContract, SWallet, SWorld } from 'xsuite';
import { TOKEN_ID } from './helpers';

let world: SWorld;
let deployer: SWallet;
let collector: SWallet;
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
      ]),
    ],
  });

  collector = await world.createWallet();
});

afterEach(async () => {
  await world.terminate();
});

const deployContract = async () => {
  ({ contract, address } = await deployer.deployContract({
    code: 'file:gas-service/output/gas-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(collector.toString()),
    ],
  }));

  const pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
};

test('Pay gas for contract call no esdts', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'payGasForContractCall',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'incorrect number of ESDT transfers' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Pay gas for contract call', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'payGasForContractCall',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
    esdts: [
      { id: TOKEN_ID, amount: 1_000 },
    ],
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 1_000,
        },
      ]),
    ],
  });
});

test('Pay native gas for contract call no value', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'payNativeGasForContractCall',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'Nothing received' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Pay native gas for contract call', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'payNativeGasForContractCall',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
    value: 1_000,
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 1_000,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Pay gas for express contract call no esdts', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'payGasForExpressCall',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'incorrect number of ESDT transfers' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Pay gas for express contract call', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'payGasForExpressCall',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
    esdts: [
      { id: TOKEN_ID, amount: 1_000 },
    ],
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 1_000,
        },
      ]),
    ],
  });
});

test('Pay native gas for express contract call no value', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'payNativeGasForExpressCall',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'Nothing received' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Pay native gas for express contract call', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'payNativeGasForExpressCall',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
    value: 1_000,
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 1_000,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Add gas no esdts', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'addGas',
    funcArgs: [
      e.Str('txHash'),
      e.U(10),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'incorrect number of ESDT transfers' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Add gas', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'addGas',
    funcArgs: [
      e.Str('txHash'),
      e.U(10),
      e.Addr(deployer.toString()),
    ],
    esdts: [
      { id: TOKEN_ID, amount: 1_000 },
    ],
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 1_000,
        },
      ]),
    ],
  });
});

test('Add native gas no value', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'addNativeGas',
    funcArgs: [
      e.Str('txHash'),
      e.U(10),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'Nothing received' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Add native gas', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'addNativeGas',
    funcArgs: [
      e.Str('txHash'),
      e.U(10),
      e.Addr(deployer.toString()),
    ],
    value: 1_000,
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 1_000,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Add express gas no esdts', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'addExpressGas',
    funcArgs: [
      e.Str('txHash'),
      e.U(10),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'incorrect number of ESDT transfers' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Add express gas', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'addExpressGas',
    funcArgs: [
      e.Str('txHash'),
      e.U(10),
      e.Addr(deployer.toString()),
    ],
    esdts: [
      { id: TOKEN_ID, amount: 1_000 },
    ],
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 1_000,
        },
      ]),
    ],
  });
});

test('Add native express gas no value', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'addNativeExpressGas',
    funcArgs: [
      e.Str('txHash'),
      e.U(10),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'Nothing received' });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Add native express gas', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'addNativeExpressGas',
    funcArgs: [
      e.Str('txHash'),
      e.U(10),
      e.Addr(deployer.toString()),
    ],
    value: 1_000,
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 1_000,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test('Collect fees not collector', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'collectFees',
    funcArgs: [
      e.Addr(deployer.toString()),

      e.U32(1),
      e.Str(TOKEN_ID),

      e.U32(1),
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Not collector' });
});

test('Collect fees invalid address', async () => {
  await deployContract();

  await collector.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'collectFees',
    funcArgs: [
      e.Bytes('0000000000000000000000000000000000000000000000000000000000000000'),

      e.U32(1),
      e.Str(TOKEN_ID),

      e.U32(1),
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Invalid address' });
});

test('Collect fees invalid amounts wrong length', async () => {
  await deployContract();

  await collector.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'collectFees',
    funcArgs: [
      e.Addr(deployer.toString()),

      e.U32(1),
      e.Str(TOKEN_ID),

      e.U32(2),
      e.U(1_000),
      e.U(2_000),
    ],
  }).assertFail({ code: 4, message: 'Invalid amounts' });
});

test('Collect fees invalid amounts zero', async () => {
  await deployContract();

  await collector.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'collectFees',
    funcArgs: [
      e.Addr(deployer.toString()),

      e.U32(1),
      e.Str(TOKEN_ID),

      e.U32(1),
      e.U(0),
    ],
  }).assertFail({ code: 4, message: 'Invalid amounts' });
});

test('Collect fees', async () => {
  await deployContract();

  await contract.setAccount({
    ...(await contract.getAccount()),
    balance: 2_000,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 1_000,
        },
      ]),
    ],
  });

  await collector.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'collectFees',
    funcArgs: [
      e.Addr(deployer.toString()),

      e.U32(2),
      e.Str(TOKEN_ID),
      e.Str('EGLD'),

      e.U32(2),
      e.U(1_000),
      e.U(2_000),
    ],
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  let pairsDeployer = await deployer.getAccountWithKvs();
  assertAccount(pairsDeployer, {
    balance: 10_000_002_000n,
    allKvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 101_000,
        },
      ]),
    ],
  });
});

test('Collect fees too much asked', async () => {
  await deployContract();

  await contract.setAccount({
    ...(await contract.getAccount()),
    balance: 2_000,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 1_000,
        },
      ]),
    ],
  });

  await collector.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'collectFees',
    funcArgs: [
      e.Addr(deployer.toString()),

      e.U32(2),
      e.Str(TOKEN_ID),
      e.Str('EGLD'),

      e.U32(2),
      e.U(10_000), // Higher than balance so will do nothing
      e.U(20_000),
    ],
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 2_000,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 1_000,
        },
      ]),
    ],
  });
});

test('Refund not collector', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'refund',
    funcArgs: [
      e.Str('txHash'),
      e.U(1),
      e.Addr(deployer.toString()),
      e.Str(TOKEN_ID),
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Not collector' });
});

test('Refund invalid address', async () => {
  await deployContract();

  await collector.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'refund',
    funcArgs: [
      e.Str('txHash'),
      e.U(1),
      e.Bytes('0000000000000000000000000000000000000000000000000000000000000000'),
      e.Str(TOKEN_ID),
      e.U(1_000),
    ],
  }).assertFail({ code: 4, message: 'Invalid address' });
});

test('Refund egld', async () => {
  await deployContract();

  await contract.setAccount({
    ...(await contract.getAccount()),
    balance: 2_000,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  await collector.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'refund',
    funcArgs: [
      e.Str('txHash'),
      e.U(1),
      e.Addr(deployer.toString()),
      e.Str('EGLD'),
      e.U(500),
    ],
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 1_500,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  let pairsDeployer = await deployer.getAccountWithKvs();
  assertAccount(pairsDeployer, {
    balance: 10_000_000_500,
  });
});

test('Refund esdt', async () => {
  await deployContract();

  await contract.setAccount({
    ...(await contract.getAccount()),
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 2_000,
        },
      ]),
    ],
  });

  await collector.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'refund',
    funcArgs: [
      e.Str('txHash'),
      e.U(1),
      e.Addr(deployer.toString()),
      e.Str(TOKEN_ID),
      e.U(500),
    ],
  });

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 1_500,
        },
      ]),
    ],
  });

  let pairsDeployer = await deployer.getAccountWithKvs();
  assertAccount(pairsDeployer, {
    balance: 10_000_000_000,
    allKvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 100_500,
        },
      ]),
    ],
  });
});
