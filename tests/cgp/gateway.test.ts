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
  TOKEN_ID2, ALICE_PUB_KEY, getKeccak256Hash, getSignersHash,
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
}

const deployContract = async () => {
  const weightedSigners = e.Tuple(
    e.List(e.Tuple(e.TopBuffer(ALICE_PUB_KEY), e.U(10))),
    e.U(10),
    e.TopBuffer(getKeccak256Hash('nonce1'))
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

  const pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0n,
    kvs: baseKvs(),
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
    kvs: baseKvs(),
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
      e.kvs.Mapper('chain_id').Value(e.Str(DOMAIN_SEPARATOR))
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
      e.kvs.Mapper('chain_id').Value(e.Str(DOMAIN_SEPARATOR)),

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
      e.kvs.Mapper('chain_id').Value(e.Str(DOMAIN_SEPARATOR))
    ]
  });
});

test('Upgrade', async () => {
  await deployContract();

  // Upgrading is not supported with new values
  await deployer.upgradeContract({
    callee: contract,
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(MOCK_CONTRACT_ADDRESS_2),
      e.Str('Sth'),
    ],
  }).assertFail({ code: 4, message: 'wrong number of arguments' });

  await deployer.upgradeContract({
    callee: contract,
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
  });

  const pairs = await contract.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(DOMAIN_SEPARATOR)),
    ],
  });
});
