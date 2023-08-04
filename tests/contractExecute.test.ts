import { afterEach, beforeEach, test } from "vitest";
import { assertAccount } from "xsuite/assert";
import { FWorld, FWorldContract, FWorldWallet } from "xsuite/world";
import { e } from "xsuite/data";
import createKeccakHash from "keccak";

let world: FWorld;
let deployer: FWorldWallet;
let contract: FWorldContract;
let address: string;

const MOCK_CONTRACT_ADDRESS_1: string = "erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax";
const MOCK_CONTRACT_ADDRESS_2: string = "erd1qqqqqqqqqqqqqpgq7ykazrzd905zvnlr88dpfw06677lxe9w0n4suz00uh";

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
  ({ contract, address } = await deployer.deployContract({
    code: "file:gateway/output/gateway.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(MOCK_CONTRACT_ADDRESS_1),
      e.Addr(MOCK_CONTRACT_ADDRESS_2),
    ]
  }));

  const pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0n,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
    ],
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
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually add external token
      e.p.Mapper("token_type", e.Str(TOKEN_ID)).Value(e.U8(2)),

      e.p.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ]
  });
}

test("Execute invalid commands", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId")),
    e.List(e.Str("deployToken"), e.Str("mintToken")),
    e.List()
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      e.Str("proof"),
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

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      e.Str("proof"),
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),
    ],
  });

  // Calling again with same command does nothing
  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      e.Str("proof"),
    ],
  });

  pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
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

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      e.Str("proof"),
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
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

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      e.Str("proof"),
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
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

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      e.Str("proof"),
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
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
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

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      e.Str("proof"),
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
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
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

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      e.Str("proof"),
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("token_type", e.Str(TOKEN_ID)).Value(e.U8(2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.p.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });
});


test("Execute transfer operatorship", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandIdInvalid")),
    e.List(e.Str("transferOperatorship"), e.Str("transferOperatorship")),
    e.List(
      e.Buffer(""),
      e.Buffer(""),
    )
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      e.Str("proof"),
    ],
  });

  const commandIdHash = getCommandIdHash();

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("token_deployer_implementation").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),
    ],
  });
});
