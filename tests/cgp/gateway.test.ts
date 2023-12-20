import { afterEach, assert, beforeEach, test } from 'vitest';
import { assertAccount, e, SContract, SWallet, SWorld } from 'xsuite';
import createKeccakHash from 'keccak';
import { CHAIN_ID, COMMAND_ID, MOCK_CONTRACT_ADDRESS_1, PAYLOAD_HASH, TOKEN_ID, TOKEN_ID2 } from '../helpers';

let world: SWorld;
let deployer: SWallet;
let contract: SContract;
let address: string;

beforeEach(async () => {
  world = await SWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0
  });

  deployer = await world.createWallet({
    balance: 10_000_000_000n,
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 100_000
        },
        {
          id: TOKEN_ID2,
          amount: 10_000
        },
      ]),
    ],
  });
});

afterEach(async () => {
  await world.terminate();
});

const deployContract = async () => {
  ({ contract, address } = await deployer.deployContract({
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(MOCK_CONTRACT_ADDRESS_1),
      e.Str(CHAIN_ID)
    ],
  }));

  const pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID))
    ]
  });
};

test('Call contract', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'callContract',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      e.Str('payload')
    ],
  });

  // This only emits an event, and there is no way to test those currently...
  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID))
    ]
  });
});

test('Validate contract call invalid', async () => {
  await deployContract();

  const result = await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateContractCall',
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str('ethereum'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      e.TopBuffer(PAYLOAD_HASH)
    ],
  });
  assert(result.returnData[0] === '');

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID))
    ]
  });
});

test('Validate contract call valid', async () => {
  await deployContract();

  // get_is_contract_call_approved_key hash
  let data = Buffer.concat([
    Buffer.from(COMMAND_ID, 'hex'),
    Buffer.from('ethereum'),
    Buffer.from('0x4976da71bF84D750b5451B053051158EC0A4E876'),
    deployer.toTopBytes(),
    Buffer.from(PAYLOAD_HASH, 'hex')
  ]);

  const dataHash = createKeccakHash('keccak256').update(data).digest('hex');

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ['payable'],
    kvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),

      // Manually approve call
      e.kvs.Mapper('contract_call_approved', e.TopBuffer(dataHash)).Value(e.U8(1))
    ],
  });

  const result = await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateContractCall',
    funcArgs: [
      e.TopBuffer(COMMAND_ID),
      e.Str('ethereum'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      e.TopBuffer(PAYLOAD_HASH)
    ],
  });
  assert(result.returnData[0] === '01');

  let pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID))
    ]
  });
});
