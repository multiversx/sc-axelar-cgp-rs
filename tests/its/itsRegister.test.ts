import { afterEach, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, LSWallet, LSWorld } from 'xsuite';
import { TOKEN_ID, TOKEN_ID2 } from '../helpers';
import { baseItsKvs, deployContracts, its } from '../itsHelpers';

let world: LSWorld;
let deployer: LSWallet;
let collector: LSWallet;
let user: LSWallet;

beforeEach(async () => {
  world = await LSWorld.start();
  await world.setCurrentBlockInfo({
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

  await deployContracts(deployer, collector);
});

afterEach(async () => {
  await world.terminate();
});

describe('Register token metadata', () => {
  test('Register token metadata', async () => {
    await user.callContract({
      callee: its,
      funcName: 'registerTokenMetadata',
      gasLimit: 100_000_000,
      funcArgs: [e.Str(TOKEN_ID)],
      value: 100,
    });

    let kvs = await its.getAccount();
    assertAccount(kvs, {
      balance: 100n,
      hasKvs: [
        ...baseItsKvs(deployer),

        e.kvs
          .Mapper('CB_CLOSURE................................')
          .Value(
            e.Tuple(
              e.Str('register_token_metadata_callback'),
              e.TopBuffer('00000003'),
              e.Buffer(e.Str(TOKEN_ID).toTopU8A()),
              e.U(100),
              e.Buffer(user.toTopU8A())
            )
          ),
      ],
    });
  });

  test('Errors', async () => {
    await user
      .callContract({
        callee: its,
        funcName: 'registerTokenMetadata',
        gasLimit: 100_000_000,
        funcArgs: [e.Str('')],
      })
      .assertFail({ code: 4, message: 'Invalid token identifier' });
  });
});
