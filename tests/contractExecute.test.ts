import { afterEach, beforeEach, test, assert } from "vitest";
import { assertAccount } from "xsuite/assert";
import { FWorld, FWorldContract, FWorldWallet } from "xsuite/world";
import { e } from "xsuite/data";
import createKeccakHash from "keccak";
import {
  ALICE_ADDR,
  BOB_ADDR, DEFAULT_ESDT_ISSUE_COST,
  generateProof,
  generateSignature,
  getOperatorsHash,
  MOCK_CONTRACT_ADDRESS_2, TOKEN_ID, TOKEN_SYMBOL
} from './helpers';

let world: FWorld;
let deployer: FWorldWallet;
let contract: FWorldContract;
let address: string;
let contractAuth: FWorldContract;
let addressAuth: string;

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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),
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
  return createKeccakHash('keccak256').update(Buffer.from(commandId)).digest('hex');
}

const setSupportedToken = async (mintLimit: number = 0) => {
  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"],
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(1),
        e.Str(TOKEN_ID),
        e.U(mintLimit),
      )),

      e.p.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ]
  });
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

test("Execute command already executed", async () => {
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

  const commandIdHash = getCommandIdHash();

  await contract.setAccount({
    ...await contract.getAccount(),
    owner: address,
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(0)),
    ]
  });

  await deployer.callContract({
    callee: contract,
    gasLimit: 12_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(0)),
    ],
  });
});

test("Execute deploy token internal burnable from no issue cost", async () => {
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

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),
    ],
  });
});

test("Execute deploy token internal burnable from", async () => {
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

  await contract.setAccount({
    ...await contract.getAccount(),
    owner: address,
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // ESDT issue cost is smaller on devnet
      e.p.Mapper("esdt_issue_cost").Value(e.U(500_000_000_000_000n)),
    ]
  });

  await deployer.setAccount({
    ...(await deployer.getAccount()),
    balance: 500_000_000_000_000n,
  })

  await deployer.callContract({
    callee: contract,
    gasLimit: 20_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
    value: 500_000_000_000_000n,
  });

  // TODO: Currently there is no way to actually test ESDT deployment
  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(500_000_000_000_000n)),

      // Callback for token deploy is stored in storage
      ['43425f434c4f535552452e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e', '000000156465706c6f795f746f6b656e5f63616c6c6261636b00000003000000055745474c44000000030f424000000009636f6d6d616e644964'],
    ],
  });

  let pairsDeployer = await deployer.getAccountWithPairs();
  assertAccount(pairsDeployer, {
    balance: 0,
    allPairs: [],
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(1),
        e.Str(TOKEN_ID),
        e.U(1_000_000),
      )),
    ],
  });
});

test("Execute deploy token already exists", async () => {
  await deployContract();

  await contract.setAccount({
    ...(await contract.getAccount()),
    owner: deployer,
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(1),
        e.Str(TOKEN_ID),
        e.U(1_000_000),
      )),
    ],
  });

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
          e.Option(e.Str(TOKEN_ID)),
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(1),
        e.Str(TOKEN_ID),
        e.U(1_000_000),
      )),
    ],
  });
});

test("Execute deploy token multiple error", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandId2")),
    e.List(e.Str("deployToken"), e.Str("deployToken")),
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
      ),
      e.Buffer(
        e.Tuple(
          e.Str("name2"),
          e.Str("WEGLD2"),
          e.U8(18),
          e.U(2_000_000),
          e.Option(null),
          e.U(1_000_000),
        ).toTopBytes(),
      ),
    )
  );

  const { proof } = generateProof(data);

  await deployer.setAccount({
    ...(await deployer.getAccount()),
    balance: 50_000_000_000_000_000n,
  })

  await deployer.callContract({
    callee: contract,
    gasLimit: 20_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
    value: 50_000_000_000_000_000n,
  }).assertFail({ code: 4, message: 'Only one InternalBurnableFrom token deploy command is allowed per transaction' });
});

test("Execute deploy token internal burnable from and external", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandId2")),
    e.List(e.Str("deployToken"), e.Str("deployToken")),
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
      ),
      e.Buffer(
        e.Tuple(
          e.Str("name"),
          e.Str(TOKEN_SYMBOL),
          e.U8(18),
          e.U(2_000_000),
          e.Option(e.Str(TOKEN_ID)),
          e.U(1_000_000),
        ).toTopBytes(),
      )
    )
  );

  const { proof } = generateProof(data);

  await contract.setAccount({
    ...await contract.getAccount(),
    owner: address,
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),

      // ESDT issue cost is smaller on devnet
      e.p.Mapper("esdt_issue_cost").Value(e.U(500_000_000_000_000n)),
    ]
  });

  await deployer.setAccount({
    ...(await deployer.getAccount()),
    balance: 500_000_000_000_000n,
  })

  await deployer.callContract({
    callee: contract,
    gasLimit: 20_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
    value: 500_000_000_000_000n,
  });

  const commandIdHash = getCommandIdHash('commandId2');

  const pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(500_000_000_000_000n)),

      // Callback for token deploy is stored in storage
      ['43425f434c4f535552452e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e', '000000156465706c6f795f746f6b656e5f63616c6c6261636b00000003000000055745474c44000000030f424000000009636f6d6d616e644964'],

      // Only deploy token external command was executed
      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(1),
        e.Str(TOKEN_ID),
        e.U(1_000_000),
      )),
    ],
  });

  const pairsDeployer = await deployer.getAccountWithPairs();
  assertAccount(pairsDeployer, {
    balance: 0,
    allPairs: [],
  });
});

test("Execute mint token not exists", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandIdInvalid")),
    e.List(e.Str("mintToken"), e.Str("mintToken")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str(TOKEN_SYMBOL),
          e.Addr(deployer.toString()),
          e.U(1_000),
        ).toTopBytes(),
      ),
      e.Buffer(
        e.Tuple(
          e.Str("OTHER"),
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

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),
    ],
  });
});

test("Execute mint token limit exceeded", async () => {
  await deployContract();

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"],
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(1),
        e.Str(TOKEN_ID),
        e.U(1_000),
      )),

      e.p.Mapper("token_mint_amount", e.Str(TOKEN_SYMBOL), e.U64(10)).Value(e.U(1)),
    ]
  });

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandIdInvalid")),
    e.List(e.Str("mintToken"), e.Str("mintToken")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str(TOKEN_SYMBOL),
          e.Addr(deployer.toString()),
          e.U(1_000),
        ).toTopBytes(),
      ),
      e.Buffer(
        e.Tuple(
          e.Str("OTHER"),
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

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(1),
        e.Str(TOKEN_ID),
        e.U(1_000),
      )),

      e.p.Mapper("token_mint_amount", e.Str(TOKEN_SYMBOL), e.U64(10)).Value(e.U(1)),
    ],
  });
});

test("Execute mint token external", async () => {
  await deployContract();

  await setSupportedToken();

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandIdInvalid")),
    e.List(e.Str("mintToken"), e.Str("mintToken")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str(TOKEN_SYMBOL),
          e.Addr(deployer.toString()),
          e.U(1_000),
        ).toTopBytes(),
      ),
      e.Buffer(
        e.Tuple(
          e.Str("OTHER"),
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(1),
        e.Str(TOKEN_ID),
        e.U(0),
      )),

      e.p.Mapper("token_mint_amount", e.Str(TOKEN_SYMBOL), e.U64(10)).Value(e.U(1_000)),
    ],
  });

  let pairsDeployer = await deployer.getAccountWithPairs();
  assertAccount(pairsDeployer, {
    balance: 10_000_000_000n,
    allPairs: [
      e.p.Esdts([
        {
          id: TOKEN_ID,
          amount: 101_000,
        }
      ])
    ]
  });
});

test("Execute mint token internal burnable from", async () => {
  await deployContract();

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"],
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      // Manually add InternalBurnableFrom supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(0),
        e.Str(TOKEN_ID),
        e.U(0),
      )),

      // Amount is 0 since token will be minted
      e.p.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalMint'] }]),
    ]
  });

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandIdInvalid")),
    e.List(e.Str("mintToken"), e.Str("mintToken")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str(TOKEN_SYMBOL),
          e.Addr(deployer.toString()),
          e.U(1_000),
        ).toTopBytes(),
      ),
      e.Buffer(
        e.Tuple(
          e.Str("OTHER"),
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(0),
        e.Str(TOKEN_ID),
        e.U(0),
      )),

      e.p.Mapper("token_mint_amount", e.Str(TOKEN_SYMBOL), e.U64(10)).Value(e.U(1_000)),

      e.p.Esdts([{ id: TOKEN_ID, amount: 0, roles: ['ESDTRoleLocalMint'] }]),
    ],
  });

  let pairsDeployer = await deployer.getAccountWithPairs();
  assertAccount(pairsDeployer, {
    balance: 10_000_000_000n,
    allPairs: [
      e.p.Esdts([
        {
          id: TOKEN_ID,
          amount: 101_000,
        }
      ])
    ]
  });
});

test("Execute mint token valid limit", async () => {
  await deployContract();

  await setSupportedToken(1_000);

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandIdInvalid")),
    e.List(e.Str("mintToken"), e.Str("mintToken")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.Str(TOKEN_SYMBOL),
          e.Addr(deployer.toString()),
          e.U(1_000),
        ).toTopBytes(),
      ),
      e.Buffer(
        e.Tuple(
          e.Str("OTHER"),
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      // Manually add supported token
      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(1),
        e.Str(TOKEN_ID),
        e.U(1_000),
      )),

      e.p.Mapper("token_mint_amount", e.Str(TOKEN_SYMBOL), e.U64(10)).Value(e.U(1_000)),
    ],
  });

  let pairsDeployer = await deployer.getAccountWithPairs();
  assertAccount(pairsDeployer, {
    balance: 10_000_000_000n,
    allPairs: [
      e.p.Esdts([
        {
          id: TOKEN_ID,
          amount: 101_000,
        }
      ])
    ]
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

  // get_is_contract_call_approved_key hash
  let approvedData = Buffer.concat([
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

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

  // get_is_contract_call_approved_key hash
  let approvedData = Buffer.concat([
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),

      e.p.Mapper("contract_call_approved", e.Bytes(approvedDataHash)).Value(e.U8(1)),
    ],
  });
});

test("Execute transfer operatorship old proof", async () => {
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

  let pairs = await contract.getAccountWithPairs();
  assertAccount(pairs, {
    balance: 0,
    allPairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),
    ],
  });
});

test("Execute transfer operatorship", async () => {
  await deployContract();

  // Second transferOperatorship command will be ignored
  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandId2")),
    e.List(e.Str("transferOperatorship"), e.Str("transferOperatorship")),
    e.List(
      e.Buffer(
        e.Tuple(
          e.List(e.Addr(BOB_ADDR)),
          e.List(e.U(2)),
          e.U(2),
        ).toTopBytes()
      ),
      e.Buffer(
        e.Tuple(
          e.List(e.Addr(ALICE_ADDR)),
          e.List(e.U(5)),
          e.U(5),
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

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

test("Execute set esdt issue cost", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId")),
    e.List(e.Str("setESDTIssueCost")),
    e.List(
      e.Buffer(e.U(5_000).toTopBytes()),
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(5_000)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),
    ],
  });
});

test("Execute multiple commands", async () => {
  await deployContract();

  const data = e.Tuple(
    e.List(e.Str("commandId"), e.Str("commandId2"), e.Str("commandIdInvalid"), e.Str("commandId3")),
    e.List(e.Str("setESDTIssueCost"), e.Str("deployToken"), e.Str("deployToken"), e.Str("approveContractCall")),
    e.List(
      e.Buffer(e.U(5_000).toTopBytes()),
      e.Buffer(
        e.Tuple(
          e.Str("name"),
          e.Str(TOKEN_SYMBOL),
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
      ),
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
    gasLimit: 25_000_000,
    funcName: "execute",
    funcArgs: [
      data,
      proof,
    ],
  });

  const commandIdHash = getCommandIdHash();
  const commandId2Hash = getCommandIdHash('commandId2');
  const commandId3Hash = getCommandIdHash('commandId3');

  // get_is_contract_call_approved_key hash
  let approvedData = Buffer.concat([
    Buffer.from("commandId3"),
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
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(5_000)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),
      e.p.Mapper("command_executed", e.Bytes(commandId2Hash)).Value(e.U8(1)),
      e.p.Mapper("command_executed", e.Bytes(commandId3Hash)).Value(e.U8(1)),

      e.p.Mapper("supported_tokens", e.Str(TOKEN_SYMBOL)).Value(e.Tuple(
        e.U8(1),
        e.Str(TOKEN_ID),
        e.U(1_000_000),
      )),

      e.p.Mapper("contract_call_approved", e.Bytes(approvedDataHash)).Value(e.U8(1)),
    ],
  });
});

test("View functions", async () => {
  await deployContract();

  const approvedData = Buffer.concat([
    Buffer.from("commandId"),
    Buffer.from("ethereum"),
    Buffer.from("0x4976da71bF84D750b5451B053051158EC0A4E876"),
    deployer.toTopBytes(),
    Buffer.from("payloadHash"),
  ]);
  const approvedDataHash = createKeccakHash('keccak256').update(approvedData).digest('hex');

  const amount = 1_000;
  let amountHex = amount.toString(16);
  if (amountHex.length % 2) {
    amountHex = '0' + amountHex;
  }

  const approvedDataMint = Buffer.concat([
    Buffer.from("commandId"),
    Buffer.from("ethereum"),
    Buffer.from("0x4976da71bF84D750b5451B053051158EC0A4E876"),
    deployer.toTopBytes(),
    Buffer.from("payloadHash"),
    Buffer.from(TOKEN_ID),
    Buffer.from(amountHex, 'hex'),
  ]);

  const approvedDataHashMint = createKeccakHash('keccak256').update(approvedDataMint).digest('hex');

  const commandIdHash = getCommandIdHash();

  await contract.setAccount({
    ...await contract.getAccount(),
    codeMetadata: ["payable"],
    pairs: [
      e.p.Mapper("auth_module").Value(e.Addr(addressAuth)),
      e.p.Mapper("mint_limiter").Value(e.Addr(MOCK_CONTRACT_ADDRESS_2)),
      e.p.Mapper("esdt_issue_cost").Value(e.U(DEFAULT_ESDT_ISSUE_COST)),

      e.p.Mapper("contract_call_approved", e.Bytes(approvedDataHash)).Value(e.U8(1)),
      e.p.Mapper("contract_call_approved", e.Bytes(approvedDataHashMint)).Value(e.U8(1)),

      e.p.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),
    ]
  });

  let result = await world.query({
    callee: contract,
    funcName: 'isContractCallApproved',
    funcArgs: [
      e.Str("commandId"),
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Addr(deployer.toString()),
      e.Str("payloadHash")
    ],
  });
  assert(result.returnData[0] === '01');

  result = await world.query({
    callee: contract,
    funcName: 'isContractCallAndMintApproved',
    funcArgs: [
      e.Str("commandId"),
      e.Str("ethereum"),
      e.Str("0x4976da71bF84D750b5451B053051158EC0A4E876"),
      e.Addr(deployer.toString()),
      e.Str("payloadHash"),
      e.Str(TOKEN_ID),
      e.U(amount),
    ],
  });
  assert(result.returnData[0] === '01');

  result = await world.query({
    callee: contract,
    funcName: 'isCommandExecuted',
    funcArgs: [
      e.Str("commandId"),
    ],
  });
  assert(result.returnData[0] === '01');
});
