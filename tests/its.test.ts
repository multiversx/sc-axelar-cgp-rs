import { afterEach, assert, beforeEach, test } from "vitest";
import { assertAccount } from "xsuite";
import { SWorld, SContract, SWallet } from "xsuite";
import { e } from "xsuite";
import createKeccakHash from "keccak";
import {
  CHAIN_NAME, CHAIN_NAME_HASH,
  MOCK_CONTRACT_ADDRESS_1, OTHER_CHAIN_ADDRESS, OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2
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
let address: string;
let collector: SWallet;
let user: SWallet;

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
  user = await world.createWallet();
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

const deployRemoteAddressValidator = async() => {
  ({ contract: remoteAddressValidator, address } = await deployer.deployContract({
    code: "file:remote-address-validator/output/remote-address-validator.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Str(CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_ADDRESS)
    ]
  }));

  const otherChainAddressHash = createKeccakHash('keccak256').update(OTHER_CHAIN_ADDRESS.toLowerCase()).digest('hex');

  const kvs = await remoteAddressValidator.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('chain_name').Value(e.Str(CHAIN_NAME)),

      e.kvs.Mapper('remote_address_hashes', e.Str(OTHER_CHAIN_NAME)).Value(e.Bytes(otherChainAddressHash)),
      e.kvs.Mapper('remote_addresses', e.Str(OTHER_CHAIN_NAME)).Value(e.Str(OTHER_CHAIN_ADDRESS)),
    ],
  });
}

const deployTokenManagerMintBurn = async () => {
  const mockTokenId = createKeccakHash('keccak256').update('mockTokenId').digest('hex');

  ({ contract: tokenManagerMintBurn, address } = await deployer.deployContract({
    code: "file:token-manager-mint-burn/output/token-manager-mint-burn.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer, // its mock
      e.Bytes(mockTokenId),
      deployer, // operator mock
      e.Option(null),
    ]
  }));

  const kvs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(deployer),
      e.kvs.Mapper('token_id').Value(e.Bytes(mockTokenId)),
      e.kvs.Mapper('operator').Value(deployer),
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
      e.Option(e.Str(TOKEN_ID)),
    ]
  }));

  const kvs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(deployer),
      e.kvs.Mapper('token_id').Value(e.Bytes(mockTokenId)),
      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
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

  const prefixStandardized = createKeccakHash('keccak256').update('its-standardized-token-id').digest('hex');
  const buffer = Buffer.concat([
    Buffer.from(prefixStandardized, 'hex'),
    Buffer.from(CHAIN_NAME_HASH, 'hex'),
    Buffer.from(TOKEN_ID),
  ])
  const computedTokenId = createKeccakHash('keccak256').update(buffer).digest('hex');

  assert(result.returnData[0] === computedTokenId);

  const tokenManagerAddress = 'erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfrva02';

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

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(tokenManagerAddress)),
    ],
  });

  const tokenManager = await world.newContract(tokenManagerAddress);
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
