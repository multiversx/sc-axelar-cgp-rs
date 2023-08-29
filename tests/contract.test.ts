import { afterEach, assert, beforeEach, test } from "vitest";
import { assertAccount } from "xsuite/assert";
import { FWorld, FWorldContract, FWorldWallet } from "xsuite/world";
import { e } from "xsuite/data";
import createKeccakHash from "keccak";
import { MOCK_CONTRACT_ADDRESS_1, MOCK_CONTRACT_ADDRESS_2, TOKEN_ID, TOKEN_ID2, TOKEN_SYMBOL } from './helpers';

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
    pairs: [
      e.p.Esdts([
        {
          id: TOKEN_ID,
          amount: 100_000,
        },
        {
          id: TOKEN_ID2,
          amount: 10_000,
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
    ],
  });
}

test("Send token external not exists", async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "sendToken",
    funcArgs: [
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str(TOKEN_SYMBOL),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 4, message: "Token does not exist" });
});

test("Send token external invalid", async () => {
  await deployContract();

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"], // TODO: This should not be necessary, xSuite bug
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(2),
        e.Str(TOKEN_ID),
        e.U(0),
      )),
    ]
  });

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "sendToken",
    funcArgs: [
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str(TOKEN_SYMBOL),
    ],
    esdts: [{ id: TOKEN_ID2, amount: 1_000 }],
  }).assertFail({ code: 4, message: "Invalid token sent" });
});

test("Send token external", async () => {
  await deployContract();

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"],
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(2),
        e.Str(TOKEN_ID),
        e.U(0),
      )),
    ]
  });

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "sendToken",
    funcArgs: [
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str(TOKEN_SYMBOL),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually add external token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(2),
        e.Str(TOKEN_ID),
        e.U(0),
      )),

      e.p.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });
});

test("Call contract", async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "callContract",
    funcArgs: [
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str("payload"),
    ]
  });
  // No way to test events currently...

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
    ],
  });
});

test("Call contract with token not exists", async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "callContractWithToken",
    funcArgs: [
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str("payload"),
      e.Str(TOKEN_SYMBOL),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 4, message: "Token does not exist" });
});

test("Call contract with token invalid", async () => {
  await deployContract();

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"],
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(2),
        e.Str(TOKEN_ID),
        e.U(0),
      )),
    ]
  });

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "callContractWithToken",
    funcArgs: [
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str("payload"),
      e.Str(TOKEN_SYMBOL),
    ],
    esdts: [{ id: TOKEN_ID2, amount: 1_000 }],
  }).assertFail({ code: 4, message: "Invalid token sent" });
});

test("Call contract with token", async () => {
  await deployContract();

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"],
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(2),
        e.Str(TOKEN_ID),
        e.U(0),
      )),
    ]
  });

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "callContractWithToken",
    funcArgs: [
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str("payload"),
      e.Str(TOKEN_SYMBOL),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(2),
        e.Str(TOKEN_ID),
        e.U(0),
      )),

      e.p.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });
});

test("Validate contract call error", async () => {
  await deployContract();

  const result = await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "validateContractCall",
    funcArgs: [
      e.Str("commandId"),
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str("payloadHash"),
    ]
  });
  assert(result.returnData[0] === '');

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
    ],
  });
});

test("Validate contract call", async () => {
  await deployContract();

  // get_is_contract_call_approved_key hash
  let data = Buffer.concat([
    Buffer.from("commandId"),
    Buffer.from("ethereum"),
    Buffer.from("0x4976da71bF84D750b5451B053051158EC0A4E876"),
    deployer.toTopBytes(),
    Buffer.from("payloadHash"),
  ]);

  const dataHash = createKeccakHash('keccak256').update(data).digest('hex');

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"],
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually approve call
      e.p.Mapper("contract_call_approved", e.Bytes(dataHash)).Value(e.U8(1)),
    ]
  });

  const result = await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "validateContractCall",
    funcArgs: [
      e.Str("commandId"),
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str("payloadHash"),
    ]
  });
  assert(result.returnData[0] === '01');

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
    ],
  });
});

test("Validate contract call and mint error", async () => {
  await deployContract();

  const result = await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "validateContractCallAndMint",
    funcArgs: [
      e.Str("commandId"),
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str("payloadHash"),
      e.Str(TOKEN_ID),
      e.U(1_000)
    ]
  });
  assert(result.returnData[0] === '');

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
    ],
  });
});

test("Validate contract call and mint external", async () => {
  await deployContract();

  const amount = 1_000;
  let amountHex = amount.toString(16);
  if (amountHex.length % 2) {
    amountHex = '0' + amountHex;
  }

  // get_is_contract_call_approved_key hash
  let data = Buffer.concat([
    Buffer.from("commandId"),
    Buffer.from("ethereum"),
    Buffer.from("0x4976da71bF84D750b5451B053051158EC0A4E876"),
    deployer.toTopBytes(),
    Buffer.from("payloadHash"),
    Buffer.from(TOKEN_SYMBOL),
    Buffer.from(amountHex, 'hex'),
  ]);

  const dataHash = createKeccakHash('keccak256').update(data).digest('hex');

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"],
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually approve call
      e.p.Mapper("contract_call_approved", e.Bytes(dataHash)).Value(e.U8(1)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(2),
        e.Str(TOKEN_ID),
        e.U(0),
      )),

      e.p.Esdts([{ id: TOKEN_ID, amount }]),
    ]
  });

  world.setCurrentBlockInfo({
    timestamp: 21_600 * 10,
  });

  const result = await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: "validateContractCallAndMint",
    funcArgs: [
      e.Str("commandId"),
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Str("payloadHash"),
      e.Str(TOKEN_SYMBOL),
      e.U(amount)
    ]
  });
  assert(result.returnData[0] === '01');

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(2),
        e.Str(TOKEN_ID),
        e.U(0),
      )),

      e.p.Esdts([{ id: TOKEN_ID, amount: 0 }]),

      e.p.Mapper("token_mint_amount", e.Str(TOKEN_SYMBOL), e.U64(10)).Value(e.U(amount)),
    ],
  });

  pairs = await deployer.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 10_000_000_000n,
    allPairs: [
      e.p.Esdts([
        { id: TOKEN_ID, amount: 101_000 },
        { id: TOKEN_ID2, amount: 10_000 }
      ]),
    ],
  });
});
