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
  computeCustomTokenId,
  deployContracts,
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
let otherUser: SWallet;

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
  otherUser = await world.createWallet({
    balance: BigInt('10000000000000000'),
  });

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  await world.terminate();
});

const mockGatewayCall = async (tokenId: string) => {
  const payload = e.Buffer(
    e.Tuple(
      e.U(1), // selector receive token
      e.Bytes(tokenId),
      e.Buffer(otherUser.toTopBytes()),
      e.U(1_000),
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

test("Execute receive token mint/burn", async () => {
  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID),
      e.U8(0), // Mint/burn
      its,
    ],
  });

  const computedTokenId = computeCustomTokenId(user, TOKEN_ID);

  // Set mint/burn role for token
  let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  tokenManager.setAccount({
    ...(await tokenManager.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Esdts([{ id: TOKEN_ID, roles: ['ESDTRoleLocalMint', 'ESDTRoleLocalBurn'] }]),
    ],
  });

  const payload = await mockGatewayCall(computedTokenId);

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
  });

  // Tokens should be minted for otherUser and token manager should have flow set
  const otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    balance: BigInt('10000000000000000'),
    kvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Esdts([{ id: TOKEN_ID, roles: ['ESDTRoleLocalMint', 'ESDTRoleLocalBurn'] }]),
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

test("Execute receive token lock/unlock", async () => {
  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID)
    ],
  });

  // Set token amount
  let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  await tokenManager.setAccount({
    ...(await tokenManager.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  const payload = await mockGatewayCall(TOKEN_ID_CANONICAL);

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
  });

  // Tokens should be minted for otherUser and token manager should have flow set
  const otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    balance: BigInt('10000000000000000'),
    kvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 0 }]),
    ],
  });
});

test("Execute receive token flow limit", async () => {
  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID),
      e.U8(0), // Mint/burn
      its,
    ],
  });

  const computedTokenId = computeCustomTokenId(user, TOKEN_ID);

  // Set mint/burn role for token and flow limit
  let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  await tokenManager.setAccount({
    ...(await tokenManager.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Mapper('flow_limit').Value(e.U(1_000)),
      e.kvs.Esdts([{ id: TOKEN_ID, roles: ['ESDTRoleLocalMint', 'ESDTRoleLocalBurn'] }]),
    ],
  });

  let payload = await mockGatewayCall(computedTokenId);

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
  });

  let tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Mapper('flow_limit').Value(e.U(1_000)),
      e.kvs.Esdts([{ id: TOKEN_ID, roles: ['ESDTRoleLocalMint', 'ESDTRoleLocalBurn'] }]),

      e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(1_000)),
    ],
  });

  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600 - 1,
  });

  // Can not call again because flow limit for this epoch (6 hours) was exceeded
  payload = await mockGatewayCall(computedTokenId);

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
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

  // After the required time has passed, tokens can flow again
  await world.setCurrentBlockInfo({
    timestamp: 6 * 3600,
  });

  payload = await mockGatewayCall(computedTokenId);

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
  });

  tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Mapper('flow_limit').Value(e.U(1_000)),
      e.kvs.Esdts([{ id: TOKEN_ID, roles: ['ESDTRoleLocalMint', 'ESDTRoleLocalBurn'] }]),

      e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(1_000)),
      e.kvs.Mapper('flow_in_amount', e.U64(1)).Value(e.U(1_000)),
    ],
  });
});

test("Execute receive token express caller", async () => {
  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID),
      e.U8(0), // Mint/burn
      its,
    ],
  });

  const computedTokenId = computeCustomTokenId(user, TOKEN_ID);

  // Set mint/burn role for token
  let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  await tokenManager.setAccount({
    ...(await tokenManager.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Esdts([{ id: TOKEN_ID, roles: ['ESDTRoleLocalMint', 'ESDTRoleLocalBurn'] }]),
    ],
  });

  let payload = await mockGatewayCall(computedTokenId);

  const data = Buffer.concat([
    Buffer.from(payload.toTopHex(), 'hex'),
    Buffer.from('commandId'),
  ]);
  const expressReceiveSlot = createKeccakHash('keccak256').update(data).digest('hex');

  // Mock otherUser as express caller
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(TOKEN_ID_MANAGER_ADDRESS)),

      e.kvs.Mapper('express_receive_token_slot', e.Bytes(expressReceiveSlot)).Value(otherUser),
    ],
  });

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
  });

  // Tokens should be minted for otherUser
  const otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    balance: BigInt('10000000000000000'),
    kvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
    ],
  });

  // Gateway contract call approved key was removed
  const gatewayKvs = await gateway.getAccountWithKvs();
  assertAccount(gatewayKvs, {
    kvs: [
      e.kvs.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
    ]
  });

  // Assert express receive token slot was deleted
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

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(TOKEN_ID_MANAGER_ADDRESS)),
    ],
  });

  // Nothing changed for token manager
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Esdts([{ id: TOKEN_ID, roles: ['ESDTRoleLocalMint', 'ESDTRoleLocalBurn'] }]),
    ],
  });
});

test.only("Execute receive token errors", async () => {
  // Invalid other address from other chain
  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
      e.Str('SomeOtherAddress'),
      e.Buffer(
        e.Tuple(e.U(1)).toTopBytes()
      ),
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
      e.Buffer(
        e.Tuple(e.U(1)).toTopBytes()
      ),
    ],
  }).assertFail({ code: 4, message: 'Not approved by gateway' });

  const payload = e.Buffer(
    e.Tuple(e.U(5)).toTopBytes()
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
  }).assertFail({ code: 4, message: 'Selector unknown' });
});
