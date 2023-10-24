import { afterEach, beforeEach, test } from "vitest";
import { assertAccount, e, SWallet, SWorld } from "xsuite";
import createKeccakHash from "keccak";
import {
  CHAIN_NAME_HASH, getCommandIdHash, MOCK_CONTRACT_ADDRESS_1, OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2, TOKEN_ID2_CUSTOM, TOKEN_ID2_MANAGER_ADDRESS,
  TOKEN_ID_CANONICAL,
  TOKEN_ID_MANAGER_ADDRESS
} from '../helpers';
import { Buffer } from 'buffer';
import {
  computeCustomTokenId,
  deployContracts, deployPingPongInterchain,
  gasService,
  gateway,
  its, mockGatewayCall, pingPong,
  remoteAddressValidator,
  tokenManagerLockUnlock,
  tokenManagerMintBurn
} from './itsHelpers';

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

const mockGatewayCall = async (tokenId: string, fnc = 'ping') => {
  const payload = e.Buffer(
    e.Tuple(
      e.U(2), // selector receive token with data
      e.Bytes(tokenId),
      e.Buffer(pingPong.toTopBytes()), // destination address
      e.U(1_000),
      e.Buffer(otherUser.toTopBytes()), // source address (in this case address for ping)
      e.Buffer(
        e.Str(fnc).toTopBytes() // data passed to contract, in this case the function as a string
      )
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

test("Execute receive token with data", async () => {
  await deployPingPongInterchain(deployer);

  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('EGLD'),
      e.U8(2), // Lock/unlock
      its,
    ],
  });

  const computedTokenId = computeCustomTokenId(user, 'EGLD');

  // Set egld balance for token manager
  let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  await tokenManager.setAccount({
    ...(await tokenManager.getAccountWithKvs()),
    balance: 1_000,
  });

  const payload = await mockGatewayCall(computedTokenId);

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

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(TOKEN_ID_MANAGER_ADDRESS)),
    ],
  });

  // Assert ping pong was successfully called
  const pingPongKvs = await pingPong.getAccountWithKvs();
  assertAccount(pingPongKvs, {
    balance: 1_000,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
      e.kvs.Mapper('deadline').Value(e.U64(10)),
      e.kvs.Mapper('activationTimestamp').Value(e.U64(0)),
      e.kvs.Mapper('maxFunds').Value(e.Option(null)),

      // User mapper
      e.kvs.Mapper('user_address_to_id', otherUser).Value(e.U32(1)),
      e.kvs.Mapper('user_id_to_address', e.U32(1)).Value(otherUser),
      e.kvs.Mapper('user_count').Value(e.U32(1)),

      e.kvs.Mapper('userStatus', e.U32(1)).Value(e.U8(1)),
    ],
  });

  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str('EGLD')),
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

// TODO: This doesn't seem to work currently, the callback is not executed properly. Find out why
test.skip("Execute receive token with data error", async () => {
  await deployPingPongInterchain(deployer);

  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('EGLD'),
      e.U8(2), // Lock/unlock
      its,
    ],
  });

  const computedTokenId = computeCustomTokenId(user, 'EGLD');

  // Set egld balance for token manager
  let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  await tokenManager.setAccount({
    ...(await tokenManager.getAccountWithKvs()),
    balance: 1_000,
  });

  const payload = await mockGatewayCall(computedTokenId, 'sth');

  await user.callContract({
    callee: its,
    funcName: "execute",
    gasLimit: 600_000_000,
    funcArgs: [
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
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

  // Assert ping pong was NOT called
  const pingPongKvs = await pingPong.getAccountWithKvs();
  assertAccount(pingPongKvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
      e.kvs.Mapper('deadline').Value(e.U64(10)),
      e.kvs.Mapper('activationTimestamp').Value(e.U64(0)),
      e.kvs.Mapper('maxFunds').Value(e.Option(null)),
    ],
  });

  // Assert token manager still has the tokens
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 1_000,
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str('EGLD')),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),
    ],
  });

  // Gateway contract call approved key was removed
  const gatewayKvs = await gateway.getAccountWithKvs();
  assertAccount(gatewayKvs, {
    kvs: [
      e.kvs.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
    ]
  });
});

test("Execute receive token with data express caller", async () => {
  await deployPingPongInterchain(deployer);

  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('EGLD'),
      e.U8(2), // Lock/unlock
      its,
    ],
  });

  const computedTokenId = computeCustomTokenId(user, 'EGLD');

  // Set egld balance for token manager
  let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  await tokenManager.setAccount({
    ...(await tokenManager.getAccountWithKvs()),
    balance: 1_000,
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
    balance: BigInt('10000000000001000'),
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

  // Tokens were moved from token manager
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str('EGLD')),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),
    ],
  });
});
