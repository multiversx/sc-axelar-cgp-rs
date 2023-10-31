import { afterEach, beforeEach, test } from "vitest";
import { assertAccount, e, SWallet, SWorld } from "xsuite";
import createKeccakHash from "keccak";
import {
  CHAIN_NAME_HASH,
  MOCK_CONTRACT_ADDRESS_1,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_ID_CANONICAL,
  TOKEN_ID_MANAGER_ADDRESS
} from '../helpers';
import { Buffer } from 'buffer';
import {
  deployContracts,
  gasService,
  gateway,
  its,
  remoteAddressValidator,
  tokenManagerLockUnlock,
  tokenManagerMintBurn
} from '../itsHelpers';
import { AbiCoder } from 'ethers';

let world: SWorld;
let deployer: SWallet;
let collector: SWallet;
let user: SWallet;

beforeEach(async () => {
  world = await SWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
    timestamp: 0,
  })

  collector = await world.createWallet();
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

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  await world.terminate();
});

const mockGatewayCall = async (tokenId = TOKEN_ID_CANONICAL) => {
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'uint8', 'bytes'],
    [
      3, // selector deploy token manager
      Buffer.from(tokenId, 'hex'),
      0, // Mint/Burn
      Buffer.from(
        e.Tuple(
          its,
          e.Str(TOKEN_ID),
        ).toTopBytes(),
      )
    ]
  ).substring(2);

  const payloadHash = createKeccakHash('keccak256').update(Buffer.from(payload, 'hex')).digest('hex');

  // Mock contract call approved by gateway
  let data = Buffer.concat([
    Buffer.from("commandId"),
    Buffer.from(OTHER_CHAIN_NAME),
    Buffer.from(OTHER_CHAIN_ADDRESS),
    its.toTopBytes(),
    Buffer.from(payloadHash, 'hex'),
  ]);

  const dataHash = createKeccakHash('keccak256').update(data).digest('hex');
  await gateway.setAccount({
    ...await gateway.getAccount(),
    codeMetadata: [],
    kvs: [
      e.kvs.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),

      // Manually approve call
      e.kvs.Mapper("contract_call_approved", e.Bytes(dataHash)).Value(e.U8(1)),
    ]
  });

  return payload;
}

test("Execute deploy token manager", async () => {
  const payload = await mockGatewayCall();

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 50_000_000,
    funcArgs: [
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(e.Addr(TOKEN_ID_MANAGER_ADDRESS)),
    ],
  });

  const tokenManager = world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),
    ],
  });

  // Gateway contract call approaved key was removed
  const gatewayKvs = await gateway.getAccountWithKvs();
  assertAccount(gatewayKvs, {
    kvs: [
      e.kvs.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
    ]
  });
});

test("Execute deploy token manager errors", async () => {
  let payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256'],
    [
      3, // selector deploy token manager
    ]
  ).substring(2);

  // Invalid other address from other chain
  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
      e.Str('SomeOtherAddress'),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Not remote service' });

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Not approved by gateway' });

  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID)
    ],
  });

  payload = await mockGatewayCall();

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 50_000_000,
    funcArgs: [
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Token manager already exists' });
});
