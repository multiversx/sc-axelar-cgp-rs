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
  deployTokenManagerMintBurn,
  gasService,
  gateway,
  its,
  remoteAddressValidator,
  tokenManagerLockUnlock,
  tokenManagerMintBurn
} from '../itsHelpers';

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
  const payload = e.Buffer(
    e.Tuple(
      e.U(4), // selector deploy and register standardized token
      e.Bytes(tokenId),
      e.Str('TokenName'),
      e.Str('SYMBOL'),
      e.U8(18),
      e.Buffer(user.toTopBytes()),
      e.Buffer(user.toTopBytes()),
      e.U(1_000_000),
      e.Buffer(its.toTopBytes()),
    ).toTopBytes()
  );
  const payloadHash = createKeccakHash('keccak256').update(Buffer.from(payload.toTopHex(), 'hex')).digest('hex');

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

// TODO: Check why an error Tx failed: 10 - failed transfer (insufficient funds) is raised here
// It might be because issuing ESDT tokens doesn't work for the underlying simulnet
// Everything seems fine until the call to `issue_and_set_all_roles` in the token-manager-mint-burn happens
test.skip("Execute deploy and register standardized token", async () => {
  const payload = await mockGatewayCall();

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 600_000_000,
    value: BigInt('5000000000000000'),
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

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID)).Value(TOKEN_ID_MANAGER_ADDRESS),
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

test("Execute deploy and register standardized token only issue esdt", async () => {
  await deployTokenManagerMintBurn(deployer, its);

  const customTokenId = 'd6e2313ee1ab6b70e952156eb974c0ffc2dd3b2ac214d289e57429f0d1c6080b';

  // Mock token manager already deployed as not being canonical so contract deployment is not tried again
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(customTokenId)).Value(tokenManagerMintBurn),
    ],
  });

  const payload = await mockGatewayCall(customTokenId);

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 600_000_000,
    value: BigInt('5000000000000000'),
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

      e.kvs.Mapper('token_manager_address', e.Bytes(customTokenId)).Value(tokenManagerMintBurn),
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
