import { afterEach, beforeEach, test } from 'vitest';
import { assertAccount, e, LSContract, LSWallet, LSWorld } from 'xsuite';
import { TOKEN_IDENTIFIER } from '../helpers';

let world: LSWorld;
let deployer: LSWallet;
let collector: LSWallet;
let contract: LSContract;
let address: string;

beforeEach(async () => {
  world = await LSWorld.start();
  await world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  });

  deployer = await world.createWallet({
    balance: 10_000_000_000n,
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_IDENTIFIER,
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
      collector,
    ],
  }));

  const pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0n,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(collector),
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
      deployer,
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'incorrect number of ESDT transfers' });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
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
      deployer,
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
    esdts: [
      { id: TOKEN_IDENTIFIER, amount: 1_000 },
    ],
  });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_IDENTIFIER,
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
      deployer,
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'Nothing received' });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
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
      deployer,
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
    value: 1_000,
  });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 1_000,
    kvs: [
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
      deployer,
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'incorrect number of ESDT transfers' });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
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
      deployer,
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
    esdts: [
      { id: TOKEN_IDENTIFIER, amount: 1_000 },
    ],
  });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_IDENTIFIER,
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
      deployer,
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
  }).assertFail({ code: 4, message: 'Nothing received' });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
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
      deployer,
      e.Str('ethereum'),
      e.Str('mockAddress'),
      e.Str('payload'),
      e.Addr(deployer.toString()),
    ],
    value: 1_000,
  });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 1_000,
    kvs: [
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

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
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
      { id: TOKEN_IDENTIFIER, amount: 1_000 },
    ],
  });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_IDENTIFIER,
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

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
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

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 1_000,
    kvs: [
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

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
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
      { id: TOKEN_IDENTIFIER, amount: 1_000 },
    ],
  });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_IDENTIFIER,
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

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
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

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 1_000,
    kvs: [
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
      e.Str(TOKEN_IDENTIFIER),

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
      e.TopBuffer('0000000000000000000000000000000000000000000000000000000000000000'),

      e.U32(1),
      e.Str(TOKEN_IDENTIFIER),

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
      e.Str(TOKEN_IDENTIFIER),

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
      e.Str(TOKEN_IDENTIFIER),

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
          id: TOKEN_IDENTIFIER,
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
      e.Str(TOKEN_IDENTIFIER),
      e.Str('EGLD'),

      e.U32(2),
      e.U(1_000),
      e.U(2_000),
    ],
  });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  let pairsDeployer = await deployer.getAccount();
  assertAccount(pairsDeployer, {
    balance: 10_000_002_000n,
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_IDENTIFIER,
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
          id: TOKEN_IDENTIFIER,
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

      e.U32(3),
      e.Str(TOKEN_IDENTIFIER),
      e.Str(TOKEN_IDENTIFIER),
      e.Str('EGLD'),

      e.U32(3),
      e.U(750),
      e.U(750), // Higher than remaining balance, will be ignored
      e.U(20_000),
    ],
  });

  await collector.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'collectFees',
    funcArgs: [
      e.Addr(deployer.toString()),

      e.U32(2),
      e.Str(TOKEN_IDENTIFIER),
      e.Str('EGLD'),

      e.U32(2),
      e.U(10_000), // Higher than balance so will do nothing
      e.U(20_000),
    ],
  });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 2_000,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_IDENTIFIER,
          amount: 250,
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
      e.Str(TOKEN_IDENTIFIER),
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
      e.TopBuffer('0000000000000000000000000000000000000000000000000000000000000000'),
      e.Str(TOKEN_IDENTIFIER),
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

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 1_500,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  let pairsDeployer = await deployer.getAccount();
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
          id: TOKEN_IDENTIFIER,
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
      e.Str(TOKEN_IDENTIFIER),
      e.U(500),
    ],
  });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    kvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),

      e.kvs.Esdts([
        {
          id: TOKEN_IDENTIFIER,
          amount: 1_500,
        },
      ]),
    ],
  });

  let pairsDeployer = await deployer.getAccount();
  assertAccount(pairsDeployer, {
    balance: 10_000_000_000,
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_IDENTIFIER,
          amount: 100_500,
        },
      ]),
    ],
  });
});

test('Set gas collector not collector', async () => {
  await deployContract();

  let user = await world.createWallet();

  await user.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'setGasCollector',
    funcArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'Not collector or owner' });
});

test('Set gas collector', async () => {
  await deployContract();

  // Deployer can also set collector
  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'setGasCollector',
    funcArgs: [
      collector,
    ],
  });

  let pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0n,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(collector),
    ],
  });

  await collector.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'setGasCollector',
    funcArgs: [
      deployer,
    ],
  });

  pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0n,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(deployer),
    ],
  });
});

test('Upgrade', async () => {
  await deployContract();

  // Upgrading is not supported with new gas collector
  await deployer.upgradeContract({
    callee: contract,
    code: 'file:gas-service/output/gas-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
    ],
  }).assertFail({ code: 4, message: 'wrong number of arguments' });

  await deployer.upgradeContract({
    callee: contract,
    code: 'file:gas-service/output/gas-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
  });

  const pairs = await contract.getAccount();
  assertAccount(pairs, {
    balance: 0n,
    kvs: [
      e.kvs.Mapper('gas_collector').Value(collector),
    ],
  });
});
