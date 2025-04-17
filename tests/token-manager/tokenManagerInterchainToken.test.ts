import { afterEach, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, LSWallet, LSWorld } from 'xsuite';
import { TOKEN_IDENTIFIER, TOKEN_IDENTIFIER2 } from '../helpers';
import { deployTokenManagerInterchainToken, deployTokenManagerMintBurn, tokenManager } from '../itsHelpers';

let world: LSWorld;
let deployer: LSWallet;
let user: LSWallet;
let otherUser: LSWallet;

beforeEach(async () => {
  world = await LSWorld.start();
  await world.setCurrentBlockInfo({
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
          id: TOKEN_IDENTIFIER,
          amount: 100_000,
        },
        {
          id: TOKEN_IDENTIFIER2,
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
  test('Normal', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_IDENTIFIER);

    await user.callContract({
      callee: tokenManager,
      funcName: 'giveToken',
      gasLimit: 20_000_000,
      funcArgs: [otherUser, e.U(1_000)],
    });

    // Tokens were minted and sent from contract to otherUser
    const kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: baseKvs,
    });

    const otherUserKvs = await otherUser.getAccount();
    assertAccount(otherUserKvs, {
      kvs: [e.kvs.Esdts([{ id: TOKEN_IDENTIFIER, amount: 1_000 }])],
    });
  });

  test('With flow limit', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_IDENTIFIER);

    // Set flow limit
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [e.Option(e.U(500))],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'giveToken',
      gasLimit: 20_000_000,
      funcArgs: [otherUser, e.U(500)],
    });

    // Tokens were minted and sent from contract to otherUser
    let kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseKvs,

        e.kvs.Mapper('flow_limit').Value(e.Option(e.U(500))),
        e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(500)),
      ],
    });

    let otherUserKvs = await otherUser.getAccount();
    assertAccount(otherUserKvs, {
      kvs: [e.kvs.Esdts([{ id: TOKEN_IDENTIFIER, amount: 500 }])],
    });

    await world.setCurrentBlockInfo({
      timestamp: 6 * 3600 - 1,
    });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'giveToken',
        gasLimit: 20_000_000,
        funcArgs: [otherUser, e.U(500)],
      })
      .assertFail({ code: 4, message: 'Flow limit exceeded' });

    await world.setCurrentBlockInfo({
      timestamp: 6 * 3600,
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'giveToken',
      gasLimit: 20_000_000,
      funcArgs: [otherUser, e.U(500)],
    });

    kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseKvs,

        e.kvs.Mapper('flow_limit').Value(e.Option(e.U(500))),
        e.kvs.Mapper('flow_in_amount', e.U64(0)).Value(e.U(500)),
        e.kvs.Mapper('flow_in_amount', e.U64(1)).Value(e.U(500)),
      ],
    });

    otherUserKvs = await otherUser.getAccount();
    assertAccount(otherUserKvs, {
      kvs: [e.kvs.Esdts([{ id: TOKEN_IDENTIFIER, amount: 1_000 }])],
    });
  });

  test('Errors', async () => {
    await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_IDENTIFIER, false);

    await otherUser
      .callContract({
        callee: tokenManager,
        funcName: 'giveToken',
        gasLimit: 20_000_000,
        funcArgs: [otherUser, e.U(1_000)],
      })
      .assertFail({ code: 4, message: 'Not service' });

    // Test flow limit exceeded
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [e.Option(e.U(999))],
    });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'giveToken',
        gasLimit: 20_000_000,
        funcArgs: [otherUser, e.U(1_000)],
      })
      .assertFail({ code: 4, message: 'Flow limit exceeded' });

    // Contract can not mint tokens
    await user
      .callContract({
        callee: tokenManager,
        funcName: 'giveToken',
        gasLimit: 20_000_000,
        funcArgs: [otherUser, e.U(999)],
      })
      .assertFail({ code: 10, message: 'action is not allowed' });
  });
});

describe('Take token mint burn', () => {
  test('Take token', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_IDENTIFIER);

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
    });

    // Tokens were burned by contract
    const kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: baseKvs,
    });

    const userKvs = await user.getAccount();
    assertAccount(userKvs, {
      balance: 10_000_000_000n,
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_IDENTIFIER,
            amount: 99_000,
          },
          {
            id: TOKEN_IDENTIFIER2,
            amount: 10_000,
          },
        ]),
      ],
    });
  });

  test('Take token flow limit', async () => {
    const baseKvs = await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_IDENTIFIER);

    // Set flow limit
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [e.Option(e.U(500))],
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_IDENTIFIER, amount: 500 }],
    });

    // Tokens were burned by contract
    let kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseKvs,

        e.kvs.Mapper('flow_limit').Value(e.Option(e.U(500))),
        e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),
      ],
    });

    await world.setCurrentBlockInfo({
      timestamp: 6 * 3600 - 1,
    });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'takeToken',
        gasLimit: 20_000_000,
        funcArgs: [],
        esdts: [{ id: TOKEN_IDENTIFIER, amount: 500 }],
      })
      .assertFail({ code: 4, message: 'Flow limit exceeded' });

    await world.setCurrentBlockInfo({
      timestamp: 6 * 3600,
    });

    await user.callContract({
      callee: tokenManager,
      funcName: 'takeToken',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_IDENTIFIER, amount: 500 }],
    });

    kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseKvs,

        e.kvs.Mapper('flow_limit').Value(e.Option(e.U(500))),
        e.kvs.Mapper('flow_out_amount', e.U64(0)).Value(e.U(500)),
        e.kvs.Mapper('flow_out_amount', e.U64(1)).Value(e.U(500)),
      ],
    });

    const userKvs = await user.getAccount();
    assertAccount(userKvs, {
      balance: 10_000_000_000n,
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_IDENTIFIER,
            amount: 99_000,
          },
          {
            id: TOKEN_IDENTIFIER2,
            amount: 10_000,
          },
        ]),
      ],
    });
  });

  test('Take token errors', async () => {
    await deployTokenManagerMintBurn(deployer, deployer, user, TOKEN_IDENTIFIER, false);

    await deployer
      .callContract({
        callee: tokenManager,
        funcName: 'takeToken',
        gasLimit: 20_000_000,
        funcArgs: [],
        value: 1_000,
      })
      .assertFail({ code: 4, message: 'Not service' });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'takeToken',
        gasLimit: 20_000_000,
        funcArgs: [],
        value: 1_000,
      })
      .assertFail({ code: 4, message: 'Wrong token sent' });

    // Test flow limit exceeded
    await deployer.callContract({
      callee: tokenManager,
      funcName: 'setFlowLimit',
      gasLimit: 5_000_000,
      funcArgs: [e.Option(e.U(999))],
    });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'takeToken',
        gasLimit: 20_000_000,
        funcArgs: [],
        esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
      })
      .assertFail({ code: 4, message: 'Flow limit exceeded' });

    // Contract can not burn tokens
    await user
      .callContract({
        callee: tokenManager,
        funcName: 'takeToken',
        gasLimit: 20_000_000,
        funcArgs: [],
        esdts: [{ id: TOKEN_IDENTIFIER, amount: 999 }],
      })
      .assertFail({ code: 10, message: 'action is not allowed' });
  });
});

describe('Deploy interchain token', () => {
  test('Deploy', async () => {
    user = await world.createWallet({
      balance: BigInt('500000000000000000'),
    });

    const baseKvs = await deployTokenManagerInterchainToken(deployer, deployer, user);

    await user.callContract({
      callee: tokenManager,
      funcName: 'deployInterchainToken',
      gasLimit: 200_000_000,
      value: BigInt('50000000000000000'),
      funcArgs: [e.Option(user), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18), user],
    });

    const kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      hasKvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000111)), // minter role was added to user (ITS)
        e.kvs.Mapper('minter_address').Value(user),

        // Async call tested in itsCrossChainCalls.test.ts file
        e.kvs
          .Mapper('CB_CLOSURE................................')
          .Value(e.Tuple(e.Str('deploy_token_callback'), e.U32(1), e.Buffer(user.toTopU8A()))),
      ],
    });
  });

  test('Errors', async () => {
    const baseKvs = await deployTokenManagerInterchainToken(deployer, deployer, user);

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        value: BigInt('1'),
        funcArgs: [e.Option(user), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18)],
      })
      .assertFail({ code: 4, message: 'Invalid esdt issue cost' });

    await deployer
      .callContract({
        callee: tokenManager,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        funcArgs: [e.Option(user), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18)],
      })
      .assertFail({ code: 4, message: 'Not service or minter' });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        funcArgs: [e.Option(user), e.Str(''), e.Str('TOKEN-SYMBOL'), e.U8(18)],
      })
      .assertFail({ code: 4, message: 'Empty token name' });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        funcArgs: [e.Option(user), e.Str('Token Name'), e.Str(''), e.U8(18)],
      })
      .assertFail({ code: 4, message: 'Empty token symbol' });

    // Manually set token identifier
    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      kvs: [...baseKvs, e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_IDENTIFIER))],
    });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        funcArgs: [e.Option(user), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18)],
      })
      .assertFail({ code: 4, message: 'Token address already exists' });
  });

  test('Error other', async () => {
    await deployTokenManagerMintBurn(deployer, deployer, user);

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'deployInterchainToken',
        gasLimit: 200_000_000,
        funcArgs: [e.Option(user), e.Str('Token Name'), e.Str('TOKEN-SYMBOL'), e.U8(18)],
      })
      .assertFail({ code: 4, message: 'Not native interchain token manager' });
  });
});

describe('Mint burn', () => {
  test('Mint', async () => {
    const baseKvs = await deployTokenManagerInterchainToken(deployer, deployer, deployer, TOKEN_IDENTIFIER, true, user);

    // Only minter can call this
    await otherUser
      .callContract({
        callee: tokenManager,
        funcName: 'mint',
        gasLimit: 20_000_000,
        funcArgs: [user, e.U(1_000)],
      })
      .assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'mint',
      gasLimit: 20_000_000,
      funcArgs: [otherUser, e.U(1_000)],
    });

    const kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: baseKvs,
    });

    // 1_000 tokens were minted and sent to otherUser
    const userKvs = await otherUser.getAccount();
    assertAccount(userKvs, {
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_IDENTIFIER,
            amount: 1_000,
          },
        ]),
      ],
    });
  });

  test('Burn', async () => {
    const baseKvs = await deployTokenManagerInterchainToken(deployer, deployer, deployer, TOKEN_IDENTIFIER, true, user);

    // Only minter can call this
    await otherUser
      .callContract({
        callee: tokenManager,
        funcName: 'burn',
        gasLimit: 20_000_000,
        funcArgs: [],
      })
      .assertFail({ code: 4, message: 'Missing any of roles' });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'burn',
        gasLimit: 20_000_000,
        funcArgs: [],
        value: 1_000,
      })
      .assertFail({ code: 4, message: 'Wrong token sent' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'burn',
      gasLimit: 20_000_000,
      funcArgs: [],
      esdts: [{ id: TOKEN_IDENTIFIER, amount: 1_000 }],
    });

    const kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: baseKvs,
    });

    // 1_000 tokens were burned
    const userKvs = await user.getAccount();
    assertAccount(userKvs, {
      balance: 10_000_000_000n,
      kvs: [
        e.kvs.Esdts([
          {
            id: TOKEN_IDENTIFIER,
            amount: 99_000,
          },
          {
            id: TOKEN_IDENTIFIER2,
            amount: 10_000,
          },
        ]),
      ],
    });
  });

  test('Errors', async () => {
    await deployTokenManagerInterchainToken(deployer, deployer, otherUser, null, false, user);

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'mint',
        gasLimit: 20_000_000,
        funcArgs: [otherUser, e.U(1_000)],
      })
      .assertFail({ code: 4, message: 'Token address not yet set' });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'burn',
        gasLimit: 20_000_000,
        funcArgs: [],
      })
      .assertFail({ code: 4, message: 'Token address not yet set' });
  });

  test('Error other', async () => {
    await deployTokenManagerMintBurn(deployer, deployer, user);

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'mint',
        gasLimit: 20_000_000,
        funcArgs: [otherUser, e.U(1_000)],
      })
      .assertFail({ code: 4, message: 'Not native interchain token manager' });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'burn',
        gasLimit: 20_000_000,
        funcArgs: [],
      })
      .assertFail({ code: 4, message: 'Not native interchain token manager' });
  });
});

describe('Mintership', () => {
  test('Transfer', async () => {
    const baseKvs = await deployTokenManagerInterchainToken(deployer, deployer, otherUser, null, false, user);

    await deployer
      .callContract({
        callee: tokenManager,
        funcName: 'transferMintership',
        gasLimit: 5_000_000,
        funcArgs: [deployer],
      })
      .assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'transferMintership',
      gasLimit: 5_000_000,
      funcArgs: [otherUser],
    });

    let kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000000)), // minter role was removed
        e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000111)), // flow limit & operator & minter role
        e.kvs.Mapper('minter_address').Value(otherUser),
      ],
    });

    // Check that minter was changed
    await otherUser.callContract({
      callee: tokenManager,
      funcName: 'transferMintership',
      gasLimit: 5_000_000,
      funcArgs: [otherUser],
    });
  });

  test('Propose', async () => {
    const baseKvs = await deployTokenManagerInterchainToken(deployer, deployer, otherUser, null, false, user);

    await deployer
      .callContract({
        callee: tokenManager,
        funcName: 'proposeMintership',
        gasLimit: 5_000_000,
        funcArgs: [otherUser],
      })
      .assertFail({ code: 4, message: 'Missing any of roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeMintership',
      gasLimit: 5_000_000,
      funcArgs: [otherUser],
    });

    let kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [...baseKvs, e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000001))],
    });

    // Proposed operator can not call this function
    await otherUser
      .callContract({
        callee: tokenManager,
        funcName: 'proposeMintership',
        gasLimit: 5_000_000,
        funcArgs: [otherUser],
      })
      .assertFail({ code: 4, message: 'Missing any of roles' });

    // If called multiple times, multiple entries are added
    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeMintership',
      gasLimit: 5_000_000,
      funcArgs: [deployer],
    });

    kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseKvs,

        e.kvs.Mapper('proposed_roles', user, otherUser).Value(e.U32(0b00000001)),
        e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000001)),
      ],
    });
  });

  test('Accept', async () => {
    const baseKvs = await deployTokenManagerInterchainToken(deployer, deployer, otherUser, null, false, user);

    await deployer
      .callContract({
        callee: tokenManager,
        funcName: 'acceptMintership',
        gasLimit: 5_000_000,
        funcArgs: [user],
      })
      .assertFail({ code: 4, message: 'Invalid proposed roles' });

    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeMintership',
      gasLimit: 5_000_000,
      funcArgs: [otherUser],
    });

    // Propose other
    await user.callContract({
      callee: tokenManager,
      funcName: 'proposeMintership',
      gasLimit: 5_000_000,
      funcArgs: [deployer],
    });

    await user
      .callContract({
        callee: tokenManager,
        funcName: 'acceptMintership',
        gasLimit: 5_000_000,
        funcArgs: [user],
      })
      .assertFail({ code: 4, message: 'Invalid proposed roles' });

    await otherUser.callContract({
      callee: tokenManager,
      funcName: 'acceptMintership',
      gasLimit: 5_000_000,
      funcArgs: [user],
    });

    let kvs = await tokenManager.getAccount();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseKvs,

        e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000000)), // minter role was removed
        e.kvs.Mapper('account_roles', otherUser).Value(e.U32(0b00000111)), // flow limit & operator & minter role
        e.kvs.Mapper('minter_address').Value(otherUser),

        e.kvs.Mapper('proposed_roles', user, deployer).Value(e.U32(0b00000001)),
      ],
    });

    // deployer can no longer accept because user doesn't have minter role anymore
    await deployer
      .callContract({
        callee: tokenManager,
        funcName: 'acceptMintership',
        gasLimit: 5_000_000,
        funcArgs: [user],
      })
      .assertFail({ code: 4, message: 'Missing all roles' });
  });
});
