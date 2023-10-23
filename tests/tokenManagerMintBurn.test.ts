import { afterEach, beforeEach, test } from "vitest";
import { assertAccount, e, SContract, SWallet, SWorld } from "xsuite";
import createKeccakHash from "keccak";
import { CHAIN_NAME_HASH, TOKEN_ID, TOKEN_ID2, TOKEN_ID_CANONICAL, TOKEN_ID_MANAGER_ADDRESS } from './helpers';

let world: SWorld;
let deployer: SWallet;
let gateway: SContract;
let gasService: SContract;
let remoteAddressValidator: SContract;
let contract: SContract;
let address: string;
let user: SWallet;

beforeEach(async () => {
  world = await SWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  })

  deployer = await world.createWallet({
    balance: 10_000_000_000n,
    kvs: [
      e.kvs.Esdts([
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
  user = await world.createWallet({
    balance: BigInt('10000000000000000'),
  });
});

afterEach(async () => {
  await world.terminate();
});

const deployContract = async () => {
  ({ contract: contract, address } = await deployer.deployContract({
    code: "file:token-manager-mint-burn/output/token-manager-mint-burn.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      user,
      e.Bytes(TOKEN_ID_CANONICAL),
      deployer,
      e.Option(null),
    ]
  }));

  const kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
    ],
  });
}

test("Deploy standardized token", async () => {
  await deployContract();

  await user.callContract({
    callee: contract,
    funcName: "deployStandardizedToken",
    gasLimit: 20_000_000,
    value: BigInt('5000000000000000'),
    funcArgs: [
      user,
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000_000),
      user,
    ],
  });

  const kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),

      // TODO: Check how to actually test the async call to the ESDT system contract here
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_token_callback'),
        e.Bytes('00000002'),
        e.U(1_000_000),
        e.Bytes('00000020'),
        user,
      )),
    ],
  });
});

test("Deploy standardized token errors", async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    funcName: "deployStandardizedToken",
    gasLimit: 20_000_000,
    funcArgs: [
      user,
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000_000),
      user,
    ],
  }).assertFail({ code: 4, message: 'Not service' });

  // Manually set token identifier
  await contract.setAccount({
    ...(await contract.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(user),
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    ],
  });

  await user.callContract({
    callee: contract,
    funcName: "deployStandardizedToken",
    gasLimit: 20_000_000,
    funcArgs: [
      user,
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000_000),
      user,
    ],
  }).assertFail({ code: 4, message: 'Token address already exists' });
});
