import { afterEach, assert, beforeEach, test } from "vitest";
import { assertAccount, e, SWallet, SWorld } from "xsuite";
import {
  CHAIN_NAME_HASH,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_ID2_CUSTOM,
  TOKEN_ID2_MANAGER_ADDRESS,
  TOKEN_ID_CANONICAL,
  TOKEN_ID_MANAGER_ADDRESS
} from '../helpers';
import {
  computeCustomTokenId,
  computeStandardizedTokenId,
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

// TODO: Check why an error Tx failed: 10 - failed transfer (insufficient funds) is raised here
// It might be because issuing ESDT tokens doesn't work for the underlying simulnet
// Everything seems fine until the call to `issue_and_set_all_roles` in the token-manager-mint-burn happens
test.skip("Deploy and register standardized token", async () => {
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

test("Deploy and register standardized token only issue esdt", async () => {
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
