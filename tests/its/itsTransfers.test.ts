import { afterEach, beforeEach, test } from "vitest";
import { assertAccount, e, SWallet, SWorld } from "xsuite";
import createKeccakHash from "keccak";
import {
  CHAIN_NAME_HASH,
  getCommandIdHash,
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
  computeStandardizedTokenId,
  deployContracts,
  deployPingPongInterchain,
  gasService,
  gateway,
  its,
  pingPong,
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

test("Express receive token", async () => {
  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID)
    ],
  });

  const payload = e.Bytes(
    e.Tuple(
      e.U(1),
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Buffer(otherUser.toTopBytes()),
      e.U(100_000),
    ).toTopBytes()
  );

  await user.callContract({
    callee: its,
    funcName: "expressReceiveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      payload,
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
    ],
    esdts: [{ id: TOKEN_ID, amount: 100_000 }]
  });

  // Assert express receive slot set
  const data = Buffer.concat([
    Buffer.from(payload.toTopHex(), 'hex'),
    Buffer.from('commandId'),
  ]);
  const expressReceiveSlot = createKeccakHash('keccak256').update(data).digest('hex');

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

      e.kvs.Mapper('express_receive_token_slot', e.Bytes(expressReceiveSlot)).Value(user),
    ],
  });

  const otherUserKvs = await otherUser.getAccountWithKvs();
  assertAccount(otherUserKvs, {
    balance: BigInt('10000000000000000'),
    allKvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 100_000 }]),
    ],
  });
});

test("Express receive token with data", async () => {
  await deployPingPongInterchain(deployer);

  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('EGLD')
    ],
  });

  const computedTokenId = computeStandardizedTokenId('EGLD');

  const payload = e.Bytes(
    e.Tuple(
      e.U(2),
      e.Bytes(computedTokenId),
      e.Buffer(pingPong.toTopBytes()), // destination address
      e.U(1_000),
      e.Buffer(otherUser.toTopBytes()), // source address (in this case address for ping)
      e.Buffer(
        e.Str("ping").toTopBytes() // data passed to contract, in this case the string "ping"
      )
    ).toTopBytes()
  );

  await user.callContract({
    callee: its,
    funcName: "expressReceiveToken",
    gasLimit: 30_000_000,
    value: 1_000,
    funcArgs: [
      payload,
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  // Assert express receive slot set
  const data = Buffer.concat([
    Buffer.from(payload.toTopHex(), 'hex'),
    Buffer.from('commandId'),
  ]);
  const expressReceiveSlot = createKeccakHash('keccak256').update(data).digest('hex');

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

      e.kvs.Mapper('express_receive_token_slot', e.Bytes(expressReceiveSlot)).Value(user),
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
});

// TODO: This doesn't seem to work currently, maybe because the callback uses too much gas?
// Maybe wait for Async v2 and see if that fixes this since the callback gas can be manually specified
test.skip("Express receive token with data error", async () => {
  await deployPingPongInterchain(deployer);

  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('EGLD')
    ],
  });

  const computedTokenId = computeStandardizedTokenId('EGLD');

  const payload = e.Bytes(
    e.Tuple(
      e.U(2), // selector receive token with data
      e.Bytes(computedTokenId),
      e.Buffer(pingPong.toTopBytes()), // destination address
      e.U(1_000),
      e.Buffer(otherUser.toTopBytes()), // source address (in this case address for ping)
      e.Buffer(
        e.Str("sth").toTopBytes() // data passed to contract, in this case the string "sth" which will give an error
      )
    ).toTopBytes()
  );

  await user.callContract({
    callee: its,
    funcName: "expressReceiveToken",
    gasLimit: 600_000_000,
    value: 1_000,
    funcArgs: [
      payload,
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  // Assert express receive slot NOT set
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

  const userKvs = await user.getAccountWithKvs();
  assertAccount(userKvs, {
    balance: BigInt('10000000000000000'),
  })
});

test("Express receive token errors", async () => {
  await user.callContract({
    callee: its,
    funcName: "expressReceiveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(
        e.Tuple(
          e.U(1),
          e.Bytes(TOKEN_ID_CANONICAL),
          e.Buffer(otherUser.toTopBytes()),
          e.U(100_000),
        ).toTopBytes()
      ),
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'Token manager does not exist' });

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
    funcName: "expressReceiveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(
        e.Tuple(
          e.U(3),
          e.Bytes(TOKEN_ID_CANONICAL),
          e.Buffer(otherUser.toTopBytes()),
          e.U(100_000),
        ).toTopBytes()
      ),
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'Invalid express selector' });

  await user.callContract({
    callee: its,
    funcName: "expressReceiveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(
        e.Tuple(
          e.U(1),
          e.Bytes(TOKEN_ID_CANONICAL),
          e.Buffer(otherUser.toTopBytes()),
          e.U(100_000),
        ).toTopBytes()
      ),
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
    ],
    esdts: [{ id: TOKEN_ID, amount: 99_999 }]
  }).assertFail({ code: 10, message: 'insufficient funds' });

  // Can not call twice for same call
  await user.callContract({
    callee: its,
    funcName: "expressReceiveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(
        e.Tuple(
          e.U(1),
          e.Bytes(TOKEN_ID_CANONICAL),
          e.Buffer(otherUser.toTopBytes()),
          e.U(100_000),
        ).toTopBytes()
      ),
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
    ],
    esdts: [{ id: TOKEN_ID, amount: 100_000 }]
  });

  await user.callContract({
    callee: its,
    funcName: "expressReceiveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(
        e.Tuple(
          e.U(1),
          e.Bytes(TOKEN_ID_CANONICAL),
          e.Buffer(otherUser.toTopBytes()),
          e.U(100_000),
        ).toTopBytes()
      ),
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'Already express called' });

  const commandIdHash = getCommandIdHash();

  // Mock command executed
  await gateway.setAccount({
    ...await gateway.getAccount(),
    codeMetadata: [],
    kvs: [
      e.kvs.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),

      e.kvs.Mapper("command_executed", e.Bytes(commandIdHash)).Value(e.U8(1)),
    ]
  });

  await user.callContract({
    callee: its,
    funcName: "expressReceiveToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(
        e.Tuple(
          e.U(1),
          e.Bytes(TOKEN_ID_CANONICAL),
          e.Buffer(otherUser.toTopBytes()),
          e.U(100_000),
        ).toTopBytes()
      ),
      e.Str('commandId'),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'Already executed' });
});

test("Interchain transfer", async () => {
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
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''), // No metadata, uses default
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Assert NO gas was paid for cross chain call
  let kvs = await gasService.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  const tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  let tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]), // Lock/Unlock token manager holds tokens in the contract
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...

  // Specify custom metadata
  await user.callContract({
    callee: its,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Tuple(
        e.U32(0),
        e.Str('sth'),
      ),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  kvs = await gasService.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 2_000 }]),
    ],
  });
});

test("Interchain transfer errors", async () => {
  await user.callContract({
    callee: its,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    value: 1_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''), // No metadata
    ],
  }).assertFail({ code: 4, message: 'Token manager does not exist' });

  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID)
    ],
  });

  // Sending wrong token
  await user.callContract({
    callee: its,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    value: 1_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''), // No metadata
    ],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

  await user.callContract({
    callee: its,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Tuple(
        e.U32(1), // Wrong Metadata version,
        e.Str('sth'),
      ),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 4, message: 'Invalid metadata version' });

  // Sending to unsupported chain
  await user.callContract({
    callee: its,
    funcName: "interchainTransfer",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str('Unsupported-Chain'),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''), // No metadata
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });
});

test("Send token with data", async () => {
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
    funcName: "sendTokenWithData",
    gasLimit: 20_000_000,
    value: 1_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''), // No data
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  // Assert NO gas was paid for cross chain call
  let kvs = await gasService.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  const tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  let tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]), // Lock/Unlock token manager holds tokens in the contract
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...

  // Specify custom data
  await user.callContract({
    callee: its,
    funcName: "sendTokenWithData",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Str('sth'),
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  });

  kvs = await gasService.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Esdts([{ id: TOKEN_ID, amount: 2_000 }]),
    ],
  });
});

test("Send token with data errors", async () => {
  await user.callContract({
    callee: its,
    funcName: "sendTokenWithData",
    gasLimit: 20_000_000,
    value: 1_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''), // No metadata
    ],
  }).assertFail({ code: 4, message: 'Token manager does not exist' });

  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID)
    ],
  });

  // Sending wrong token
  await user.callContract({
    callee: its,
    funcName: "sendTokenWithData",
    gasLimit: 20_000_000,
    value: 1_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''), // No data
    ],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

  // Sending to unsupported chain
  await user.callContract({
    callee: its,
    funcName: "sendTokenWithData",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str('Unsupported-Chain'),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.Buffer(''), // No metadata
    ],
    esdts: [{ id: TOKEN_ID, amount: 1_000 }],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });
});

test("Transmit send token", async () => {
  // Mock token manager being user to be able to test the transmitSendToken function
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(user),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: "transmitSendToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      user,
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.U(1_000),
      e.Buffer(''), // No metadata
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...

  // Specify custom metadata
  await user.callContract({
    callee: its,
    funcName: "transmitSendToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      user,
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.U(1_000),
      e.Tuple(e.U32(0), e.Str('')),
    ],
  });
});

test("Transmit send token errors", async () => {
  await user.callContract({
    callee: its,
    funcName: "transmitSendToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      user,
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.U(1_000),
      e.Buffer(''), // No metadata
    ],
  }).assertFail({ code: 4, message: 'Token manager does not exist' });

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
    funcName: "transmitSendToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      user,
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.U(1_000),
      e.Buffer(''), // No metadata
    ],
  }).assertFail({ code: 4, message: 'Not token manager' });

  // Mock token manager being user to be able to test the transmitSendToken function
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(user),
    ],
  });

  // Specify custom metadata
  await user.callContract({
    callee: its,
    funcName: "transmitSendToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      user,
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
      e.U(1_000),
      e.Tuple(e.U32(1), e.Str('')),
    ],
  }).assertFail({ code: 4, message: 'Invalid metadata version' });
});
