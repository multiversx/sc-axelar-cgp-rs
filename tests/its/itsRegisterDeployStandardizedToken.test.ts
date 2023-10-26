import { afterEach, beforeEach, test } from "vitest";
import { assertAccount, e, SWallet, SWorld } from "xsuite";
import { CHAIN_NAME_HASH, TOKEN_ID, TOKEN_ID2, TOKEN_ID_MANAGER_ADDRESS } from '../helpers';
import {
  computeCustomTokenId,
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

test("Deploy and register standardized token only deploy token manager", async () => {
  await user.callContract({
    callee: its,
    funcName: "deployAndRegisterStandardizedToken",
    gasLimit: 100_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Str('SALT'),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000_000),
      user,
    ],
  }).assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

  await user.callContract({
    callee: its,
    funcName: "deployAndRegisterStandardizedToken",
    gasLimit: 100_000_000,
    value: 0,
    funcArgs: [
      e.Str('SALT'),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000_000),
      user,
    ],
  });

  const customTokenId = computeCustomTokenId(user, 'SALT');

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

      e.kvs.Mapper('token_manager_address', e.Bytes(customTokenId)).Value(e.Addr(TOKEN_ID_MANAGER_ADDRESS)),
    ],
  });
});

test("Deploy and register standardized token only issue esdt", async () => {
  await deployTokenManagerMintBurn(deployer, its);

  const customTokenId = computeCustomTokenId(user, 'SALT');

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
    gasLimit: 300_000_000,
    value: BigInt('50000000000000000'),
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
