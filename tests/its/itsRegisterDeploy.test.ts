import { afterEach, assert, beforeEach, test } from "vitest";
import { assertAccount, e, SWallet, SWorld } from "xsuite";
import {
  CHAIN_NAME_HASH,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_ID2_MANAGER_ADDRESS,
  TOKEN_ID2_MOCK,
  TOKEN_ID_CANONICAL,
  TOKEN_ID_MANAGER_ADDRESS
} from '../helpers';
import {
  computeCustomTokenId,
  computeStandardizedTokenId,
  deployContracts,
  gasService,
  gateway,
  its,
  interchainTokenFactory,
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

test("Register canonical token", async () => {
  const result = await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID)
    ],
  });

  const computedTokenId = computeStandardizedTokenId();

  assert(result.returnData[0] === computedTokenId);

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

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(TOKEN_ID_MANAGER_ADDRESS)),
    ],
  });

  const tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),
    ],
  });

  // Assert that token manager is not of type mint/burn, which has this function
  await user.callContract({
    callee: tokenManager,
    funcName: "deployStandardizedToken",
    gasLimit: 10_000_000,
    funcArgs: [],
  }).assertFail({ code: 1, message: 'invalid function (not found)' });
});

test("Register canonical token errors", async () => {
  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('NOTTOKEN')
    ],
  }).assertFail({ code: 4, message: 'Invalid token identifier' });

  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID)
    ],
  });

  // Can not register same canonical token twice
  await otherUser.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID)
    ],
  }).assertFail({ code: 4, message: 'Token manager already exists' });
});

test("Deploy remote canonical token", async () => {
  // Register canonical token first
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
    funcName: "deployRemoteCanonicalToken",
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 100_000_000n,
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(e.Addr(TOKEN_ID_MANAGER_ADDRESS)),

      // This seems to work fine on devnet
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_remote_token_callback'),
        e.Bytes('0000000500000020'),
        e.Bytes(TOKEN_ID_CANONICAL),
        e.Str(TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.U(100_000_000n),
        e.Buffer(user.toTopBytes()),
      )),
    ],
  });
});

test("Deploy remote canonical token EGLD", async () => {
  // Register canonical token first
  const result = await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('EGLD')
    ],
  });

  await user.callContract({
    callee: its,
    funcName: "deployRemoteCanonicalToken",
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Bytes(result.returnData[0]),
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(result.returnData[0])).Value(e.Addr(TOKEN_ID_MANAGER_ADDRESS)),
    ],
  });

  // Assert gas was paid for cross chain call
  const gasServiceKvs = await gasService.getAccountWithKvs();
  assertAccount(gasServiceKvs, {
    balance: 100_000_000n,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...
});

test("Deploy remote canonical token errors", async () => {
  await user.callContract({
    callee: its,
    funcName: "deployRemoteCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'Token manager does not exist' });

  // Mock token as not being canonical
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(tokenManagerLockUnlock),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: "deployRemoteCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'Not canonical token manager' });
});

test("Deploy custom token manager", async () => {
  let result = await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.U8(2), // Lock/unlock
      user,
    ],
  });

  const computedTokenId = computeCustomTokenId(user);

  assert(result.returnData[0] === computedTokenId);

  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(TOKEN_ID2_MANAGER_ADDRESS)),
    ],
  });

  const tokenManager = await world.newContract(TOKEN_ID2_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID2)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(user),
    ],
  });

  // Assert that token manager is not of type mint/burn, which has this function
  await user.callContract({
    callee: tokenManager,
    funcName: "deployStandardizedToken",
    gasLimit: 10_000_000,
    funcArgs: [],
  }).assertFail({ code: 1, message: 'invalid function (not found)' });

  // Other caller can also deploy another custom token manager for this token
  result = await otherUser.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.U8(1), // Mint/burn
      otherUser,
    ],
  });

  kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(TOKEN_ID2_MANAGER_ADDRESS)),
      e.kvs.Mapper('token_manager_address', e.Bytes(result.returnData[0])).Value(e.Addr('erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqpqqqqdz2m2t')),
    ],
  });
});

test("Deploy custom token manager errors", async () => {
  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('NOTATOKEN'),
      e.U8(1),
      user,
    ],
  }).assertFail({ code: 4, message: 'Invalid token identifier' });

  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.U8(1), // Mint/Burn
      user,
    ],
  });

  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.U8(2), // Lock/Unlock
      user,
    ],
  }).assertFail({ code: 4, message: 'Token manager already exists' });
});

test("Deploy remote custom token manager", async () => {
  let result = await user.callContract({
    callee: its,
    funcName: "deployRemoteCustomTokenManager",
    gasLimit: 20_000_000,
    value: 100_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.Str(OTHER_CHAIN_NAME),
      e.U8(1),
      e.Tuple(user, e.Str(OTHER_CHAIN_ADDRESS)),
    ],
  });

  assert(result.returnData[0] === computeCustomTokenId(user));

  // Nothing changes for its keys
  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),
    ],
  });

  // Assert gas was paid for cross chain call
  kvs = await gasService.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 100_000,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...

  // This can be called multiple times, even by other caller
  await otherUser.callContract({
    callee: its,
    funcName: "deployRemoteCustomTokenManager",
    gasLimit: 20_000_000,
    value: 100_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.Str(OTHER_CHAIN_NAME),
      e.U8(1),
      e.Tuple(user, e.Str(OTHER_CHAIN_ADDRESS)),
    ],
  });

  kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),
    ],
  });
});

test("Deploy remote custom token manager errors", async () => {
  await user.callContract({
    callee: its,
    funcName: "deployRemoteCustomTokenManager",
    gasLimit: 20_000_000,
    value: 100_000,
    funcArgs: [
      e.Str('NOTATOKEN'),
      e.Str(OTHER_CHAIN_NAME),
      e.U8(1),
      e.Tuple(user, e.Str(OTHER_CHAIN_ADDRESS)),
    ],
  }).assertFail({ code: 4, message: 'Invalid token identifier' });
});

test("Deploy and register remote standardized token", async () => {
  await user.callContract({
    callee: its,
    funcName: "deployAndRegisterRemoteStandardizedToken",
    gasLimit: 20_000_000,
    value: 100_000,
    funcArgs: [
      e.Str('SALT'),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      user,
      user,
      e.U(1_000_000),
      user,
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  // Nothing changes for its keys
  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),
    ],
  });

  // Assert gas was paid for cross chain call
  kvs = await gasService.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 100_000,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });

  // There are events emitted for the Gateway contract, but there is no way to test those currently...

  // This can be called multiple times, even by other caller
  await otherUser.callContract({
    callee: its,
    funcName: "deployAndRegisterRemoteStandardizedToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('SALT'),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      user,
      user,
      e.U(1_000_000),
      user,
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(interchainTokenFactory),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),
    ],
  });

  kvs = await gasService.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 100_000,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
});

test("Set flow limit", async () => {
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
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.U8(0), // Mint/burn
      its,
    ],
  });

  const computedTokenId = computeCustomTokenId(user);

  await deployer.callContract({
    callee: its,
    funcName: "setFlowLimit",
    gasLimit: 20_000_000,
    funcArgs: [
      e.U32(2),
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Bytes(computedTokenId),

      e.U32(2),
      e.U(99),
      e.U(100)
    ],
  });

  let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  let tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Mapper('flow_limit').Value(e.U(99)),
    ],
  });

  tokenManager = await world.newContract('erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqpqqqqdz2m2t');
  tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID2)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Mapper('flow_limit').Value(e.U(100)),
    ],
  });
});

test("Set flow limit errors", async () => {
  await user.callContract({
    callee: its,
    funcName: "setFlowLimit",
    gasLimit: 20_000_000,
    funcArgs: [
      e.U32(1),
      e.Bytes(TOKEN_ID_CANONICAL),

      e.U32(1),
      e.U(99),
    ],
  }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' });

  await deployer.callContract({
    callee: its,
    funcName: "setFlowLimit",
    gasLimit: 20_000_000,
    funcArgs: [
      e.U32(1),
      e.Bytes(TOKEN_ID_CANONICAL),

      e.U32(2),
      e.U(99),
      e.U(100)
    ],
  }).assertFail({ code: 4, message: 'Length mismatch' });

  await user.callContract({
    callee: its,
    funcName: "registerCanonicalToken",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID)
    ],
  });

  await deployer.callContract({
    callee: its,
    funcName: "setFlowLimit",
    gasLimit: 20_000_000,
    funcArgs: [
      e.U32(2),
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Bytes(TOKEN_ID2_MOCK),

      e.U32(2),
      e.U(99),
      e.U(100)
    ],
  }).assertFail({ code: 4, message: 'Token manager does not exist' });

  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.U8(0), // Mint/burn
      user,
    ],
  });

  const computedTokenId = computeCustomTokenId(user);

  // ITS not operator of token manager
  await deployer.callContract({
    callee: its,
    funcName: "setFlowLimit",
    gasLimit: 20_000_000,
    funcArgs: [
      e.U32(2),
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Bytes(computedTokenId),

      e.U32(2),
      e.U(99),
      e.U(100)
    ],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });
});
