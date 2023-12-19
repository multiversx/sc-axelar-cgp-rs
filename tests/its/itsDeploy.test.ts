import { afterEach, assert, beforeEach, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import {
  ADDRESS_ZERO,
  INTERCHAIN_TOKEN_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  OTHER_CHAIN_TOKEN_ADDRESS,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_ID2_MANAGER_ADDRESS,
  TOKEN_ID_MANAGER_ADDRESS,
  TOKEN_SALT,
} from '../helpers';
import {
  baseItsKvs,
  computeInterchainTokenId,
  deployContracts,
  deployTokenManagerMintBurn,
  gasService,
  interchainTokenFactory,
  its,
  tokenManager,
} from '../itsHelpers';
import { AbiCoder } from 'ethers';

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

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  await world.terminate();
});

test('Deploy token manager', async () => {
  let result = await user.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''), // destination chain empty
      e.U8(2), // Lock/unlock
      e.Buffer(e.Tuple(
        e.Option(user),
        e.Option(e.Str(TOKEN_ID2)),
      ).toTopBytes()),
    ],
  });

  const computedTokenId = computeInterchainTokenId(user);

  assert(result.returnData[0] === computedTokenId);

  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(TOKEN_ID2_MANAGER_ADDRESS)),
    ],
  });

  const tokenManager = await world.newContract(TOKEN_ID2_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limiter & operator roles
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID2)),
    ],
  });

  // Assert correct token manager type
  const query = await world.query({
    callee: tokenManager,
    funcName: 'implementationType',
    funcArgs: [],
  });

  assert(query.returnData[0] == '02'); // lock/unlock type

  // Other caller can also deploy another token manager for this token with different salt
  result = await otherUser.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''), // destination chain empty
      e.U8(0), // Mint/burn
      e.Buffer(e.Tuple(
        e.Option(otherUser),
        e.Option(e.Str(TOKEN_ID2)),
      ).toTopBytes()),
    ],
  });

  kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(TOKEN_ID2_MANAGER_ADDRESS)),
      e.kvs.Mapper('token_manager_address', e.Bytes(result.returnData[0])).Value(e.Addr(
        'erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqpqqqqdz2m2t')),
    ],
  });
});

test('Deploy token manager errors', async () => {
  await user.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''), // destination chain empty
      e.U8(2), // Lock/unlock
      e.Buffer(e.Tuple(
        e.Option(user),
        e.Option(e.Str(TOKEN_ID2)),
      ).toTopBytes()),
    ],
  });

  // Can not deploy same token with same salt
  await user.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''), // destination chain empty
      e.U8(2), // Lock/unlock
      e.Buffer(e.Tuple(
        e.Option(user),
        e.Option(e.Str(TOKEN_ID2)),
      ).toTopBytes()),
    ],
  }).assertFail({ code: 4, message: 'Token manager already exists' });
});

test('Deploy token manager remote', async () => {
  // Mock token manager exists on source chain
  await its.setAccount({
    ...await its.getAccountWithKvs(),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computeInterchainTokenId(user))).Value(e.Addr(
        TOKEN_ID_MANAGER_ADDRESS)),
      e.kvs.Mapper('token_manager_address', e.Bytes(computeInterchainTokenId(otherUser))).Value(e.Addr(
        TOKEN_ID2_MANAGER_ADDRESS)),
    ],
  });

  let result = await user.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    value: 100_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(OTHER_CHAIN_NAME),
      e.U8(2),
      e.Buffer(
        AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'address'],
          [
            OTHER_CHAIN_ADDRESS,
            OTHER_CHAIN_TOKEN_ADDRESS,
          ],
        ).substring(2),
      ),
    ],
  });

  assert(result.returnData[0] === computeInterchainTokenId(user));

  // Nothing changes for its keys
  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computeInterchainTokenId(user))).Value(e.Addr(
        TOKEN_ID_MANAGER_ADDRESS)),
      e.kvs.Mapper('token_manager_address', e.Bytes(computeInterchainTokenId(otherUser))).Value(e.Addr(
        TOKEN_ID2_MANAGER_ADDRESS)),
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

  // This can be called multiple times, even by other caller (after he also deploys the token manager for source chain first)
  await otherUser.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(OTHER_CHAIN_NAME),
      e.U8(2),
      e.Buffer(
        AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'address'],
          [
            OTHER_CHAIN_ADDRESS,
            OTHER_CHAIN_TOKEN_ADDRESS,
          ],
        ).substring(2),
      ),
    ],
  });

  kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computeInterchainTokenId(user))).Value(e.Addr(
        TOKEN_ID_MANAGER_ADDRESS)),
      e.kvs.Mapper('token_manager_address', e.Bytes(computeInterchainTokenId(otherUser))).Value(e.Addr(
        TOKEN_ID2_MANAGER_ADDRESS)),
    ],
  });
});

test('Deploy token manager remote errors', async () => {
  await user.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(OTHER_CHAIN_NAME),
      e.U8(2),
      e.Buffer(
        AbiCoder.defaultAbiCoder().encode(
          ['bytes', 'address'],
          [
            OTHER_CHAIN_ADDRESS,
            OTHER_CHAIN_TOKEN_ADDRESS,
          ],
        ).substring(2),
      ),
    ],
  }).assertFail({ code: 4, message: 'Token manager does not exist' });

  // Mock token manager exists on source chain
  await its.setAccount({
    ...await its.getAccountWithKvs(),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computeInterchainTokenId(user))).Value(e.Addr(
        TOKEN_ID_MANAGER_ADDRESS)),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('SomeChain'),
      e.U8(2), // Lock/unlock
      e.Buffer(e.Tuple(
        e.Option(user),
        e.Option(e.Str(TOKEN_ID2)),
      ).toTopBytes()),
    ],
  }).assertFail({ code: 4, message: 'Untrusted chain' });
});

test('Deploy token manager interchain token factory', async () => {
  // Mock user as the interchain token factory
  await its.setAccount({
    ...await its.getAccountWithKvs(),
    kvs: [
      ...baseItsKvs(deployer, user),
    ],
  });

  let result = await user.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''), // destination chain empty
      e.U8(2), // Lock/unlock
      e.Buffer(e.Tuple(
        e.Option(user),
        e.Option(e.Str(TOKEN_ID2)),
      ).toTopBytes()),
    ],
  });

  // Token id is instead computed for the zero adress
  const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO));

  assert(result.returnData[0] === computedTokenId);

  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, user),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(TOKEN_ID2_MANAGER_ADDRESS)),
    ],
  });
});

test('Deploy interchain token only deploy token manager minter', async () => {
  await user.callContract({
    callee: its,
    funcName: 'deployInterchainToken',
    gasLimit: 20_000_000,
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Bytes(user.toTopBytes()), // minter
    ],
  }).assertFail({ code: 4, message: 'Can not send EGLD payment if not issuing ESDT' });

  await user.callContract({
    callee: its,
    funcName: 'deployInterchainToken',
    gasLimit: 100_000_000,
    value: 0,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Bytes(user.toTopBytes()), // minter
    ],
  });

  const computedTokenId = computeInterchainTokenId(user);

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
    ],
  });

  const tokenManager = world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limit & operator roles
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)),
    ],
  });
});

test('Deploy interchain token only deploy token manager no minter', async () => {
  await user.callContract({
    callee: its,
    funcName: 'deployInterchainToken',
    gasLimit: 100_000_000,
    value: 0,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Str('sth'), // invalid minter
    ],
  });

  const computedTokenId = computeInterchainTokenId(user);

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory, computedTokenId),
    ],
  });

  const tokenManager = world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  const tokenManagerKvs = await tokenManager.getAccountWithKvs();
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('interchain_token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000110)), // flow limit & operator roles added to zero address
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit & operator roles
    ],
  });
});

test('Deploy interchain token only issue esdt minter', async () => {
  const baseTokenManagerKvs = await deployTokenManagerMintBurn(deployer, its);

  const computedTokenId = computeInterchainTokenId(user);

  // Mock token manager already deployed as not being canonical so contract deployment is not tried again
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(tokenManager),
    ],
  });

  // Insufficient funds for issuing ESDT
  await user.callContract({
    callee: its,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000, // needs to be above 100_000_000
    value: 0,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Bytes(user.toTopBytes()), // minter
    ],
  }).assertFail({ code: 10, message: 'failed transfer (insufficient funds)' });

  await user.callContract({
    callee: its,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000, // needs to be above 100_000_000
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Bytes(user.toTopBytes()), // minter
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

      e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000001)), // minter role was added to user & its
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000111)),

      // This was tested on Devnet and it works fine
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_token_callback'),
        e.Bytes('00000000'),
      )),
    ],
  });
});

test('Deploy interchain token only issue esdt no minter', async () => {
  const baseTokenManagerKvs = await deployTokenManagerMintBurn(deployer, its);

  const computedTokenId = computeInterchainTokenId(user);

  // Mock token manager already deployed as not being canonical so contract deployment is not tried again
  await its.setAccount({
    ...(await its.getAccountWithKvs()),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(tokenManager),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: 'deployInterchainToken',
    gasLimit: 200_000_000, // needs to be above 100_000_000
    value: BigInt('50000000000000000'),
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Str('sth'), // invalid minter
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

      // minter role was set for zero address and its
      e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000001)),
      e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000111)),

      // This was tested on Devnet and it works fine
      e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
        e.Str('deploy_token_callback'),
        e.Bytes('00000000'),
      )),
    ],
  });
});

test('Deploy interchain token remote', async () => {
  const computedTokenId = computeInterchainTokenId(user);
  const computedTokenId2 = computeInterchainTokenId(otherUser);

  // Mock token manager exists on source chain
  await its.setAccount({
    ...await its.getAccountWithKvs(),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(
        TOKEN_ID_MANAGER_ADDRESS)),
      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId2)).Value(e.Addr(
        TOKEN_ID2_MANAGER_ADDRESS)),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: 'deployInterchainToken',
    gasLimit: 20_000_000,
    value: 100_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(OTHER_CHAIN_NAME),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Str(OTHER_CHAIN_ADDRESS), // minter
    ],
  });

  // Nothing changes for its keys
  let kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(
        TOKEN_ID_MANAGER_ADDRESS)),
      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId2)).Value(e.Addr(
        TOKEN_ID2_MANAGER_ADDRESS)),
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
    funcName: 'deployInterchainToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(OTHER_CHAIN_NAME),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Str(OTHER_CHAIN_ADDRESS), // minter
    ],
  });

  kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId)).Value(e.Addr(
        TOKEN_ID_MANAGER_ADDRESS)),
      e.kvs.Mapper('token_manager_address', e.Bytes(computedTokenId2)).Value(e.Addr(
        TOKEN_ID2_MANAGER_ADDRESS)),
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

test('Deploy interchain token remote errors', async () => {
  await user.callContract({
    callee: its,
    funcName: 'deployInterchainToken',
    gasLimit: 20_000_000,
    value: 100_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(OTHER_CHAIN_NAME),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Str(OTHER_CHAIN_ADDRESS), // minter
    ],
  }).assertFail({ code: 4, message: 'Token manager does not exist' });

  // Mock token manager exists on source chain
  await its.setAccount({
    ...await its.getAccountWithKvs(),
    kvs: [
      ...baseItsKvs(deployer, interchainTokenFactory),

      e.kvs.Mapper('token_manager_address', e.Bytes(computeInterchainTokenId(user))).Value(e.Addr(
        TOKEN_ID_MANAGER_ADDRESS)),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: 'deployInterchainToken',
    gasLimit: 20_000_000,
    value: 100_000,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str('SomeChain'),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Str(OTHER_CHAIN_ADDRESS), // minter
    ],
  }).assertFail({ code: 4, message: 'Untrusted chain' });
});

test('Deploy interchain token interchain token factory', async () => {
  // Mock user as the interchain token factory
  await its.setAccount({
    ...await its.getAccountWithKvs(),
    kvs: [
      ...baseItsKvs(deployer, user),
    ],
  });

  await user.callContract({
    callee: its,
    funcName: 'deployInterchainToken',
    gasLimit: 100_000_000,
    value: 0,
    funcArgs: [
      e.Bytes(TOKEN_SALT),
      e.Str(''),
      e.Str('Token Name'),
      e.Str('TOKEN-SYMBOL'),
      e.U8(18),
      e.Bytes(user.toTopBytes()), // minter
    ],
  });

  // Token id is instead computed for the zero adress
  const computedTokenId = computeInterchainTokenId(e.Addr(ADDRESS_ZERO));

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer, user, computedTokenId),
    ],
  });
});
