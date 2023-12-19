import { afterEach, assert, beforeEach, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import {
  CHAIN_NAME_HASH,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID2,
  INTERCHAIN_TOKEN_ID,
  TOKEN_ID_MANAGER_ADDRESS, ADDRESS_ZERO, TOKEN_SALT, CHAIN_NAME, CANONICAL_INTERCHAIN_TOKEN_ID, OTHER_CHAIN_ADDRESS,
} from '../helpers';
import {
  baseItsKvs, computeCanonicalInterchainTokenSalt,
  computeInterchainTokenId, computeInterchainTokenSalt,
  deployContracts, deployInterchainTokenFactory, deployIts, deployTokenManager, deployTokenManagerMintBurn,
  gasService,
  gateway,
  interchainTokenFactory,
  its, itsDeployTokenManager, LATEST_METADATA_VERSION,
  tokenManager,
  tokenManager,
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
  });

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
        },
      ]),
    ],
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
        },
      ]),
    ],
  });
  otherUser = await world.createWallet({
    balance: BigInt('10000000000000000'),
  });
});

afterEach(async () => {
  await world.terminate();
});

const deployAndMockTokenManagerMintBurn = async (burnRole: boolean = false) => {
  await deployContracts(deployer, collector);

  let baseTokenManagerKvs;
  if (!burnRole) {
    baseTokenManagerKvs = await deployTokenManagerMintBurn(deployer, its);
  } else {
    baseTokenManagerKvs = await deployTokenManagerMintBurn(
      deployer,
      interchainTokenFactory,
      its,
      TOKEN_ID,
      true,
      interchainTokenFactory,
    );
  }

  const salt = computeInterchainTokenSalt(CHAIN_NAME, user);
  const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), salt);

  // Mock token manager already deployed as not being canonical so contract deployment is not tried again
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(tokenManager),
    ],
  });
  return { baseTokenManagerKvs, computedTokenId };
};

const deployAndMockTokenManagerLockUnlock = async (
  tokenId: string = TOKEN_ID,
  chainName: string = CHAIN_NAME,
  interchainTokenId: string = INTERCHAIN_TOKEN_ID,
) => {
  await deployContracts(deployer, collector);

  let baseTokenManagerKvs = await deployTokenManager(deployer, its, deployer, tokenId, interchainTokenId);

  let salt;
  if (interchainTokenId === INTERCHAIN_TOKEN_ID) {
    salt = computeInterchainTokenSalt(chainName, user);
  } else {
    salt = computeCanonicalInterchainTokenSalt(chainName, tokenId);
  }

  const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), salt);

  // Mock token manager already deployed as not being canonical so contract deployment is not tried again
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(tokenManager),
    ],
  });
  return { baseTokenManagerKvs, computedTokenId };
};

test('Init', async () => {
  await deployContracts(deployer, collector, false);
  await deployIts(deployer);

  await deployer.deployContract({
    code: 'file:interchain-token-factory/output/interchain-token-factory.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(ADDRESS_ZERO),
    ],
  }).assertFail({ code: 4, message: 'Zero address' });

  await deployInterchainTokenFactory(deployer, false);

  // On upgrade storage is not updated
  await deployer.upgradeContract({
    callee: interchainTokenFactory,
    code: 'file:interchain-token-factory/output/interchain-token-factory.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
    ],
  });

  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),
    ],
  });
});

test('Deploy interchain token only deploy token manager minter mint', async () => {
  await deployContracts(deployer, collector);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployInterchainToken',
    gasLimit: 100_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000),
      user, // minter
    ],
  }).assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployInterchainToken',
    gasLimit: 100_000_000,
    value: 0,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000),
      user,
    ],
  });

  const salt = computeInterchainTokenSalt(CHAIN_NAME, user);
  const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), salt);

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
    ],
  });

  // Interchain token factory gets roles over token manager
  const tokenManager = world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('account_roles', interchainTokenFactory).Value(e.U32(0b00000110)), // flow limit and operator roles
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),
    ],
  });
});

test('Deploy interchain token only deploy token manager minter no mint', async () => {
  await deployContracts(deployer, collector);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployInterchainToken',
    gasLimit: 100_000_000,
    value: 0,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(0),
      user,
    ],
  });

  const salt = computeInterchainTokenSalt(CHAIN_NAME, user);
  const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), salt);

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
    ],
  });

  // Minter gets roles over token manager
  const tokenManager = world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limit and operator roles
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit role
    ],
  });
});

test('Deploy interchain token only deploy token manager no minter no mint', async () => {
  await deployContracts(deployer, collector);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployInterchainToken',
    gasLimit: 100_000_000,
    value: 0,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(0),
      e.Addr(ADDRESS_ZERO),
    ],
  });

  const salt = computeInterchainTokenSalt(CHAIN_NAME, user);
  const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), salt);

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
    ],
  });

  // Address zero gets roles over token manager
  const tokenManager = world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000110)), // flow limit and operator roles
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit role
    ],
  });
});

test('Deploy interchain token only issue esdt minter mint', async () => {
  const { baseTokenManagerKvs, computedTokenId } = await deployAndMockTokenManagerMintBurn();

  // Insufficient funds for issuing ESDT
  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000,
    value: 0,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000),
      user,
    ],
  }).assertFail({ code: 10, message: 'execution failed' });

  // Insufficient funds for issuing ESDT
  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000),
      user,
    ],
  });

  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(tokenManager),
    ],
  });

  // Assert endpoint to deploy ESDT was called
  kvs = await tokenManager.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseTokenManagerKvs,

      e.kvs.Mapper('account_roles', interchainTokenFactory).Value(e.U32(0b00000001)), // minter role
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000111)), // flow limiter & operator & minter roles

      // This was tested on Devnet and it works fine
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_token_callback'),
        e.Bytes('00000000'),
      )),
    ],
  });
});

test('Deploy interchain token only issue esdt minter no mint', async () => {
  const { baseTokenManagerKvs, computedTokenId } = await deployAndMockTokenManagerMintBurn();

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(0),
      user, // minter
    ],
  });

  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(tokenManager),
    ],
  });

  // Assert endpoint to deploy ESDT was called
  kvs = await tokenManager.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseTokenManagerKvs,

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000001)), // minter role
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000111)), // flow limiter & operator & minter roles

      // This was tested on Devnet and it works fine
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_token_callback'),
        e.Bytes('00000000'),
      )),
    ],
  });
});

test('Deploy interchain token only mint minter', async () => {
  const { baseTokenManagerKvs } = await deployAndMockTokenManagerMintBurn(true);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000),
      user,
    ],
  }).assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000),
      user,
    ],
  });

  // Assert user got all roles
  let kvs = await tokenManager.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseTokenManagerKvs,

      e.kvs.Mapper('account_roles', interchainTokenFactory).Value(e.U32(0b00000000)), // roles removed
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000111)), // all roles
    ],
  });

  // Assert tokens were minted
  kvs = await user.getAccountWithKvs();
  assertAccount(kvs, {
    balance: BigInt('100000000000000000'),
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 101_000,
        },
        {
          id: TOKEN_ID2,
          amount: 10_000,
        },
      ]),
    ],
  });
});

test('Deploy interchain token only mint no minter', async () => {
  const { baseTokenManagerKvs } = await deployAndMockTokenManagerMintBurn(true);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.U(1_000),
      e.Addr(ADDRESS_ZERO),
    ],
  });

  // Assert user got all roles
  let kvs = await tokenManager.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseTokenManagerKvs,

      e.kvs.Mapper('account_roles', interchainTokenFactory).Value(e.U32(0b00000000)), // roles removed
      e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000111)), // operator & flow limiter & minter role
    ],
  });

  // Assert tokens were minted
  kvs = await user.getAccountWithKvs();
  assertAccount(kvs, {
    balance: BigInt('100000000000000000'),
    kvs: [
      e.kvs.Esdts([
        {
          id: TOKEN_ID,
          amount: 101_000,
        },
        {
          id: TOKEN_ID2,
          amount: 10_000,
        },
      ]),
    ],
  });
});

// TODO: Test this on devnet
test('Deploy remote interchain token no original chain name no minter', async () => {
  await deployAndMockTokenManagerMintBurn(true);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Bytes(TOKEN_SALT),
      e.Addr(ADDRESS_ZERO), // minter
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 100_000_000n,
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),

      // This seems to work fine on devnet
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_remote_token_callback'),
        e.U32(6),
        e.Buffer(computeInterchainTokenSalt(CHAIN_NAME, user)),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(TOKEN_ID.split('-')[0]),
        e.Buffer(''), // minter
        e.U(100_000_000n),
        e.Buffer(user.toTopBytes()),
      )),
    ],
  });
});

test('Deploy remote interchain token EGLD no original chain name no minter', async () => {
  await deployAndMockTokenManagerLockUnlock('EGLD');

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Bytes(TOKEN_SALT),
      e.Addr(ADDRESS_ZERO), // minter
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),
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

test('Deploy remote interchain token no original chain name with minter', async () => {
  await deployAndMockTokenManagerMintBurn(true);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Bytes(TOKEN_SALT),
      interchainTokenFactory, // minter
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 100_000_000n,
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),

      // This seems to work fine on devnet
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_remote_token_callback'),
        e.U32(6),
        e.Buffer(computeInterchainTokenSalt(CHAIN_NAME, user)),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(TOKEN_ID.split('-')[0]),
        e.Buffer(interchainTokenFactory.toTopBytes()), // minter
        e.U(100_000_000n),
        e.Buffer(user.toTopBytes()),
      )),
    ],
  });
});

test('Deploy remote interchain token EGLD with original chain name no minter', async () => {
  await deployAndMockTokenManagerLockUnlock('EGLD', 'SomeChain');

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Str('SomeChain'),
      e.Bytes(TOKEN_SALT),
      e.Addr(ADDRESS_ZERO), // minter
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),
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

test('Deploy remote interchain token errors', async () => {
  await deployContracts(deployer, collector);

  // No token manager
  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Bytes(TOKEN_SALT),
      e.Addr(ADDRESS_ZERO), // minter
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

  await deployAndMockTokenManagerLockUnlock();

  // deployRemoteInterchainToken function only exists on mint burn token manager
  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Bytes(TOKEN_SALT),
      user,
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 10, message: 'invalid function (not found)' });

  const { baseTokenManagerKvs } = await deployAndMockTokenManagerMintBurn(true);

  // Wrong minter
  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Bytes(TOKEN_SALT),
      user, // minter
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'Not minter' });

  await tokenManager.setAccount({
    ...await tokenManager.getAccountWithKvs(),
    kvs: [
      ...baseTokenManagerKvs,

      e.kvs.Mapper('token_identifier').Value(''),
    ],
  });

  // No token identifier
  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Bytes(TOKEN_SALT),
      e.Addr(ADDRESS_ZERO), // minter
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'panic occurred' });
});

test('Register canonical interchain token', async () => {
  await deployContracts(deployer, collector);

  const result = await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'registerCanonicalInterchainToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID),
    ],
  });

  const salt = computeCanonicalInterchainTokenSalt(CHAIN_NAME);
  const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO), salt);

  assert(result.returnData[0] === computedTokenId);

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
    ],
  });

  const tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000110)), // flow limit and operator roles
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit and operator roles
    ],
  });

  // Assert correct token manager type
  const query = await world.query({
    callee: tokenManager,
    funcName: 'implementationType',
    funcArgs: [],
  });

  assert(query.returnData[0] == '02'); // lock/unlock type
});

test('Register canonical interchain token errors', async () => {
  await deployContracts(deployer, collector);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'registerCanonicalInterchainToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str('NOTTOKEN'),
    ],
  }).assertFail({ code: 4, message: 'Invalid token identifier' });

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'registerCanonicalInterchainToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID),
    ],
  });

  // Can not register same canonical token twice
  await otherUser.callContract({
    callee: interchainTokenFactory,
    funcName: 'registerCanonicalInterchainToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID),
    ],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });
});

// TODO: Test this on devnet
test('Deploy remote canonical interchain token no original chain name', async () => {
  await deployAndMockTokenManagerLockUnlock(TOKEN_ID, CHAIN_NAME, CANONICAL_INTERCHAIN_TOKEN_ID);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteCanonicalInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Str(TOKEN_ID),
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 100_000_000n,
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),

      // This seems to work fine on devnet
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_remote_token_callback'),
        e.U32(6),
        e.Buffer(computeCanonicalInterchainTokenSalt(CHAIN_NAME)),
        e.Str(OTHER_CHAIN_NAME),
        e.Str(TOKEN_ID.split('-')[0]),
        e.Buffer(''), // minter
        e.U(100_000_000n),
        e.Buffer(user.toTopBytes()),
      )),
    ],
  });
});

test('Deploy remote canonical interchain token EGLD no original chain name', async () => {
  await deployAndMockTokenManagerLockUnlock('EGLD', CHAIN_NAME, CANONICAL_INTERCHAIN_TOKEN_ID);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteCanonicalInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Str('EGLD'),
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),
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

test('Deploy remote canonical interchain token EGLD with original chain name', async () => {
  await deployAndMockTokenManagerLockUnlock('EGLD', 'SomeChain', CANONICAL_INTERCHAIN_TOKEN_ID);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteCanonicalInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Str('SomeChain'),
      e.Str('EGLD'),
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),
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

test('Deploy remote canonical interchain token errors', async () => {
  await deployContracts(deployer, collector);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteCanonicalInterchainToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Buffer(''),
      e.Str('NOTTOKEN'),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'Invalid token identifier' });

  // No token manager
  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteCanonicalInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Str(TOKEN_ID),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' });

  const { baseTokenManagerKvs } = await deployAndMockTokenManagerLockUnlock(TOKEN_ID, CHAIN_NAME, CANONICAL_INTERCHAIN_TOKEN_ID);

  await tokenManager.setAccount({
    ...await tokenManager.getAccountWithKvs(),
    kvs: [
      ...baseTokenManagerKvs,

      e.kvs.Mapper('token_identifier').Value(''),
    ],
  });

  // No token identifier
  await user.callContract({
    callee: interchainTokenFactory,
    funcName: 'deployRemoteCanonicalInterchainToken',
    gasLimit: 150_000_000,
    value: 100_000_000n,
    funcArgs: [
      e.Buffer(''),
      e.Str(TOKEN_ID),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'panic occurred' });
});
