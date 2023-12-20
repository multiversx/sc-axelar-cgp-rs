import { afterEach, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, SWallet, SWorld } from 'xsuite';
import createKeccakHash from 'keccak';
import { ADDRESS_ZERO, INTERCHAIN_TOKEN_ID, TOKEN_ID, TOKEN_ID2 } from '../helpers';
import {
  deployTokenManagerLockUnlock,
  deployTokenManagerMintBurn,
  TOKEN_MANAGER_TYPE_LOCK_UNLOCK,
  TOKEN_MANAGER_TYPE_MINT_BURN,
  tokenManager,
} from '../itsHelpers';

let world: SWorld;
let deployer: SWallet;
let user: SWallet;
let otherUser: SWallet;

beforeEach(async () => {
  world = await SWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  });

  deployer = await world.createWallet({
    balance: 10_000_000_000n,
  });
  user = await world.createWallet({
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
  otherUser = await world.createWallet();
});

afterEach(async () => {
  await world.terminate();
});

describe('Give token mint burn', () => {
  test("Normal", async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

    await user.callContract({
      callee: tokenManager,
      funcName: "giveToken",
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(1_000),
      ],
    });

    // Tokens were minted and sent from contract to otherUser
    const kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: baseKvs,
    });

    const otherUserKvs = await otherUser.getAccountWithKvs();
    assertAccount(otherUserKvs, {
      allKvs: [
        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
      ],
    });
  });

  test("With flow limit", async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

    // Set flow limit
    await deployer.callContract({
      callee: tokenManager,
      funcName: "setFlowLimit",
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(500),
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: "giveToken",
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(500),
      ],
    });

    // Tokens were minted and sent from contract to otherUser
    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('flow_limit').Value(e.U(500)),
        e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(500)),
      ],
    });

    let otherUserKvs = await otherUser.getAccountWithKvs();
    assertAccount(otherUserKvs, {
      allKvs: [
        e.kvs.Esdts([{ id: TOKEN_ID, amount: 500 }]),
      ],
    });

    await world.setCurrentBlockInfo({
      timestamp: 6 * 3600 - 1,
    });

    await user.callContract({
      callee: tokenManager,
      funcName: "giveToken",
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(500),
      ],
    }).assertFail({ code: 4, message: 'Flow limit exceeded' });

    await world.setCurrentBlockInfo({
      timestamp: 6 * 3600,
    });

    await user.callContract({
      callee: tokenManager,
      funcName: "giveToken",
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(500),
      ],
    });

    kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('flow_limit').Value(e.U(500)),
        e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(500)),
        e.kvs.Mapper('flow_in_amount', e.U64(1)).Value(e.U(500)),
      ],
    });

    otherUserKvs = await otherUser.getAccountWithKvs();
    assertAccount(otherUserKvs, {
      allKvs: [
        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000 }]),
      ],
    });
  });

  test("Errors", async () => {
    await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID, false);

    await otherUser.callContract({
      callee: tokenManager,
      funcName: "giveToken",
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(1_000),
      ],
    }).assertFail({ code: 4, message: 'Not service' });

    // Test flow limit exceeded
    await deployer.callContract({
      callee: tokenManager,
      funcName: "setFlowLimit",
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(999),
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: "giveToken",
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(1_000),
      ],
    }).assertFail({ code: 4, message: 'Flow limit exceeded' });

    // Contract can not mint tokens
    await user.callContract({
      callee: tokenManager,
      funcName: "giveToken",
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(999),
      ],
    }).assertFail({ code: 10, message: 'action is not allowed' });
  });
});

describe('Take token mint burn', () => {
  test('Take token', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    });

    // Tokens were burned by contract
    const kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: baseKvs,
    });

    const userKvs = await user.getAccountWithKvs();
    assertAccount(userKvs, {
      balance: 10_000_000_000n,
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_ID,
            amount: 99_000,
          },
          {
            id: TOKEN_ID2,
            amount: 10_000,
          },
        ]),
      ],
    });
  });

  test('Take token flow limit', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID);

    // Set flow limit
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(500),
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 500 }],
    });

    // Tokens were burned by contract
    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('flow_limit').Value(e.U(500)),
        e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),
      ],
    });

    await world.setCurrentBlockInfo({
      timestamp: 6 * 3600 - 1,
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 500 }],
    }).assertFail({ code: 4, message: 'Flow limit exceeded' });

    await world.setCurrentBlockInfo({
      timestamp: 6 * 3600,
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 500 }],
    });

    kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('flow_limit').Value(e.U(500)),
        e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),
        e.kvs.Mapper('flow_out_amount', e.U64(1)).Value(e.U(500)),
      ],
    });

    const userKvs = await user.getAccountWithKvs();
    assertAccount(userKvs, {
      balance: 10_000_000_000n,
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_ID,
            amount: 99_000,
          },
          {
            id: TOKEN_ID2,
            amount: 10_000,
          },
        ]),
      ],
    });
  });

  test('Take token errors', async () => {
    await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_ID, false);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      value: 1_000,
    }).assertFail({ code: 4, message: 'Not service' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      value: 1_000,
    }).assertFail({ code: 4, message: 'Wrong token sent' });

    // Test flow limit exceeded
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [
        e.U(999),
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    }).assertFail({ code: 4, message: 'Flow limit exceeded' });

    // Contract can not burn tokens
    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 999 }],
    }).assertFail({ code: 10, message: 'action is not allowed' });
  });
});

describe('Deploy interchain token', () => {
  test('Deploy', async () => {
    user = await world.createWallet({
      balance: BigInt('500000000000000000'),
    });

    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user);

    await user.callContract({
      callee: tokenManager,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      value: BigInt('50000000000000000'),
      funcArgs: [
        e.Option(user),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
      ],
    });

    const kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000111)), // minter role was added to user

        // ESDT token deployment was tested on Devnet and it works fine
        e.kvs.Mapper('CB_CLOSURE................................').Value(e.Tuple(
          e.Str('deploy_token_callback'),
          e.TopBuffer('00000000'),
        )),
      ],
    });
  });

  test('Errors', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user);

    // Not sent enough EGLD funds for ESDT issue
    await user.callContract({
      callee: tokenManager,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      value: BigInt('1'),
      funcArgs: [
        e.Option(user),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
      ],
    }).assertFail({ code: 7, message: 'failed transfer (insufficient funds)' });

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      funcArgs: [
        e.Option(user),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
      ],
    }).assertFail({ code: 4, message: 'Not service or minter' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      funcArgs: [
        e.Option(user),
        e.Str(''),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
      ],
    }).assertFail({ code: 4, message: 'Token name empty' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      funcArgs: [
        e.Option(user),
        e.Str('Token Name'),
        e.Str(''),
        e.U8(18),
      ],
    }).assertFail({ code: 4, message: 'Token symbol empty' });

    // Manually set token identifier
    await tokenManager.setAccount({
      ...(await tokenManager.getAccountWithKvs()),
      kvs: [
        ...baseKvs,

        e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      funcArgs: [
        e.Option(user),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
      ],
    }).assertFail({ code: 4, message: 'Token address already exists' });
  });

  test('Error lock unlock', async () => {
    await deployTokenManagerLockUnlock(deployer, deployer, user);

    await user.callContract({
      callee: tokenManager,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      funcArgs: [
        e.Option(user),
        e.Str('Token Name'),
        e.Str('TOKEN-SYMBOL'),
        e.U8(18),
      ],
    }).assertFail({ code: 4, message: 'Not mint burn token manager' });
  });
});

describe('Mint burn', () => {
  test('Mint', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, otherUser, TOKEN_ID, true, user);

    // Only minter can call this
    await otherUser.callContract({
      callee: tokenManager,
      funcName: 'mint',
      gasLimit: 20_000_000,
      funcArgs: [
        user,
        e.U(1_000),
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'mint',
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(1_000),
      ],
    });

    const kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: baseKvs,
    });

    // 1_000 tokens were minted and sent to otherUser
    const userKvs = await otherUser.getAccountWithKvs();
    assertAccount(userKvs, {
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_ID,
            amount: 1_000,
          },
        ]),
      ],
    });
  });

  test('Burn', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, otherUser, TOKEN_ID, true, user);

    // Only minter can call this
    await otherUser.callContract({
      callee: tokenManager,
      funcName: 'burn',
      gasLimit: 20_000_000,
      funcArgs: [],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'burn',
      gasLimit: 20_000_000,
      funcArgs: [],
      value: 1_000,
    }).assertFail({ code: 4, message: 'Wrong token sent' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'burn',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_ID, amount: 1_000 }],
    });

    const kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: baseKvs,
    });

    // 1_000 tokens were burned
    const userKvs = await user.getAccountWithKvs();
    assertAccount(userKvs, {
      balance: 10_000_000_000n,
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_ID,
            amount: 99_000,
          },
          {
            id: TOKEN_ID2,
            amount: 10_000,
          },
        ]),
      ],
    });
  });

  test('Errors', async () => {
    await deployTokenManagerMintBurn(deployer, deployer, otherUser, null, false, user);

    await user.callContract({
      callee: tokenManager,
      funcName: 'mint',
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(1_000),
      ],
    }).assertFail({ code: 4, message: 'Token address not yet set' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'burn',
      gasLimit: 20_000_000,
      funcArgs: [],
    }).assertFail({ code: 4, message: 'Token address not yet set' });
  });

  test('Error lock unlock', async () => {
    await deployTokenManagerLockUnlock(deployer, deployer, user);

    await user.callContract({
      callee: tokenManager,
      funcName: 'mint',
      gasLimit: 20_000_000,
      funcArgs: [
        otherUser,
        e.U(1_000),
      ],
    }).assertFail({ code: 4, message: 'Not mint burn token manager' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'burn',
      gasLimit: 20_000_000,
      funcArgs: [],
    }).assertFail({ code: 4, message: 'Not mint burn token manager' });
  });
});

describe('Mintership', () => {
  test('Transfer', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, otherUser, null, false, user);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'transferMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'transferMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        otherUser,
      ],
    });

    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000000)), // minter role was removed
        e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000111)), // flow limit & operator & minter role
      ],
    });

    // Check that minter was changed
    await otherUser.callContract({
      callee: tokenManager,
      funcName: 'transferMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        otherUser,
      ],
    });
  });

  test('Propose', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, otherUser, null, false, user);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'proposeMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        otherUser,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        otherUser,
      ],
    });

    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000001)),
      ],
    });

    // Proposed operator can not call this function
    await otherUser.callContract({
      callee: tokenManager,
      funcName: 'proposeMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        otherUser,
      ],
    }).assertFail({ code: 4, message: 'Missing any of roles' });

    // If called multiple times, multiple entries are added
    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    });

    kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000001)),
        e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000001)),
      ],
    });
  });

  test('Accept', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, otherUser, null, false, user);

    await deployer.callContract({
      callee: tokenManager,
      funcName: 'acceptMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    }).assertFail({ code: 4, message: 'Invalid proposed roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        otherUser,
      ],
    });

    // Propose other
    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        deployer,
      ],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'acceptMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    }).assertFail({ code: 4, message: 'Invalid proposed roles' });

    await otherUser.callContract({
      callee: tokenManager,
      funcName: 'acceptMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    });

    let kvs = await tokenManager.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      allKvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000000)), // minter role was removed
        e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000111)), // flow limit & operator & minter role

        e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000001)),
      ],
    });

    // deployer can no longer accept because user doesn't have minter role anymore
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'acceptMintership',
      gasLimit: 5_000_000,
      funcArgs: [
        user,
      ],
    }).assertFail({ code: 4, message: 'Missing all roles' });
  });
});
