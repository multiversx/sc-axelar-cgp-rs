import { afterEach, beforeEach, test } from "vitest";
import { assertAccount, e, SWallet, SWorld } from "xsuite";
import createKeccakHash from "keccak";
import {
  CHAIN_ID,
  CHAIN_NAME_HASH, COMMAND_ID, getCommandId, getCommandIdHash,
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
  interchainTokenFactory,
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
    balance: BigInt('100000000000000000'),
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

const mockGatewayCall = async () => {
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      4, // selector deploy and register standardized token
      Buffer.from(TOKEN_ID_CANONICAL, 'hex'),
      'TokenName',
      'SYMBOL',
      18,
      Buffer.from(user.toTopBytes()),
      Buffer.from(user.toTopBytes()),
      1_000_000,
      Buffer.from(its.toTopBytes()),
    ]
  ).substring(2);

  const payloadHash = createKeccakHash('keccak256').update(Buffer.from(payload, 'hex')).digest('hex');

  // Mock contract call approved by gateway
  let data = Buffer.concat([
    Buffer.from(COMMAND_ID, 'hex'),
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
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),

      // Manually approve call
      e.kvs.Mapper("contract_call_approved", e.Bytes(dataHash)).Value(e.U8(1)),
    ]
  });

  return { payload, dataHash };
}

test("Execute deploy and register standardized token only deploy token manager", async () => {
  const { payload, dataHash } = await mockGatewayCall();

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 100_000_000,
    funcArgs: [
      e.Bytes(COMMAND_ID),
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
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(e.Addr(TOKEN_ID_MANAGER_ADDRESS)),
    ],
  });

  // Gateway contract call approved key was NOT removed
  const gatewayKvs = await gateway.getAccountWithKvs();
  assertAccount(gatewayKvs, {
    kvs: [
      e.kvs.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),

      e.kvs.Mapper("contract_call_approved", e.Bytes(dataHash)).Value(e.U8(1)),
    ]
  });
});

test("Execute deploy and register standardized token only issue esdt", async () => {
  await deployTokenManagerMintBurn(deployer, its);

  // Mock token manager already deployed as not being canonical so contract deployment is not tried again
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(tokenManagerMintBurn),
    ],
  });

  const { payload } = await mockGatewayCall();

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 600_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Bytes(COMMAND_ID),
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
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(tokenManagerMintBurn),
    ],
  });

  // Gateway contract call approved key was removed
  const gatewayKvs = await gateway.getAccountWithKvs();
  assertAccount(gatewayKvs, {
    kvs: [
      e.kvs.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),
    ]
  });
});

test("Execute receive token with data errors", async () => {
  let payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256'],
    [
      4, // selector deploy and register standardized token
    ]
  ).substring(2);

  // Invalid other address from other chain
  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str('SomeOtherAddress'),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Not remote service' });

  payload = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes', 'bytes', 'uint256', 'bytes'],
    [
      4, // selector deploy and register standardized token
      Buffer.from(TOKEN_ID_CANONICAL, 'hex'),
      'TokenName',
      'SYMBOL',
      18,
      Buffer.from(user.toTopBytes()),
      Buffer.from(user.toTopBytes()),
      1_000_000,
      Buffer.from(its.toTopBytes()),
    ]
  ).substring(2);

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 100_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Bytes(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload
    ],
  }).assertFail({ code: 4, message: 'Not approved by gateway' });

  // Mock token manager exists
  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID)
    ],
  });

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 20_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Bytes(COMMAND_ID),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload
    ],
  }).assertFail({ code: 4, message: 'Not approved by gateway' });
});
