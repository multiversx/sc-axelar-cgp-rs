import { afterEach, assert, beforeEach, test } from "vitest";
import { assertAccount } from "xsuite";
import { SWorld, SContract, SWallet } from "xsuite";
import { e } from "xsuite";
import createKeccakHash from "keccak";
import {
  CHAIN_NAME,
  MOCK_CONTRACT_ADDRESS_1, OTHER_CHAIN_ADDRESS, OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
} from './helpers';

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

  const pairs = await gateway.getAccountWithKvs();
  assertAccount(pairs, {
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

  const pairs = await gasService.getAccountWithKvs();
  assertAccount(pairs, {
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

  const pairs = await remoteAddressValidator.getAccountWithKvs();
  assertAccount(pairs, {
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

  const pairs = await tokenManagerMintBurn.getAccountWithKvs();
  assertAccount(pairs, {
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

  const pairs = await tokenManagerLockUnlock.getAccountWithKvs();
  assertAccount(pairs, {
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

  const chainNameHash = createKeccakHash('keccak256').update(CHAIN_NAME).digest('hex');

  const pairs = await its.getAccountWithKvs();
  assertAccount(pairs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gateway').Value(gateway),
      e.kvs.Mapper('gas_service').Value(gasService),
      e.kvs.Mapper('remote_address_validator').Value(remoteAddressValidator),
      e.kvs.Mapper('implementation_mint_burn').Value(tokenManagerMintBurn),
      e.kvs.Mapper('implementation_lock_unlock').Value(tokenManagerLockUnlock),

      e.kvs.Mapper('chain_name_hash').Value(e.Bytes(chainNameHash)),
    ],
  });
}

test("Deploy contracts", async () => {
  await deployGatewayContract();
  await deployGasService();
  await deployRemoteAddressValidator();
  await deployTokenManagerMintBurn();
  await deployTokenManagerLockUnlock();
  await deployIts();
});
