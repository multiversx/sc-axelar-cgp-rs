import { afterEach, assert, beforeEach, test } from 'vitest';
import { assertAccount, d, e, SContract, SWallet, SWorld } from 'xsuite';
import { ADDRESS_ZERO, DOMAIN_SEPARATOR, COMMAND_ID, getKeccak256Hash, MOCK_CONTRACT_ADDRESS_1 } from './helpers';
import createKeccakHash from 'keccak';
import fs from 'fs';
import { BytesEncodable } from 'xsuite/dist/data/BytesEncodable';

const GOVERNANCE_CHAIN = 'Axelar';
const GOVERNANCE_ADDRESS = 'axelar1u5jhn5876mjzmgw7j37mdvqh4qp5y6z2gc6rc3';

let world: SWorld;
let deployer: SWallet;
let contract: SContract;
let gateway: SContract;
let address: string;

beforeEach(async () => {
  world = await SWorld.start();
  await world.setCurrentBlockInfo({
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

const baseKvs = () => {
  return [
    e.kvs.Mapper('gateway').Value(gateway),
    e.kvs.Mapper('minimum_time_lock_delay').Value(e.U64(10)),
    e.kvs.Mapper('governance_chain').Value(e.Str(GOVERNANCE_CHAIN)),
    e.kvs.Mapper('governance_address').Value(e.Str(GOVERNANCE_ADDRESS)),
    e.kvs.Mapper('governance_chain_hash').Value(e.TopBuffer(getKeccak256Hash(GOVERNANCE_CHAIN))),
    e.kvs.Mapper('governance_address_hash').Value(e.TopBuffer(getKeccak256Hash(GOVERNANCE_ADDRESS))),
  ];
};

const deployGateway = async () => {
  ({ contract: gateway } = await deployer.deployContract({
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(MOCK_CONTRACT_ADDRESS_1),
      e.Str(DOMAIN_SEPARATOR),
    ],
  }));

  const kvs = await gateway.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(DOMAIN_SEPARATOR)),
    ],
    owner: deployer,
  });
};

const deployContract = async () => {
  await deployGateway();

  ({ contract, address } = await deployer.deployContract({
    code: 'file:governance/output/governance.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      e.U64(10),
    ],
  }));

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: baseKvs(),
  });

  // Change owner of gateway to governance contract so it can upgrade
  await gateway.setAccount({
    ...await gateway.getAccountWithKvs(),
    owner: contract,
  });
};

const mockCallApprovedByGateway = async (payload: BytesEncodable) => {
  const payloadHash = createKeccakHash('keccak256').update(Buffer.from(payload.toTopU8A())).digest('hex');

  // Mock call approved by gateway
  let data = Buffer.concat([
    Buffer.from(COMMAND_ID, 'hex'),
    Buffer.from(GOVERNANCE_CHAIN),
    Buffer.from(GOVERNANCE_ADDRESS),
    contract.toTopU8A(),
    Buffer.from(payloadHash, 'hex'),
  ]);

  const dataHash = createKeccakHash('keccak256').update(data).digest('hex');

  await gateway.setAccount({
    ...await gateway.getAccount(),
    codeMetadata: ['payable'],
    kvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(DOMAIN_SEPARATOR)),

      // Manually approve call
      e.kvs.Mapper('contract_call_approved', e.Bytes(dataHash)).Value(e.U8(1)),
    ],
  });
}

test('Init errors', async () => {
  await deployGateway();

  await deployer.deployContract({
    code: 'file:governance/output/governance.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(ADDRESS_ZERO),
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      e.U64(10),
    ],
  }).assertFail({ code: 4, message: 'Invalid address' });

  await deployer.deployContract({
    code: 'file:governance/output/governance.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      e.Str(''),
      e.Str(GOVERNANCE_ADDRESS),
      e.U64(10),
    ],
  }).assertFail({ code: 4, message: 'Invalid address' });

  await deployer.deployContract({
    code: 'file:governance/output/governance.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      e.Str(GOVERNANCE_CHAIN),
      e.Str(''),
      e.U64(10),
    ],
  }).assertFail({ code: 4, message: 'Invalid address' });
});

test('Execute proposal errors', async () => {
  await deployContract();

  const wrongCallData = e.TopBuffer(e.Tuple(
    e.Str('endpoint'),
  ).toTopU8A());

  await deployer.callContract({
    callee: contract,
    gasLimit: 100_000_000,
    funcName: 'executeProposal',
    funcArgs: [
      gateway,
      wrongCallData,
      e.U(0),
    ],
  }).assertFail({ code: 4, message: 'Invalid time lock hash' });

  const buffer = Buffer.concat([
    gateway.toTopU8A(),
    wrongCallData.toTopU8A(),
    e.U(0).toTopU8A(),
  ]);
  const hash = createKeccakHash('keccak256').update(buffer).digest('hex');

  // Mock hash
  await contract.setAccount({
    ...await contract.getAccountWithKvs(),
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', e.TopBuffer(hash)).Value(e.U64(1)),
    ],
  });

  await deployer.callContract({
    callee: contract,
    gasLimit: 100_000_000,
    funcName: 'executeProposal',
    funcArgs: [
      gateway,
      wrongCallData,
      e.U(0),
    ],
  }).assertFail({ code: 4, message: 'Time lock not ready' });

  // Increase timestamp so finalize_time_lock passes
  await world.setCurrentBlockInfo({ timestamp: 1 });

  await deployer.callContract({
    callee: contract,
    gasLimit: 100_000_000,
    funcName: 'executeProposal',
    funcArgs: [
      gateway,
      wrongCallData,
      e.U(0),
    ],
  }).assertFail({ code: 4, message: 'Could not decode call data' });
});

test('Execute proposal upgrade gateway', async () => {
  await deployContract();

  const gatewayCode = fs.readFileSync('gateway/output/gateway.wasm');

  const callData = e.TopBuffer(e.Tuple(
    e.Str('upgradeContract'),
    e.List(
      e.Buffer(gatewayCode), // code
      e.Buffer('0100'), // upgrade metadata (upgradable)
    ),
  ).toTopU8A());

  const buffer = Buffer.concat([
    gateway.toTopU8A(),
    callData.toTopU8A(),
    e.U(0).toTopU8A(),
  ]);
  const hash = createKeccakHash('keccak256').update(buffer).digest('hex');

  // Mock hash
  await contract.setAccount({
    ...await contract.getAccountWithKvs(),
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', e.TopBuffer(hash)).Value(e.U64(1)),
    ],
  });
  // Increase timestamp so finalize_time_lock passes
  await world.setCurrentBlockInfo({ timestamp: 1 });

  await deployer.callContract({
    callee: contract,
    gasLimit: 20_000_000,
    funcName: 'executeProposal',
    funcArgs: [
      gateway,
      callData,
      e.U(0),
    ],
  }).assertFail({ code: 4, message: 'Not enough gas left for async call' });

  await deployer.callContract({
    callee: contract,
    gasLimit: 200_000_000,
    funcName: 'executeProposal',
    funcArgs: [
      gateway,
      callData,
      e.U(0),
    ],
  });

  // Time lock eta was deleted
  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: baseKvs(),
  });
});

test('Execute proposal upgrade gateway error', async () => {
  await deployContract();

  const gatewayCode = fs.readFileSync('gateway/output/gateway.wasm');

  const callData = e.TopBuffer(e.Tuple(
    e.Str('upgradeContract'),
    e.List(
      e.Buffer(gatewayCode), // code
      e.Buffer('0100'), // upgrade metadata (upgradable)
      e.Str('wrongArgs'),
    ),
  ).toTopU8A());

  const buffer = Buffer.concat([
    gateway.toTopU8A(),
    callData.toTopU8A(),
    e.U(0).toTopU8A(),
  ]);
  const hash = createKeccakHash('keccak256').update(buffer).digest('hex');

  // Mock hash
  await contract.setAccount({
    ...await contract.getAccountWithKvs(),
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', e.TopBuffer(hash)).Value(e.U64(1)),
    ],
  });
  // Increase timestamp so finalize_time_lock passes
  await world.setCurrentBlockInfo({ timestamp: 1 });

  await deployer.callContract({
    callee: contract,
    gasLimit: 50_000_000,
    funcName: 'executeProposal',
    funcArgs: [
      gateway,
      callData,
      e.U(0),
    ],
  }); // async call actually fails

  // Time lock eta was NOT deleted
  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', e.TopBuffer(hash)).Value(e.U64(1)),
    ],
  });
});

test('Withdraw', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    funcName: 'withdraw',
    gasLimit: 10_000_000,
    funcArgs: [
      deployer,
      e.U(100),
    ],
  }).assertFail({ code: 4, message: 'Not self' });

  // Need to call withdraw through executeProposal
  const callData = e.TopBuffer(e.Tuple(
    e.Str('withdraw'),
    e.List(
      e.Buffer(deployer.toNestBytes()),
      e.U(100),
    ),
  ).toTopU8A());

  const buffer = Buffer.concat([
    contract.toTopU8A(),
    callData.toTopU8A(),
    e.U(0).toTopU8A(),
  ]);
  const hash = createKeccakHash('keccak256').update(buffer).digest('hex');

  // Mock hash & balance
  await contract.setAccount({
    ...await contract.getAccountWithKvs(),
    balance: 100,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', e.TopBuffer(hash)).Value(e.U64(1)),
    ],
  });
  // Increase timestamp so finalize_time_lock passes
  await world.setCurrentBlockInfo({ timestamp: 1 });

  await deployer.callContract({
    callee: contract,
    gasLimit: 50_000_000,
    funcName: 'executeProposal',
    funcArgs: [
      contract,
      callData,
      e.U(0),
    ],
  });

  // Time lock eta was deleted and amount was sent to deployer
  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [
      ...baseKvs(),
    ],
  });

  kvs = await deployer.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 10_000_000_100n,
  });
});

test('Execute errors', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str('otherChain'),
      e.Str(GOVERNANCE_ADDRESS),
      e.TopBuffer(''),
    ],
  }).assertFail({ code: 4, message: 'Not governance' });

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(GOVERNANCE_CHAIN),
      e.Str('otherAddress'),
      e.TopBuffer(''),
    ],
  }).assertFail({ code: 4, message: 'Not governance' });

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      e.TopBuffer(''),
    ],
  }).assertFail({ code: 4, message: 'Not approved by gateway' });

  let payload = e.TopBuffer('');
  await mockCallApprovedByGateway(payload);

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Could not decode execute payload' });

  payload = e.TopBuffer(e.Tuple(
    e.U8(0),
    e.Addr(ADDRESS_ZERO),
    e.Buffer(''),
    e.U(0),
    e.U64(0),
  ).toTopU8A());
  await mockCallApprovedByGateway(payload);

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Invalid target' });
});

test('Execute schedule time lock proposal min eta', async () => {
  await deployContract();

  const callData = e.Buffer('');
  const payload = e.TopBuffer(e.Tuple(
    e.U8(0),
    gateway,
    callData,
    e.U(0),
    e.U64(1), // will use min eta instead
  ).toTopU8A());
  await mockCallApprovedByGateway(payload);

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  });

  const buffer = Buffer.concat([
    gateway.toTopU8A(),
    callData.toTopU8A(),
    e.U(0).toTopU8A(),
  ]);
  const hash = createKeccakHash('keccak256').update(buffer).digest('hex');

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', e.TopBuffer(hash)).Value(e.U64(10)),
    ],
  });
});

test('Execute schedule time lock proposal eta', async () => {
  await deployContract();

  const callData = e.Buffer('');
  const payload = e.TopBuffer(e.Tuple(
    e.U8(0),
    gateway,
    callData,
    e.U(0),
    e.U64(11),
  ).toTopU8A());
  await mockCallApprovedByGateway(payload);

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  });

  const buffer = Buffer.concat([
    gateway.toTopU8A(),
    callData.toTopU8A(),
    e.U(0).toTopU8A(),
  ]);
  const hash = createKeccakHash('keccak256').update(buffer).digest('hex');

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', e.TopBuffer(hash)).Value(e.U64(11)),
    ],
  });

  await mockCallApprovedByGateway(payload);
  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Time lock already scheduled' });

  const result = await world.query({
    callee: contract,
    funcName: 'getProposalEta',
    funcArgs: [
      gateway,
      callData,
      e.U(0),
    ]
  });
  assert(d.U64().topDecode(result.returnData[0]) === 11n);
});

test('Execute cancel time lock proposal', async () => {
  await deployContract();

  const callData = e.Buffer('');
  const payload = e.TopBuffer(e.Tuple(
    e.U8(1),
    gateway,
    callData,
    e.U(0),
    e.U64(0),
  ).toTopU8A());
  await mockCallApprovedByGateway(payload);

  // Mock time lock era set
  const buffer = Buffer.concat([
    gateway.toTopU8A(),
    callData.toTopU8A(),
    e.U(0).toTopU8A(),
  ]);
  const hash = createKeccakHash('keccak256').update(buffer).digest('hex');

  await contract.setAccount({
    ...await contract.getAccountWithKvs(),
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', e.TopBuffer(hash)).Value(e.U64(10)),
    ]
  });

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  });

  // Time lock eta was removed
  const kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: baseKvs(),
  });
});
