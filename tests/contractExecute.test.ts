import { afterEach, beforeEach, test } from "vitest";
import { assertAccount } from "xsuite/assert";
import { FWorld, FWorldContract, FWorldWallet } from "xsuite/world";
import { e } from "xsuite/data";
import createKeccakHash from "keccak";
import { ALICE_ADDR, BOB_ADDR, generateSignature, getOperatorsHash, MOCK_CONTRACT_ADDRESS_2 } from './helpers';

let world: FWorld;
let deployer: FWorldWallet;
let contract: FWorldContract;
let address: string;
let contractAuth: FWorldContract;
let addressAuth: string;

const TOKEN_ID: string = "WEGLD-123456";

beforeEach(async () => {
  world = await FWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  })

  deployer = await world.createWallet({
    balance: 10_000_000_000n,
    pairs: [
      e.p.Esdts([
        {
          id: TOKEN_ID,
          amount: 100_000,
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
    code: "file:auth/output/auth.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: []
  }));

  ({ contract, address } = await deployer.deployContract({
    code: "file:gateway/output/gateway.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(addressAuth),
      e.Addr(MOCK_CONTRACT_ADDRESS_2),
    ]
  }));

  const pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0n,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
    ],
  });

  const operatorsHash = getOperatorsHash([ALICE_ADDR], [10], 10);
  const operatorsHashCanTransfer = getOperatorsHash([ALICE_ADDR, BOB_ADDR], [10, 2], 12);
  // Set gateway contract as owner of auth contract for transfer operatorship
  await contractAuth.setAccount({
    ...await contractAuth.getAccount(),
    owner: address,
    pairs: [
      // Manually add epoch for hash & current epoch
      e.p.Mapper("epoch_for_hash", e.Bytes(operatorsHash)).Value(e.U64(1)),
      e.p.Mapper("epoch_for_hash", e.Bytes(operatorsHashCanTransfer)).Value(e.U64(16)),

      e.p.Mapper("current_epoch").Value(e.U64(16)),
    ]
  });
}

const getCommandIdHash = (commandId: string = 'commandId') => {
  const commandExecutedHash = createKeccakHash('keccak256').update("command-executed").digest('hex');

  const buffer = Buffer.concat([
    Buffer.from(commandExecutedHash, 'hex'),
    Buffer.from(commandId)
  ]);

  return createKeccakHash('keccak256').update(buffer).digest('hex');
}

const setTokenType = async () => {
  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"],
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually add external token
      e.p.Mapper("token_type", e.Str(TOKEN_ID)).Value(e.U8(2)),

      e.p.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ]
  });
}

const generateProof = (data: any): any => {
  const hash = createKeccakHash('keccak256').update(Buffer.from(data.toTopHex(), 'hex')).digest('hex');
  const signature = generateSignature(hash);

  const proof = e.Tuple(
    e.List(e.Addr(ALICE_ADDR)),
    e.List(e.U(10)),
    e.U(10),
    e.List(e.Bytes(signature))
  );

  return { hash, proof };
}

test("Execute invalid proof", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId")),
    e.List(e.Str("deployToken"), e.Str("mintToken")),
    e.List()
  );

  const hash = createKeccakHash('keccak256').update(Buffer.from(data.toTopHex(), 'hex')).digest('hex');
  const signature = generateSignature(hash);
  const proof = e.Tuple(
    e.List(e.Addr(ALICE_ADDR)),
    e.List(e.U(11)), // wrong weight
    e.U(10),
    e.List(e.Bytes(signature))
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });
});

test("Execute invalid commands", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId")),
    e.List(e.Str("deployToken"), e.Str("mintToken")),
    e.List()
  );

  const { hash, proof } = generateProof(data);

  // First check if the proof is valid
  await deployer.callContract({
    callee: contractAuth,
    gasLimit: 10_000_000,
    funcName: "validateProof",
    funcArgs: [
      e.Bytes(hash),
      proof,
    ],
  });

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  }).assertFail({ code: 4, message: 'Invalid commands' });
});

test("Execute deploy token should deploy new token", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId")),
    e.List(e.Str("deployToken")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str("name"),
          e.Str("WEGLD"),
          e.U8(18),
          e.U(2_000_000),
          e.Option(null),
          e.U(1_000_000),
        ).toTopBytes(),
      )
    )
  );

  const { proof } = generateProof(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 12_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),
    ],
  });

  // Calling again with same command does nothing
  await deployer.callContract({
    callee: contract,
    gasLimit: 12_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),
    ],
  });
});

test("Execute deploy token external", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandIdInvalid")),
    e.List(e.Str("deployToken"), e.Str("deployToken")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str("name"),
          e.Str("WEGLD"),
          e.U8(18),
          e.U(2_000_000),
          e.Option(e.Str(TOKEN_ID)),
          e.U(1_000_000),
        ).toTopBytes(),
      ),
      e.Buffer(
        e.Tuple(
          e.Str("name"),
          e.Str("WEGLD"),
          e.U8(18),
          e.U(2_000_000),
          e.Option(e.Str("INVALID")),
          e.U(1_000_000),
        ).toTopBytes(),
      )
    )
  );

  const { proof } = generateProof(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 15_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.p.Mapper("token_type", e.Str(TOKEN_ID)).Value(e.U8(2)),
      e.p.Mapper("token_mint_limit", e.Str(TOKEN_ID)).Value(e.U(1_000_000)),
    ],
  });
});

test("Execute mint token external", async () => {
  await deployContract();

  await setTokenType();

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandIdInvalid")),
    e.List(e.Str("mintToken"), e.Str("mintToken")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str(TOKEN_ID),
          e.Addr(deployer.toString()),
          e.U(1_000),
        ).toTopBytes(),
      ),
      e.Buffer(
        e.Tuple(
          e.Str("OTHER-654321"),
          e.Addr(deployer.toString()),
          e.U(1_000),
        ).toTopBytes(),
      )
    )
  );

  world.setCurrentBlockInfo({
    timestamp: 21_600 * 10,
  });

  const { proof } = generateProof(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 15_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.p.Mapper("token_type", e.Str(TOKEN_ID)).Value(e.U8(2)),
      e.p.Mapper("token_mint_amount", e.Str(TOKEN_ID), e.U64(10)).Value(e.U(1_000)),
    ],
  });
});

test("Execute approve contract call", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId")),
    e.List(e.Str("approveContractCall")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str("ethereum"),
          e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
          e.Addr(deployer.toString()),
          e.Str("payloadHash"),
          e.Str("sourceTxHash"),
          e.U(123),
        ).toTopBytes(),
      ),
    )
  );

  const { proof } = generateProof(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 15_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  const commandIdHash = getCommandIdHash();

  const contractCallHash = createKeccakHash('keccak256').update("contract-call-approved").digest('hex');

  // get_is_contract_call_approved_key hash
  let approvedData = Buffer.concat([
    Buffer.from(contractCallHash, 'hex'),
    Buffer.from("commandId"),
    Buffer.from("ethereum"),
    Buffer.from("0x4976da71bF84D750b5451B053051158EC0A4E876"),
    deployer.toTopBytes(),
    Buffer.from("payloadHash"),
  ]);

  const approvedDataHash = createKeccakHash('keccak256').update(approvedData).digest('hex');

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.p.Mapper("contract_call_approved", e.Bytes(approvedDataHash)).Value(e.U8(1)),
    ],
  });
});

test("Execute approve contract call with mint", async () => {
  await deployContract();

  const amount = 1_000;
  let amountHex = amount.toString(16);
  if (amountHex.length % 2) {
    amountHex = '0' + amountHex;
  }

  const data = e.Tuple(
    e.List(e.Str("commandId")),
    e.List(e.Str("approveContractCallWithMint")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str("ethereum"),
          e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
          e.Addr(deployer.toString()),
          e.Str("payloadHash"),
          e.Str(TOKEN_ID),
          e.U(amount),
          e.Str("sourceTxHash"),
          e.U(123),
        ).toTopBytes(),
      ),
    )
  );

  const { proof } = generateProof(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 15_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  const commandIdHash = getCommandIdHash();

  const contractCallHash = createKeccakHash('keccak256').update("contract-call-approved-with-mint").digest('hex');

  // get_is_contract_call_approved_key hash
  let approvedData = Buffer.concat([
    Buffer.from(contractCallHash, 'hex'),
    Buffer.from("commandId"),
    Buffer.from("ethereum"),
    Buffer.from("0x4976da71bF84D750b5451B053051158EC0A4E876"),
    deployer.toTopBytes(),
    Buffer.from("payloadHash"),
    Buffer.from(TOKEN_ID),
    Buffer.from(amountHex, 'hex'),
  ]);

  const approvedDataHash = createKeccakHash('keccak256').update(approvedData).digest('hex');

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.p.Mapper("contract_call_approved", e.Bytes(approvedDataHash)).Value(e.U8(1)),
    ],
  });
});

test("Execute burn token", async () => {
  await deployContract();

  await setTokenType();

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandIdInvalid")),
    e.List(e.Str("burnToken"), e.Str("burnToken")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str(TOKEN_ID),
          e.Str("salt"),
        ).toTopBytes(),
      ),
      e.Buffer(
        e.Tuple(
          e.Str("OTHER-654321"),
          e.Str("salt"),
        ).toTopBytes(),
      ),
    )
  );

  const { proof } = generateProof(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 15_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("token_type", e.Str(TOKEN_ID)).Value(e.U8(2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.p.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });
});

test("Execute transfer operatorship wrong proof", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandIdInvalid")),
    e.List(e.Str("transferOperatorship"), e.Str("transferOperatorship")),
    e.List(
      e.Buffer(""),
      e.Buffer(""),
    )
  );

  const { proof } = generateProof(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 15_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
    ],
  });
});

test("Execute transfer operatorship", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId")),
    e.List(e.Str("transferOperatorship")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.List(e.Addr(BOB_ADDR)),
          e.List(e.U(2)),
          e.U(2),
        ).toTopBytes()
      )
    )
  );

  const hash = createKeccakHash('keccak256').update(Buffer.from(data.toTopHex(), 'hex')).digest('hex');
  const signature = generateSignature(hash);
  const signatureBob = generateSignature(hash, './bob.pem');

  const proof = e.Tuple(
    e.List(e.Addr(ALICE_ADDR), e.Addr(BOB_ADDR)),
    e.List(e.U(10), e.U(2)),
    e.U(12),
    e.List(e.Bytes(signature), e.Bytes(signatureBob))
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 20_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),
    ],
  });

  const operatorsHash = getOperatorsHash([ALICE_ADDR], [10], 10);
  const operatorsHash2 = getOperatorsHash([ALICE_ADDR, BOB_ADDR], [10, 2], 12);
  const operatorsHash3 = getOperatorsHash([BOB_ADDR], [2], 2);

  // Check that Auth contract was updated
  pairs = await contractAuth.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      // Manually add epoch for hash & current epoch
      e.p.Mapper("epoch_for_hash", e.Bytes(operatorsHash)).Value(e.U64(1)),
      e.p.Mapper("epoch_for_hash", e.Bytes(operatorsHash2)).Value(e.U64(16)),
      e.p.Mapper("epoch_for_hash", e.Bytes(operatorsHash3)).Value(e.U64(17)),

      e.p.Mapper("hash_for_epoch", e.U64(17)).Value(e.Bytes(operatorsHash3)),

      e.p.Mapper("current_epoch").Value(e.U64(17)),
    ],
  });

  // Using old proof will not work anymore
  const dataOther = e.Tuple(
    e.List(e.Str("commandId")),
    e.List(e.Str("deployToken"), e.Str("mintToken")),
    e.List()
  );

  const { proof: proofOld } = generateProof(dataOther);

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      dataOther,
      proofOld,
    ],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });
});
