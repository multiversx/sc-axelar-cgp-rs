import { afterEach, assert, beforeEach, test } from 'vitest';
import { assertAccount, e, SContract, SWallet, SWorld } from 'xsuite';
import createKeccakHash from 'keccak';
import {
  ALICE_PUB_KEY,
  BOB_PUB_KEY,
  CHAIN_ID,
  COMMAND_ID,
  generateMessageHash,
  generateProof,
  generateSignature,
  getOperatorsHash,
  PAYLOAD_HASH,
  TOKEN_ID
} from './helpers';

let world: SWorld;
let deployer: SWallet;
let contract: SContract;
let address: string;
let contractAuth: SContract;
let addressAuth: string;

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
        }
      ])
    ]
  });
});

afterEach(async () => {
  await world.terminate();
});

const deployContract = async () => {
  ({ contract: contractAuth, address: addressAuth } = await deployer.deployContract({
    code: 'file:auth/output/auth.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: []
  }));

  ({ contract, address } = await deployer.deployContract({
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(addressAuth),
      e.Str(CHAIN_ID)
    ]
  }));

  const kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(addressAuth)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID))
    ]
  });

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY], [10], 10);
  const operatorsHashCanTransfer = getOperatorsHash([ALICE_PUB_KEY, BOB_PUB_KEY], [10, 2], 12);
  // Set gateway contract as owner of auth contract for transfer operatorship
  await contractAuth.setAccount({
    ...await contractAuth.getAccount(),
    owner: address,
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.Bytes(operatorsHash)).Value(e.U64(1)),
      e.kvs.Mapper('epoch_for_hash', e.Bytes(operatorsHashCanTransfer)).Value(e.U64(16)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16))
    ]
  });
};

const getKeccak256Hash = (payload: string = 'commandId') => {
  return createKeccakHash('keccak256').update(Buffer.from(payload)).digest('hex');
};

test('Execute invalid proof', async () => {
  await deployContract();

  const data = e.Tuple(
    e.Str(CHAIN_ID),
    e.List(e.Bytes(COMMAND_ID)),
    e.List(e.Str('approveContractCall')),
    e.List()
  );

  const proofData = Buffer.from(data.toTopHex(), 'hex');
  const signature = generateSignature(proofData);
  const proof = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY)),
    e.List(e.U(11)), // wrong weight
    e.U(10),
    e.List(e.Bytes(signature))
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(e.Buffer(data.toTopBytes()), e.Buffer(proof.toTopBytes()))
    ]
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });
});

test('Execute invalid commands', async () => {
  await deployContract();

  const data = e.Tuple(
    e.Str(CHAIN_ID),
    e.List(e.Bytes(COMMAND_ID)),
    e.List(e.Str('deployToken'), e.Str('mintToken')),
    e.List()
  );

  const proof = generateProof(data);

  const messageHash = generateMessageHash(Buffer.from(data.toTopHex(), 'hex'));

  // First check if the proof is valid
  await deployer.callContract({
    callee: contractAuth,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      e.Bytes(messageHash),
      proof
    ]
  });

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(e.Buffer(data.toTopBytes()), e.Buffer(proof.toTopBytes()))
    ]
  }).assertFail({ code: 4, message: 'Invalid commands' });
});

test('Execute command already executed', async () => {
  await deployContract();

  const commandId = getKeccak256Hash();

  const data = e.Tuple(
    e.Str(CHAIN_ID),
    e.List(e.Bytes(commandId)),
    e.List(e.Str('deployToken')),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str('name'),
          e.Str('WEGLD'),
          e.U8(18),
          e.U(2_000_000),
          e.Option(null),
          e.U(1_000_000)
        ).toTopBytes()
      )
    )
  );

  const proof = generateProof(data);

  await contract.setAccount({
    ...await contract.getAccount(),
    owner: address,
    kvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(addressAuth)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),

      e.kvs.Mapper('command_executed', e.Bytes(commandId)).Value(e.U8(0))
    ]
  });

  await deployer.callContract({
    callee: contract,
    gasLimit: 12_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(e.Buffer(data.toTopBytes()), e.Buffer(proof.toTopBytes()))
    ]
  });

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(addressAuth)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),

      e.kvs.Mapper('command_executed', e.Bytes(commandId)).Value(e.U8(0))
    ]
  });
});

test('Execute approve contract call', async () => {
  await deployContract();

  const data = e.Tuple(
    e.Str(CHAIN_ID),
    e.List(e.Bytes(COMMAND_ID)),
    e.List(e.Str('approveContractCall')),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str('ethereum'),
          e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
          e.Addr(deployer.toString()),
          e.Bytes(getKeccak256Hash('payloadHash')),
          e.Str('sourceTxHash'),
          e.U(123)
        ).toTopBytes()
      )
    )
  );

  const proof = generateProof(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 15_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(e.Buffer(data.toTopBytes()), e.Buffer(proof.toTopBytes()))
    ]
  });

  const commandIdHash = getKeccak256Hash();

  // get_is_contract_call_approved_key hash
  let approvedData = Buffer.concat([
    Buffer.from(COMMAND_ID, 'hex'),
    Buffer.from('ethereum'),
    Buffer.from('0x4976da71bF84D750b5451B053051158EC0A4E876'),
    deployer.toTopBytes(),
    Buffer.from(getKeccak256Hash('payloadHash'), 'hex')
  ]);

  const approvedDataHash = createKeccakHash('keccak256').update(approvedData).digest('hex');

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(addressAuth)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),

      e.kvs.Mapper('command_executed', e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.kvs.Mapper('contract_call_approved', e.Bytes(approvedDataHash)).Value(e.U8(1))
    ]
  });
});

test('Execute transfer operatorship old proof', async () => {
  await deployContract();

  const data = e.Tuple(
    e.Str(CHAIN_ID),
    e.List(e.Bytes(COMMAND_ID), e.Bytes(getKeccak256Hash('commandIdInvalid'))),
    e.List(e.Str('transferOperatorship'), e.Str('transferOperatorship')),
    e.List(
      e.Buffer(''),
      e.Buffer('')
    )
  );

  const proof = generateProof(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 15_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(e.Buffer(data.toTopBytes()), e.Buffer(proof.toTopBytes()))
    ]
  });

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(addressAuth)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),
    ]
  });
});

test('Execute transfer operatorship', async () => {
  await deployContract();

  // Second transferOperatorship command will be ignored
  const data = e.Tuple(
    e.Str(CHAIN_ID),
    e.List(e.Bytes(COMMAND_ID), e.Bytes(getKeccak256Hash('commandId2'))),
    e.List(e.Str('transferOperatorship'), e.Str('transferOperatorship')),
    e.List(
      e.Buffer(
        e.Tuple(
          e.List(e.Bytes(BOB_PUB_KEY)),
          e.List(e.U(2)),
          e.U(2)
        ).toTopBytes()
      ),
      e.Buffer(
        e.Tuple(
          e.List(e.Bytes(ALICE_PUB_KEY)),
          e.List(e.U(5)),
          e.U(5)
        ).toTopBytes()
      )
    )
  );

  const signature = generateSignature(Buffer.from(data.toTopHex(), 'hex'));
  const signatureBob = generateSignature(Buffer.from(data.toTopHex(), 'hex'), './bob.pem');

  const proof = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY), e.Bytes(BOB_PUB_KEY)),
    e.List(e.U(10), e.U(2)),
    e.U(12),
    e.List(e.Bytes(signature), e.Bytes(signatureBob))
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 20_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(e.Buffer(data.toTopBytes()), e.Buffer(proof.toTopBytes()))
    ]
  });

  const commandIdHash = getKeccak256Hash();

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(addressAuth)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),

      e.kvs.Mapper('command_executed', e.Bytes(commandIdHash)).Value(e.U8(1))
    ]
  });

  const operatorsHash = getOperatorsHash([ALICE_PUB_KEY], [10], 10);
  const operatorsHash2 = getOperatorsHash([ALICE_PUB_KEY, BOB_PUB_KEY], [10, 2], 12);
  const operatorsHash3 = getOperatorsHash([BOB_PUB_KEY], [2], 2);

  // Check that Auth contract was updated
  kvs = await contractAuth.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    allKvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.Bytes(operatorsHash)).Value(e.U64(1)),
      e.kvs.Mapper('epoch_for_hash', e.Bytes(operatorsHash2)).Value(e.U64(16)),
      e.kvs.Mapper('epoch_for_hash', e.Bytes(operatorsHash3)).Value(e.U64(17)),

      e.kvs.Mapper('hash_for_epoch', e.U64(17)).Value(e.Bytes(operatorsHash3)),

      e.kvs.Mapper('current_epoch').Value(e.U64(17))
    ]
  });

  // Using old proof will not work anymore
  const dataOther = e.Tuple(
    e.List(e.Str('commandId')),
    e.List(e.Str('deployToken'), e.Str('mintToken')),
    e.List()
  );

  const proofOld = generateProof(dataOther);

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(e.Buffer(dataOther.toTopBytes()), e.Buffer(proofOld.toTopBytes()))
    ]
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });
});

test('Execute multiple commands', async () => {
  await deployContract();

  const data = e.Tuple(
    e.Str(CHAIN_ID),
    e.List(e.Bytes(COMMAND_ID), e.Bytes(getKeccak256Hash('commandIdInvalid')), e.Bytes(getKeccak256Hash('commandId3'))),
    e.List(e.Str('approveContractCall'), e.Str('deployToken'), e.Str('approveContractCall')),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str('arbitrum'),
          e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
          e.Addr(deployer.toString()),
          e.Bytes(getKeccak256Hash('payloadHash2')),
          e.Str('sourceTxHash2'),
          e.U(123)
        ).toTopBytes()
      ),
      e.Buffer(''),
      e.Buffer(
        e.Tuple(
          e.Str('ethereum'),
          e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
          e.Addr(deployer.toString()),
          e.Bytes(getKeccak256Hash('payloadHash')),
          e.Str('sourceTxHash'),
          e.U(123)
        ).toTopBytes()
      )
    )
  );

  const proof = generateProof(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 25_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(e.Buffer(data.toTopBytes()), e.Buffer(proof.toTopBytes()))
    ]
  });

  const commandIdHash = getKeccak256Hash();
  const commandId3Hash = getKeccak256Hash('commandId3');

  // get_is_contract_call_approved_key hash
  let approvedData = Buffer.concat([
    Buffer.from(COMMAND_ID, 'hex'),
    Buffer.from('arbitrum'),
    Buffer.from('0x4976da71bF84D750b5451B053051158EC0A4E876'),
    deployer.toTopBytes(),
    Buffer.from(getKeccak256Hash('payloadHash2'), 'hex')
  ]);

  const approvedDataHash = createKeccakHash('keccak256').update(approvedData).digest('hex');

  let approvedData3 = Buffer.concat([
    Buffer.from(getKeccak256Hash('commandId3'), 'hex'),
    Buffer.from('ethereum'),
    Buffer.from('0x4976da71bF84D750b5451B053051158EC0A4E876'),
    deployer.toTopBytes(),
    Buffer.from(getKeccak256Hash('payloadHash'), 'hex')
  ]);

  const approvedDataHash3 = createKeccakHash('keccak256').update(approvedData3).digest('hex');

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(addressAuth)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),

      e.kvs.Mapper('command_executed', e.Bytes(commandIdHash)).Value(e.U8(1)),
      e.kvs.Mapper('command_executed', e.Bytes(commandId3Hash)).Value(e.U8(1)),

      e.kvs.Mapper('contract_call_approved', e.Bytes(approvedDataHash)).Value(e.U8(1)),
      e.kvs.Mapper('contract_call_approved', e.Bytes(approvedDataHash3)).Value(e.U8(1))
    ]
  });
});

test('View functions', async () => {
  await deployContract();

  const commandId = getKeccak256Hash();

  const approvedData = Buffer.concat([
    Buffer.from(commandId, 'hex'),
    Buffer.from('ethereum'),
    Buffer.from('0x4976da71bF84D750b5451B053051158EC0A4E876'),
    deployer.toTopBytes(),
    Buffer.from(PAYLOAD_HASH, 'hex')
  ]);
  const approvedDataHash = createKeccakHash('keccak256').update(approvedData).digest('hex');

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ['payable'],
    kvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(addressAuth)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),

      e.kvs.Mapper('contract_call_approved', e.Bytes(approvedDataHash)).Value(e.U8(1)),

      e.kvs.Mapper('command_executed', e.Bytes(commandId)).Value(e.U8(1))
    ]
  });

  let result = await world.query({
    callee: contract,
    funcName: 'isContractCallApproved',
    funcArgs: [
      e.Bytes(commandId),
      e.Str('ethereum'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      e.Addr(deployer.toString()),
      e.Bytes(PAYLOAD_HASH)
    ]
  });
  assert(result.returnData[0] === '01');

  result = await world.query({
    callee: contract,
    funcName: 'isCommandExecuted',
    funcArgs: [
      e.Bytes(commandId)
    ]
  });
  assert(result.returnData[0] === '01');
});
