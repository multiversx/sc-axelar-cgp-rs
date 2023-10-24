import { afterEach, assert, beforeEach, test } from "vitest";
import { assertAccount } from "xsuite";
import { SWorld, SContract, SWallet } from "xsuite";
import { e } from "xsuite";
import createKeccakHash from "keccak";
import {
  CHAIN_NAME,
  CHAIN_NAME_HASH,
  getCommandIdHash,
  MOCK_CONTRACT_ADDRESS_1,
  OTHER_CHAIN_NAME,
  OTHER_CHAIN_ADDRESS,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_ID2_CUSTOM,
  TOKEN_ID2_MANAGER_ADDRESS,
  TOKEN_ID_CANONICAL,
  TOKEN_ID_MANAGER_ADDRESS,
  computeStandardizedTokenId
} from './helpers';
import { Buffer } from 'buffer';

let world: SWorld;
let deployer: SWallet;
let gateway: SContract;
let gasService: SContract;
let remoteAddressValidator: SContract;
let tokenManagerMintBurn: SContract;
let tokenManagerLockUnlock: SContract;
let its: SContract;
let pingPong: SContract;
let address: string;
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
});

afterEach(async () => {
  await world.terminate();
});

const deployGatewayContract = async () => {
  ({ contract: gateway, address } = await deployer.deployContract({
    code: "file:gateway/output/gateway.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(MOCK_CONTRACT_ADDRESS_1),
    ]
  }));

  const kvs = await gateway.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper("auth_module").Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
    ],
  });
}

const deployGasService = async () => {
  ({ contract: gasService, address } = await deployer.deployContract({
    code: "file:gas-service/output/gas-service.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(collector.toString()),
    ]
  }));

  const kvs = await gasService.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
}

const deployRemoteAddressValidator = async () => {
  ({ contract: remoteAddressValidator, address } = await deployer.deployContract({
    code: "file:remote-address-validator/output/remote-address-validator.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Str(CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_NAME)
    ]
  }));

  const otherChainAddressHash = createKeccakHash('keccak256').update(OTHER_CHAIN_NAME.toLowerCase()).digest('hex');

  const kvs = await remoteAddressValidator.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('chain_name').Value(e.Str(CHAIN_NAME)),

      e.kvs.Mapper('remote_address_hashes', e.Str(OTHER_CHAIN_NAME)).Value(e.Bytes(otherChainAddressHash)),
      e.kvs.Mapper('remote_addresses', e.Str(OTHER_CHAIN_NAME)).Value(e.Str(OTHER_CHAIN_NAME)),
    ],
  });
}

const deployTokenManagerMintBurn = async (operator: SWallet | SContract = deployer) => {
  const mockTokenId = createKeccakHash('keccak256').update('mockTokenId').digest('hex');

  ({ contract: tokenManagerMintBurn, address } = await deployer.deployContract({
    code: "file:token-manager-mint-burn/output/token-manager-mint-burn.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      operator, // its mock
      e.Bytes(mockTokenId),
      operator, // operator mock
      e.Option(null),
    ]
  }));

  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(operator),
      e.kvs.Mapper('token_id').Value(e.Bytes(mockTokenId)),
      e.kvs.Mapper('operator').Value(operator),
    ],
  });
}

const deployTokenManagerLockUnlock = async () => {
  const mockTokenId = createKeccakHash('keccak256').update('mockTokenId').digest('hex');

  ({ contract: tokenManagerLockUnlock, address } = await deployer.deployContract({
    code: "file:token-manager-lock-unlock/output/token-manager-lock-unlock.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer, // its mock
      e.Bytes(mockTokenId),
      deployer, // operator mock
      e.Option(e.Str('MOCK-098765')),
    ]
  }));

  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(deployer),
      e.kvs.Mapper('token_id').Value(e.Bytes(mockTokenId)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str('MOCK-098765')),
    ],
  });
}

const deployIts = async () => {
  ({ contract: its, address } = await deployer.deployContract({
    code: "file:interchain-token-service/output/interchain-token-service.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      gasService,
      remoteAddressValidator,
      tokenManagerMintBurn,
      tokenManagerLockUnlock,
    ]
  }));

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
    ],
  });
}

const deployContracts = async () => {
  await deployGatewayContract();
  await deployGasService();
  await deployRemoteAddressValidator();
  await deployTokenManagerMintBurn();
  await deployTokenManagerLockUnlock();
  await deployIts();
};

const deployPingPongInterchain = async (amount = 1_000) => {
  ({ contract: pingPong } = await deployer.deployContract({
    code: "file:ping-pong-interchain/output/ping-ping-interchain.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      its,
      e.U(amount),
      e.U64(10),
      e.Option(null),
    ]
  }));
}

test("Register canonical token", async () => {
  await deployContracts();

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
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
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
  await deployContracts();

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
  await deployContracts();

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
    gasLimit: 50_000_000,
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
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(TOKEN_ID_CANONICAL)).Value(e.Addr(TOKEN_ID_MANAGER_ADDRESS)),

      // TODO: Check how to actually test the async call to the ESDT system contract here
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_remote_token_callback'),
        e.Bytes('0000000400000020'),
        e.Bytes(TOKEN_ID_CANONICAL),
        e.Str(TOKEN_ID),
        e.Str(OTHER_CHAIN_NAME),
        e.U(100_000_000n),
      )),
    ],
  });
});

test("Deploy remote canonical token errors", async () => {
  await deployContracts();

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
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
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
  await deployContracts();

  let result = await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.U8(2),
      user,
    ],
  });

  const prefixCustom = createKeccakHash('keccak256').update('its-custom-token-id').digest('hex');
  const buffer = Buffer.concat([
    Buffer.from(prefixCustom, 'hex'),
    Buffer.from(user.toTopHex(), 'hex'),
    Buffer.from(TOKEN_ID2),
  ]);
  const computedTokenId = createKeccakHash('keccak256').update(buffer).digest('hex');

  assert(result.returnData[0] === computedTokenId);

  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
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
      e.U8(1),
      otherUser,
    ],
  });

  kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(TOKEN_ID2_MANAGER_ADDRESS)),
      e.kvs.Mapper('token_manager_address', e.Bytes(result.returnData[0])).Value(e.Addr('erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqpqqqqdz2m2t')),
    ],
  });
});

test("Deploy custom token manager errors", async () => {
  await deployContracts();

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
      e.U8(1),
      user,
    ],
  });

  await user.callContract({
    callee: its,
    funcName: "deployCustomTokenManager",
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.U8(2),
      user,
    ],
  }).assertFail({ code: 4, message: 'Token manager already exists' });
});

test("Deploy remote custom token manager", async () => {
  await deployContracts();

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

  assert(result.returnData[0] === TOKEN_ID2_CUSTOM);

  // Nothing changes for its keys
  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
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
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),
    ],
  });
});

test("Deploy remote custom token manager errors", async () => {
  await deployContracts();

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

test.skip("Deploy and register standardized token", async () => {
  await deployContracts();

  // TODO: Check why an error Tx failed: 10 - failed transfer (insufficient funds) is raised here
  // It might be because issuing ESDT tokens doesn't work for the underlying simulnet
  // Everything seems fine until the call to `issue_and_set_all_roles` in the token-manager-mint-burn happens
  await user.callContract({
    callee: its,
    funcName: "deployAndRegisterStandardizedToken",
    gasLimit: 500_000_000,
    value: BigInt('5000000000000000'),
    funcArgs: [
      e.Str('SALT'),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000_000),
      user,
    ],
  });
});

// TODO: This passes if ran with `.only` for some reason
test.skip("Deploy and register standardized token only issue esdt", async () => {
  await deployContracts();
  await deployTokenManagerMintBurn(its);

  const customTokenId = 'd6e2313ee1ab6b70e952156eb974c0ffc2dd3b2ac214d289e57429f0d1c6080b';

  // Mock token manager already deployed as not being canonical
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

  await user.callContract({
    callee: its,
    funcName: "deployAndRegisterStandardizedToken",
    gasLimit: 600_000_000,
    value: BigInt('5000000000000000'),
    funcArgs: [
      e.Str('SALT'),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000_000),
      user,
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
});

test("Deploy and register remote standardized token", async () => {
  await deployContracts();

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
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
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

  kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(CHAIN_NAME_HASH)),
    ],
  });
});

test("Express receive token", async () => {
  await deployContracts();

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
  await deployContracts();
  await deployPingPongInterchain();

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

test("Express receive token with data error", async () => {
  await deployContracts();
  await deployPingPongInterchain();

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
        e.Str("sth").toTopBytes() // data passed to contract, in this case the string "sth" which will give an error
      )
    ).toTopBytes()
  );

  await user.callContract({
    callee: its,
    funcName: "expressReceiveToken",
    gasLimit: 80_000_000,
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
  await deployContracts();

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
  await deployContracts();

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
    value: 1_000,
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
  await deployContracts();

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
  await deployContracts();

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
  await deployContracts();

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
  await deployContracts();

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
  await deployContracts();

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
