import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, LSContract, LSWallet, LSWorld } from 'xsuite';
import {
  ADDRESS_ZERO,
  ALICE_PUB_KEY,
  BOB_PUB_KEY,
  CAROL_PUB_KEY,
  DOMAIN_SEPARATOR,
  generateMessageSignature,
  generateProof,
  generateRotateSignersSignature,
  getKeccak256Hash, getMessageHash,
  getSignersHash,
  MESSAGE_ID,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  PAYLOAD_HASH,
  TOKEN_IDENTIFIER,
  TOKEN_IDENTIFIER2,
} from '../helpers';
import { deployPingPongInterchain, pingPong } from '../itsHelpers';

let world: LSWorld;
let deployer: LSWallet;
let firstUser: LSWallet;
let contract: LSContract;
let address: string;

beforeEach(async () => {
  world = await LSWorld.start();
  await world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  });

  deployer = await world.createWallet({
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
  firstUser = await world.createWallet();
});

afterEach(async () => {
  await world.terminate();
});

const baseKvs = () => {
  return [
    e.kvs.Mapper('previous_signers_retention').Value(e.U(16)),
    e.kvs.Mapper('domain_separator').Value(e.TopBuffer(DOMAIN_SEPARATOR)),
    e.kvs.Mapper('minimum_rotation_delay').Value(e.U64(3600)),

    e.kvs.Mapper('operator').Value(firstUser),
    e.kvs.Mapper('signer_hash_by_epoch', e.U(1)).Value(e.TopBuffer(defaultSignersHash)),
    e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(defaultSignersHash)).Value(e.U(1)),
    e.kvs.Mapper('epoch').Value(e.U(1)),
  ];
};

const defaultWeightedSigners = e.Tuple(
  e.List(
    e.Tuple(e.TopBuffer(ALICE_PUB_KEY), e.U(5)),
    e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(6)),
    e.Tuple(e.TopBuffer(CAROL_PUB_KEY), e.U(7)),
  ),
  e.U(10),
  e.TopBuffer(getKeccak256Hash('nonce1')),
);

// Signers hash used in Ampd to verify that the computation there is correct. Uncomment and log to display
// const ampdSignersHash = getSignersHash(
//   [
//     { signer: '45e67eaf446e6c26eb3a2b55b64339ecf3a4d1d03180bee20eb5afdd23fa644f', weight: 1 },
//     { signer: 'c387253d29085a8036d6ae2cafb1b14699751417c0ce302cfe03da279e6b5c04', weight: 1 },
//     { signer: 'dd9822c7fa239dda9913ebee813ecbe69e35d88ff651548d5cc42c033a8a667b', weight: 1 },
//   ],
//   2,
//   '0000000000000000000000000000000000000000000000000000000000000005',
// );

const defaultSignersHash = getSignersHash(
  [
    { signer: ALICE_PUB_KEY, weight: 5 },
    { signer: BOB_PUB_KEY, weight: 6 },
    { signer: CAROL_PUB_KEY, weight: 7 },
  ],
  10,
  getKeccak256Hash('nonce1'),
);

const deployContract = async () => {
  ({ contract, address } = await deployer.deployContract({
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.U(16),
      e.TopBuffer(DOMAIN_SEPARATOR),
      e.U64(3600),
      firstUser,
      defaultWeightedSigners,
    ],
  }));

  assertAccount(await contract.getAccount(), {
    balance: 0n,
    kvs: baseKvs(),
  });
};

test('Init', async () => {
  // With zero address and no signer
  ({ contract, address } = await deployer.deployContract({
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.U(16),
      e.TopBuffer(DOMAIN_SEPARATOR),
      e.U64(3600),
      e.Addr(ADDRESS_ZERO),
    ],
  }));

  assertAccount(await contract.getAccount(), {
    balance: 0n,
    kvs: [
      e.kvs.Mapper('previous_signers_retention').Value(e.U(16)),
      e.kvs.Mapper('domain_separator').Value(e.TopBuffer(DOMAIN_SEPARATOR)),
      e.kvs.Mapper('minimum_rotation_delay').Value(e.U64(3600)),
    ],
  });
});

test('Upgrade', async () => {
  await deployContract();

  // Upgrade with no operator and no signers
  await deployer.upgradeContract({
    callee: contract,
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(ADDRESS_ZERO),
    ],
  });

  assertAccount(await contract.getAccount(), {
    balance: 0n,
    kvs: baseKvs(),
  });

  const wrongWeightedSigners = e.Tuple(
    e.List(
      e.Tuple(e.TopBuffer(CAROL_PUB_KEY), e.U(5)),
      e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(5)),
    ),
    e.U(5),
    e.TopBuffer(getKeccak256Hash('nonce2')),
  );

  // Upgrade with new operator and wrong signers is non ascending order
  await deployer.upgradeContract({
    callee: contract,
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
      wrongWeightedSigners,
    ],
  }).assertFail({ code: 4, message: 'Invalid signers' });

  const weightedSigners = e.Tuple(
    e.List(
      e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(5)),
      e.Tuple(e.TopBuffer(CAROL_PUB_KEY), e.U(5)),
    ),
    e.U(5),
    e.TopBuffer(getKeccak256Hash('nonce2')),
  );

  // Upgrade with new operator and new signers
  await deployer.upgradeContract({
    callee: contract,
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      deployer,
      weightedSigners,
    ],
  });

  const signersHash = getSignersHash(
    [
      { signer: BOB_PUB_KEY, weight: 5 },
      { signer: CAROL_PUB_KEY, weight: 5 },
    ],
    5,
    getKeccak256Hash('nonce2'),
  );

  assertAccount(await contract.getAccount(), {
    balance: 0n,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('operator').Value(deployer),
      e.kvs.Mapper('signer_hash_by_epoch', e.U(2)).Value(e.TopBuffer(signersHash)),
      e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(signersHash)).Value(e.U(2)),
      e.kvs.Mapper('epoch').Value(e.U(2)),
    ],
  });
});

describe('Approve messages', () => {
  test('Errors', async () => {
    await deployContract();

    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.Buffer('00'),
        generateProof(defaultWeightedSigners, []),
      ],
    }).assertFail({ code: 4, message: 'Could not decode messages' });

    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(),
        generateProof(defaultWeightedSigners, []),
      ],
    }).assertFail({ code: 4, message: 'Invalid messages' });
  });

  test('Validate proof errors', async () => {
    await deployContract();

    const invalidWeightedSigners = e.Tuple(
      e.List(e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(5))),
      e.U(5),
      e.TopBuffer(getKeccak256Hash('nonce2')),
    );

    const message = e.Tuple(
      e.Str('ethereum'),
      e.Str('messageId'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      deployer,
      e.TopBuffer(PAYLOAD_HASH),
    );

    // Invalid signers
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(invalidWeightedSigners, []),
      ],
    }).assertFail({ code: 4, message: 'Invalid signers' });

    // Empty signatures
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(defaultWeightedSigners, []),
      ],
    }).assertFail({ code: 4, message: 'Low signatures weight' });

    // Signatures length != signers length
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(defaultWeightedSigners, [null]),
      ],
    }).assertFail({ code: 4, message: 'Low signatures weight' });

    // Partial signatures not enough
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(
          defaultWeightedSigners,
          [generateMessageSignature(defaultSignersHash, e.List(message)), null, null],
        ),
      ],
    }).assertFail({ code: 4, message: 'Low signatures weight' });

    // Sign invalid message
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(defaultWeightedSigners, [generateMessageSignature(defaultSignersHash, e.List()), null, null]),
      ],
    }).assertFail({ code: 10, message: 'invalid signature' });

    // Change epoch to be after signers hash expires
    await contract.setAccount({
      ...await contract.getAccount(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('epoch').Value(e.U(18)),
      ],
    });

    // Signers expired
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(defaultWeightedSigners, [generateMessageSignature(defaultSignersHash, e.List()), null, null]),
      ],
    }).assertFail({ code: 4, message: 'Invalid signers' });
  });

  test('Message already approved', async () => {
    await deployContract();

    const message = e.Tuple(
      e.Str('ethereum'),
      e.Str('messageId'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      deployer,
      e.TopBuffer(PAYLOAD_HASH),
    );
    const messageHash = getKeccak256Hash('mock');

    const crossChainId = e.Tuple(e.Str('ethereum'), e.Str('messageId'));

    // Mock message approved
    await contract.setAccount({
      ...await contract.getAccount(),
      codeMetadata: ['payable'],
      kvs: [
        ...baseKvs(),

        // Manually approve message
        e.kvs.Mapper('messages', crossChainId).Value(e.TopBuffer(messageHash)),
      ],
    });

    // Partial signatures are enough, last signature is not checked
    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(
          defaultWeightedSigners, [
            generateMessageSignature(defaultSignersHash, e.List(message)),
            generateMessageSignature(defaultSignersHash, e.List(message), './bob.pem'),
            generateMessageSignature(defaultSignersHash, e.List(message)), // this is invalid but is not checked
          ],
        ),
      ],
    });

    // Nothing was actually changed
    assertAccount(await contract.getAccount(), {
      balance: 0,
      kvs: [
        ...baseKvs(),

        // Message was approved
        e.kvs.Mapper('messages', crossChainId).Value(e.TopBuffer(messageHash)),
      ],
    });
  });

  test('Message already executed', async () => {
    await deployContract();

    const message = e.Tuple(
      e.Str('ethereum'),
      e.Str('messageId'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      deployer,
      e.TopBuffer(PAYLOAD_HASH),
    );

    const crossChainId = e.Tuple(e.Str('ethereum'), e.Str('messageId'));

    // Mock message executed
    await contract.setAccount({
      ...await contract.getAccount(),
      codeMetadata: ['payable'],
      kvs: [
        ...baseKvs(),

        // Manually execute message
        e.kvs.Mapper('messages', crossChainId).Value(e.Str('1')),
      ],
    });

    // Partial signatures are enough
    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(
          defaultWeightedSigners, [
            generateMessageSignature(defaultSignersHash, e.List(message)),
            null,
            generateMessageSignature(defaultSignersHash, e.List(message), './carol.pem'),
          ],
        ),
      ],
    });

    // Nothing was actually changed
    assertAccount(await contract.getAccount(), {
      balance: 0,
      kvs: [
        ...baseKvs(),

        // Message was executed
        e.kvs.Mapper('messages', crossChainId).Value(e.Str('1')),
      ],
    });
  });

  test('Message approved', async () => {
    await deployContract();

    const message = e.Tuple(
      e.Str('ethereum'),
      e.Str('messageId'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      deployer,
      e.TopBuffer(PAYLOAD_HASH),
    );
    const messageHash = getMessageHash('ethereum', 'messageId', '0x4976da71bF84D750b5451B053051158EC0A4E876', deployer);

    const crossChainId = e.Tuple(e.Str('ethereum'), e.Str('messageId'));

    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'approveMessages',
      funcArgs: [
        e.List(message),
        generateProof(
          defaultWeightedSigners, [
            generateMessageSignature(defaultSignersHash, e.List(message)),
            generateMessageSignature(defaultSignersHash, e.List(message), './bob.pem'),
            generateMessageSignature(defaultSignersHash, e.List(message), './carol.pem'),
          ],
        ),
      ],
    });

    assertAccount(await contract.getAccount(), {
      balance: 0,
      kvs: [
        ...baseKvs(),

        // Message was approved
        e.kvs.Mapper('messages', crossChainId).Value(messageHash),
      ],
    });
  });
});

describe('Rotate signers', () => {
  const newWeightedSigners = e.Tuple(
    e.List(e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(5))),
    e.U(5),
    e.TopBuffer(getKeccak256Hash('nonce2')),
  );

  test('Errors', async () => {
    await deployContract();

    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        e.Buffer('00'),
        generateProof(defaultWeightedSigners, []),
      ],
    }).assertFail({ code: 4, message: 'Could not decode new signers' });

    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Insufficient rotation delay' });

    // Operator can execute regardless of rotation delay, hence duplication will be checked
    await firstUser.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        defaultWeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, defaultWeightedSigners),
            generateRotateSignersSignature(defaultSignersHash, defaultWeightedSigners, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Duplicate signers' });

    // Change epoch so default signers are not the latest
    await contract.setAccount({
      ...await contract.getAccount(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('epoch').Value(e.U(2)),
      ],
    });

    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Not latest signers' });
  });

  test('Errors validate signers', async () => {
    await deployContract();

    let newWeightedSignersInvalid = e.Tuple(
      e.List(),
      e.U(0),
      e.TopBuffer(getKeccak256Hash('nonce2')),
    );

    // Empty signers
    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSignersInvalid,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid signers' });

    newWeightedSignersInvalid = e.Tuple(
      e.List(
        e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(5)),
        e.Tuple(e.TopBuffer(ALICE_PUB_KEY), e.U(5)),
      ),
      e.U(0),
      e.TopBuffer(getKeccak256Hash('nonce2')),
    );

    // Invalid order
    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSignersInvalid,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid signers' });

    newWeightedSignersInvalid = e.Tuple(
      e.List(
        e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(5)),
        e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(5)),
      ),
      e.U(0),
      e.TopBuffer(getKeccak256Hash('nonce2')),
    );

    // Invalid, contains duplicates
    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSignersInvalid,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid signers' });

    newWeightedSignersInvalid = e.Tuple(
      e.List(
        e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(0)),
      ),
      e.U(0),
      e.TopBuffer(getKeccak256Hash('nonce2')),
    );

    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSignersInvalid,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid weights' });

    newWeightedSignersInvalid = e.Tuple(
      e.List(
        e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(1)),
      ),
      e.U(0),
      e.TopBuffer(getKeccak256Hash('nonce2')),
    );

    // Threshold is zero
    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSignersInvalid,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid threshold' });

    newWeightedSignersInvalid = e.Tuple(
      e.List(
        e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(1)),
      ),
      e.U(2),
      e.TopBuffer(getKeccak256Hash('nonce2')),
    );

    // Total weight less than threshold
    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSignersInvalid,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSignersInvalid, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid threshold' });
  });

  test('Validate proof errors', async () => {
    await deployContract();

    // Invalid signers
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(newWeightedSigners, []),
      ],
    }).assertFail({ code: 4, message: 'Invalid signers' });

    // Empty signers
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(defaultWeightedSigners, []),
      ],
    }).assertFail({ code: 4, message: 'Low signatures weight' });

    // Signatures length != signers length
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(defaultWeightedSigners, [null]),
      ],
    }).assertFail({ code: 4, message: 'Low signatures weight' });

    // Partial signatures not enough
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners),
            null,
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Low signatures weight' });

    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, e.TopBuffer('')),
            null,
            null,
          ],
        ),
      ],
    }).assertFail({ code: 10, message: 'invalid signature' });

    // Change epoch to be after signers hash expires
    await contract.setAccount({
      ...await contract.getAccount(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('epoch').Value(e.U(18)),
      ],
    });

    // Signers expired
    await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, e.TopBuffer('')),
            null,
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid signers' });
  });

  test('Rotate signers latest signers', async () => {
    await deployContract();

    await world.setCurrentBlockInfo({
      timestamp: 3600,
    });

    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners, './bob.pem'),
            null,
          ],
        ),
      ],
    });

    const signersHash = getSignersHash(
      [
        { signer: BOB_PUB_KEY, weight: 5 },
      ],
      5,
      getKeccak256Hash('nonce2'),
    );

    assertAccount(await contract.getAccount(), {
      balance: 0n,
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('operator').Value(firstUser),
        e.kvs.Mapper('signer_hash_by_epoch', e.U(2)).Value(e.TopBuffer(signersHash)),
        e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(signersHash)).Value(e.U(2)),
        e.kvs.Mapper('epoch').Value(e.U(2)),
        e.kvs.Mapper('last_rotation_timestamp').Value(e.U64(3600)),
      ],
    });

    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Not latest signers' });
  });

  test('Rotate signers older signers', async () => {
    await deployContract();

    const signersHash = getSignersHash(
      [
        { signer: BOB_PUB_KEY, weight: 5 },
      ],
      5,
      getKeccak256Hash('nonce2'),
    );

    // Mock new signers exist
    await contract.setAccount({
      ...await contract.getAccount(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('operator').Value(firstUser),
        e.kvs.Mapper('signer_hash_by_epoch', e.U(2)).Value(e.TopBuffer(signersHash)),
        e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(signersHash)).Value(e.U(2)),
        e.kvs.Mapper('epoch').Value(e.U(2)),
        e.kvs.Mapper('last_rotation_timestamp').Value(e.U64(3600)),
      ],
    });

    // Non operator can not rotate with older signers
    await deployer.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Not latest signers' });

    // Only operator can rotate with older signers
    await firstUser.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        newWeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners),
            generateRotateSignersSignature(defaultSignersHash, newWeightedSigners, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Duplicate signers' });

    const new2WeightedSigners = e.Tuple(
      e.List(e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(5))),
      e.U(5),
      e.TopBuffer(getKeccak256Hash('nonce3')),
    );

    // Actually rotate to new signers. Operator also ignores rotation delay
    await firstUser.callContract({
      callee: contract,
      gasLimit: 15_000_000,
      funcName: 'rotateSigners',
      funcArgs: [
        new2WeightedSigners,
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, new2WeightedSigners),
            generateRotateSignersSignature(defaultSignersHash, new2WeightedSigners, './bob.pem'),
            null,
          ],
        ),
      ],
    });

    const newSignersHash = getSignersHash(
      [
        { signer: BOB_PUB_KEY, weight: 5 },
      ],
      5,
      getKeccak256Hash('nonce3'),
    );

    assertAccount(await contract.getAccount(), {
      balance: 0n,
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('operator').Value(firstUser),
        e.kvs.Mapper('signer_hash_by_epoch', e.U(2)).Value(e.TopBuffer(signersHash)),
        e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(signersHash)).Value(e.U(2)),
        e.kvs.Mapper('epoch').Value(e.U(3)),

        e.kvs.Mapper('signer_hash_by_epoch', e.U(3)).Value(e.TopBuffer(newSignersHash)),
        e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(newSignersHash)).Value(e.U(3)),
      ],
    });
  });
});

test('Call contract', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'callContract',
    funcArgs: [
      e.Str('ethereum'),
      e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      e.Str('payload'),
    ],
  });

  // This only emits an event, and there is no way to test those currently...
  assertAccount(await contract.getAccount(), {
    balance: 0,
    kvs: baseKvs(),
  });
});

describe('Validate message', () => {
  test('Validate message invalid', async () => {
    await deployContract();

    const result = await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'validateMessage',
      funcArgs: [
        e.Str('ethereum'),
        e.Str('messageId'),
        e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
        e.TopBuffer(PAYLOAD_HASH),
      ],
    });
    assert(result.returnData[0] === '');

    assertAccount(await contract.getAccount(), {
      balance: 0,
      kvs: baseKvs(),
    });
  });

  test('Validate message valid', async () => {
    await deployContract();

    const messageHash = getMessageHash('ethereum', 'messageId', '0x4976da71bF84D750b5451B053051158EC0A4E876', deployer);

    const crossChainId = e.Tuple(e.Str('ethereum'), e.Str('messageId'));

    await contract.setAccount({
      ...await contract.getAccount(),
      codeMetadata: ['payable'],
      kvs: [
        ...baseKvs(),

        // Manually approve message
        e.kvs.Mapper('messages', crossChainId).Value(messageHash),
      ],
    });

    const result = await deployer.callContract({
      callee: contract,
      gasLimit: 10_000_000,
      funcName: 'validateMessage',
      funcArgs: [
        e.Str('ethereum'),
        e.Str('messageId'),
        e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
        e.TopBuffer(PAYLOAD_HASH),
      ],
    });
    assert(result.returnData[0] === '01');

    assertAccount(await contract.getAccount(), {
      balance: 0,
      kvs: [
        ...baseKvs(),

        // Message was executed
        e.kvs.Mapper('messages', crossChainId).Value(e.Str('1')),
      ],
    });
  });
});

describe('Operator', () => {
  test('Transfer operatorship', async () => {
    await deployContract();

    const otherWallet = await world.createWallet();

    await otherWallet.callContract({
      callee: contract,
      funcName: 'transferOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        otherWallet,
      ],
    }).assertFail({ code: 4, message: 'Invalid sender' });

    await deployer.callContract({
      callee: contract,
      funcName: 'transferOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        e.Addr(ADDRESS_ZERO),
      ],
    }).assertFail({ code: 4, message: 'Invalid operator' });

    // Deployer can change operatorship
    await deployer.callContract({
      callee: contract,
      funcName: 'transferOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        otherWallet,
      ],
    });

    assertAccount(await contract.getAccount(), {
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('operator').Value(otherWallet),
      ],
    });

    // Operator can also change operatorship
    await otherWallet.callContract({
      callee: contract,
      funcName: 'transferOperatorship',
      gasLimit: 5_000_000,
      funcArgs: [
        firstUser,
      ],
    });

    assertAccount(await contract.getAccount(), {
      kvs: baseKvs(),
    });
  });
});

describe('View functions', () => {
  const crossChainId = e.Tuple(e.Str('ethereum'), e.Str('messageId'));

  test('Message approved', async () => {
    await deployContract();

    const messageHash = getMessageHash('ethereum', 'messageId', '0x4976da71bF84D750b5451B053051158EC0A4E876', deployer);

    // Mock message approved
    await contract.setAccount({
      ...await contract.getAccount(),
      codeMetadata: ['payable'],
      kvs: [
        ...baseKvs(),

        // Manually approve message
        e.kvs.Mapper('messages', crossChainId).Value(messageHash),
      ],
    });

    let result = await world.query({
      callee: contract,
      funcName: 'isMessageApproved',
      funcArgs: [
        e.Str('ethereum'),
        e.Str('messageId'),
        e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
        e.Addr(deployer.toString()),
        e.TopBuffer(PAYLOAD_HASH),
      ],
    });
    assert(result.returnData[0] === '01');

    result = await world.query({
      callee: contract,
      funcName: 'isMessageExecuted',
      funcArgs: [
        e.Str('ethereum'),
        e.Str('messageId'),
      ],
    });
    assert(result.returnData[0] === '');
  });

  test('Message executed', async () => {
    await deployContract();

    // Mock message executed
    await contract.setAccount({
      ...await contract.getAccount(),
      codeMetadata: ['payable'],
      kvs: [
        ...baseKvs(),

        // Manually approve message
        e.kvs.Mapper('messages', crossChainId).Value(e.Str('1')),
      ],
    });

    let result = await world.query({
      callee: contract,
      funcName: 'isMessageApproved',
      funcArgs: [
        e.Str('ethereum'),
        e.Str('messageId'),
        e.Str('0x4976da71bF84D750b5451B053051158EC0A4E876'),
        e.Addr(deployer.toString()),
        e.TopBuffer(PAYLOAD_HASH),
      ],
    });
    assert(result.returnData[0] === '');

    result = await world.query({
      callee: contract,
      funcName: 'isMessageExecuted',
      funcArgs: [
        e.Str('ethereum'),
        e.Str('messageId'),
      ],
    });
    assert(result.returnData[0] === '01');
  });

  test('Validate proof', async () => {
    await deployContract();

    const data = e.List();
    const dataHash = getKeccak256Hash(Buffer.concat([
      Buffer.from('00', 'hex'), // ApproveMessages command type,
      data.toTopU8A(),
    ]));

    await world.query({
      callee: contract,
      funcName: 'validateProof',
      funcArgs: [
        e.TopBuffer(dataHash),
        generateProof(
          defaultWeightedSigners, [
            generateRotateSignersSignature(defaultSignersHash, data),
            null,
            null,
          ],
        ),
      ],
    }).assertFail({ code: 10, message: 'invalid signature' });

    await world.query({
      callee: contract,
      funcName: 'validateProof',
      funcArgs: [
        e.TopBuffer(dataHash),
        generateProof(
          defaultWeightedSigners, [
            generateMessageSignature(defaultSignersHash, data),
            null,
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Low signatures weight' });

    let result = await world.query({
      callee: contract,
      funcName: 'validateProof',
      funcArgs: [
        e.TopBuffer(dataHash),
        generateProof(
          defaultWeightedSigners, [
            generateMessageSignature(defaultSignersHash, data),
            generateMessageSignature(defaultSignersHash, data, './bob.pem'),
            null,
          ],
        ),
      ],
    });
    assert(result.returnData[0] === '01');

    const signersHash = getSignersHash(
      [
        { signer: BOB_PUB_KEY, weight: 5 },
      ],
      5,
      getKeccak256Hash('nonce2'),
    );

    // Mock new signers exist
    await contract.setAccount({
      ...await contract.getAccount(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('operator').Value(firstUser),
        e.kvs.Mapper('signer_hash_by_epoch', e.U(2)).Value(e.TopBuffer(signersHash)),
        e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(signersHash)).Value(e.U(2)),
        e.kvs.Mapper('epoch').Value(e.U(2)),
        e.kvs.Mapper('last_rotation_timestamp').Value(e.U64(3600)),
      ],
    });

    result = await world.query({
      callee: contract,
      funcName: 'validateProof',
      funcArgs: [
        e.TopBuffer(dataHash),
        generateProof(
          defaultWeightedSigners, [
            generateMessageSignature(defaultSignersHash, data),
            generateMessageSignature(defaultSignersHash, data, './bob.pem'),
            null,
          ],
        ),
      ],
    });
    assert(result.returnData[0] === '');

    // Mock epoch passed and signers no longer valid
    await contract.setAccount({
      ...await contract.getAccount(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('epoch').Value(e.U(18)),
      ],
    });

    await world.query({
      callee: contract,
      funcName: 'validateProof',
      funcArgs: [
        e.TopBuffer(dataHash),
        generateProof(
          defaultWeightedSigners, [
            generateMessageSignature(defaultSignersHash, data),
            generateMessageSignature(defaultSignersHash, data, './bob.pem'),
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid signers' });

    const newWeightedSigners = e.Tuple(
      e.List(e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(5))),
      e.U(5),
      e.TopBuffer(getKeccak256Hash('nonce2')),
    );

    // Invalid signers
    await world.query({
      callee: contract,
      funcName: 'validateProof',
      funcArgs: [
        e.TopBuffer(dataHash),
        generateProof(
          newWeightedSigners, [
            null,
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid signers' });
  });

  test('Validate proof manipulate signers hash ', async () => {
    await deployContract();

    const data = e.List();
    const dataHash = getKeccak256Hash(Buffer.concat([
      Buffer.from('00', 'hex'), // ApproveMessages command type,
      data.toTopU8A(),
    ]));

    // Spoof by top encoding Carol pub key in the weight of bob, without actually having the carol pub key
    // in the signer set
    const spoofedWeight = Buffer.concat([
      Buffer.from('06', 'hex'), // weight of bob
      Buffer.from(CAROL_PUB_KEY, 'hex'), // carol pub key
      Buffer.from('07', 'hex'), // weight of carol
    ]).toString('hex');

    // Omit carol from defaultWeightedSigners since we are trying to spoof it using the weight of bob
    const signers = [
      { signer: ALICE_PUB_KEY, weight: '05' },
      {
        signer: BOB_PUB_KEY,
        weight: spoofedWeight,
      },
    ];
    let dataForSignersHashToSpoof = Buffer.concat([
      ...signers.map(signer => {
        return Buffer.concat([
          Buffer.from(signer.signer, 'hex'),
          Buffer.from(signer.weight, 'hex'),
        ]);
      }),
      Buffer.from('0a', 'hex'), // threshold
      Buffer.from(getKeccak256Hash('nonce1'), 'hex'),
    ]);
    const spoofedWeightedSigners = e.Tuple(
      e.List(
        e.Tuple(e.TopBuffer(ALICE_PUB_KEY), e.U(5)),
        e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.Buffer(spoofedWeight)), // use custom spoofed top encoded hex instead of weight
      ),
      e.U(10),
      e.TopBuffer(getKeccak256Hash('nonce1')),
    );

    // Hash can not be the same
    assert(getKeccak256Hash(dataForSignersHashToSpoof) != defaultSignersHash.toString('hex'));

    // Bob spoofed signature, but it will not work since we use nested encoding in contract which can not be spoofed
    await world.query({
      callee: contract,
      funcName: 'validateProof',
      funcArgs: [
        e.TopBuffer(dataHash),
        generateProof(
          spoofedWeightedSigners, [
            null,
            generateMessageSignature(defaultSignersHash, data, './bob.pem'),
          ],
        ),
      ],
    }).assertFail({ code: 4, message: 'Invalid signers' });
  });
});

test('Approve validate execute external contract', async () => {
  await deployContract();
  await deployPingPongInterchain(deployer, 1_000, contract);

  const otherUser = await world.createWallet();

  const payload = e.Tuple(e.Str('ping'), otherUser).toTopU8A();

  const payloadHash = getKeccak256Hash(Buffer.from(payload));

  const message = e.Tuple(
    e.Str(OTHER_CHAIN_NAME),
    e.Str(MESSAGE_ID),
    e.Str(OTHER_CHAIN_ADDRESS),
    pingPong,
    e.TopBuffer(payloadHash),
  );
  const messageHash = getMessageHash(OTHER_CHAIN_NAME, MESSAGE_ID, OTHER_CHAIN_ADDRESS, pingPong, payloadHash);

  const crossChainId = e.Tuple(e.Str(OTHER_CHAIN_NAME), e.Str(MESSAGE_ID));

  await deployer.callContract({
    callee: contract,
    gasLimit: 15_000_000,
    funcName: 'approveMessages',
    funcArgs: [
      e.List(message),
      generateProof(
        defaultWeightedSigners, [
          generateMessageSignature(defaultSignersHash, e.List(message)),
          generateMessageSignature(defaultSignersHash, e.List(message), './bob.pem'),
          null,
        ],
      ),
    ],
  });

  assertAccount(await contract.getAccount(), {
    balance: 0,
    kvs: [
      ...baseKvs(),

      // Message was approved
      e.kvs.Mapper('messages', crossChainId).Value(messageHash),
    ],
  });

  // Mock tokens in Ping Pong for otherUser
  await pingPong.setAccount({
    ...await pingPong.getAccount(),
    balance: 1_000,
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(contract),
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

  await deployer.callContract({
    callee: pingPong,
    funcName: 'execute',
    gasLimit: 50_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'can\'t withdraw before deadline' });

  await world.setCurrentBlockInfo({
    timestamp: 10,
  });

  await deployer.callContract({
    callee: pingPong,
    funcName: 'execute',
    gasLimit: 50_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(MESSAGE_ID),
      e.Str(OTHER_CHAIN_ADDRESS),
      payload,
    ],
  });

  assertAccount(await contract.getAccount(), {
    balance: 0,
    kvs: [
      ...baseKvs(),

      // Message was executed
      e.kvs.Mapper('messages', crossChainId).Value(e.Str('1')),
    ],
  });
  // Other user received funds
  assertAccount(await otherUser.getAccount(), {
    balance: 1_000,
  });
  // Ping pong state was modified
  assertAccount(await pingPong.getAccount(), {
    balance: 0,
    kvs: [
      e.kvs.Mapper('interchain_token_service').Value(contract),
      e.kvs.Mapper('pingAmount').Value(e.U(1_000)),
      e.kvs.Mapper('deadline').Value(e.U64(10)),
      e.kvs.Mapper('activationTimestamp').Value(e.U64(0)),
      e.kvs.Mapper('maxFunds').Value(e.Option(null)),

      // User mapper
      e.kvs.Mapper('user_address_to_id', otherUser).Value(e.U32(1)),
      e.kvs.Mapper('user_id_to_address', e.U32(1)).Value(otherUser),
      e.kvs.Mapper('user_count').Value(e.U32(1)),

      e.kvs.Mapper('userStatus', e.U32(1)).Value(e.U8(2)),
    ],
  });
});

// Signers hash used in CosmWasm to verify that the computation there is correct.
const multisigSignersHash = getSignersHash(
  [
    { signer: ALICE_PUB_KEY, weight: 1 },
    { signer: BOB_PUB_KEY, weight: 1 },
    { signer: CAROL_PUB_KEY, weight: 1 },
    { signer: 'ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b6', weight: 1 },
    { signer: 'ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a4449', weight: 1 },
  ],
  3,
  '290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563',
);

test('Approve messages with multisig prover encoded data', async () => {
  const message = e.Tuple(
    e.Str('ganache-1'),
    e.Str('0xff822c88807859ff226b58e24f24974a70f04b9442501ae38fd665b3c68f3834-0'),
    e.Str('0x52444f1835Adc02086c37Cb226561605e2E1699b'),
    e.Addr('erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax'),
    e.TopBuffer('8c3685dc41c2eca11426f8035742fb97ea9f14931152670a5703f18fe8b392f0'),
  );
  const messageHash = getMessageHash(
    'ganache-1',
    '0xff822c88807859ff226b58e24f24974a70f04b9442501ae38fd665b3c68f3834-0',
    '0x52444f1835Adc02086c37Cb226561605e2E1699b',
    e.Addr('erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax'),
    '8c3685dc41c2eca11426f8035742fb97ea9f14931152670a5703f18fe8b392f0',
  );

  // We need real signatures here
  const aliceSignature = generateMessageSignature(multisigSignersHash, e.List(message)).toString('hex');
  const bobSignature = generateMessageSignature(multisigSignersHash, e.List(message), './bob.pem').toString('hex');
  const carolSignature = generateMessageSignature(multisigSignersHash, e.List(message), './carol.pem').toString('hex');

  await deployContract();

  // Mock multisig signers in contract
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('signer_hash_by_epoch', e.U(1)).Value(e.TopBuffer(multisigSignersHash)),
      e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(multisigSignersHash)).Value(e.U(1)),
    ],
  });

  // 00000009 67616e616368652d31 - length of `ganache-1` source chain string followed by it as hex
  // 00000044 3078666638323263383838303738353966663232366235386532346632343937346137306630346239343432353031616533386664363635623363363866333833342d30 - length of message id followed by `0xff822c88807859ff226b58e24f24974a70f04b9442501ae38fd665b3c68f3834-0` string encoded as hex
  // 0000002a 307835323434346631383335416463303230383663333743623232363536313630356532453136393962 - length of source address followed by `0x52444f1835Adc02086c37Cb226561605e2E1699b` string as hex
  // 000000000000000005006fbc99e58a82ef3c082afcd2679292693049c9371090 - destination address `erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax` from bech32 to hex
  // 8c3685dc41c2eca11426f8035742fb97ea9f14931152670a5703f18fe8b392f0 - payload hash as hex
  const data = Buffer.from(
    '0000000967616e616368652d31000000443078666638323263383838303738353966663232366235386532346632343937346137306630346239343432353031616533386664363635623363363866333833342d300000002a307835323434346631383335416463303230383663333743623232363536313630356532453136393962000000000000000005006fbc99e58a82ef3c082afcd2679292693049c93710908c3685dc41c2eca11426f8035742fb97ea9f14931152670a5703f18fe8b392f0',
    'hex',
  );

  // 00000005 - length of signers
  // 0139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e1 00000001 01 - first signer with weight
  // 8049d639e5a6980d1cd2392abcce41029cda74a1563523a202f09641cc2618f8 00000001 01 - second signer with weight
  // b2a11555ce521e4944e09ab17549d85b487dcd26c84b5017a39e31a3670889ba 00000001 01 - third signer with weight
  // ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b6 00000001 01 - fourth signer with weight
  // ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a4449 00000001 01 - fifth signer with weight
  // 00000001 03 - length of biguint threshold followed by 3 as hex
  // 290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563 - the nonce (keccak256 hash of Uin256 number 0, created_at date)
  // 00000005 - length of signatures
  // 01 ${aliceSignature} - first signature encoded as a Some option
  // 01 ${bobSignature} - second signature encoded as a Some option
  // 01 ${carolSignature} - third signature encoded as a Some option
  // 00 - fourth signature encoded as a None option (the fourth signer didn't specify any signature)
  // 00 - fifth signature encoded as a None option (the fifth signer didn't specify any signature)
  const proof = Buffer.from(
    `000000050139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e100000001018049d639e5a6980d1cd2392abcce41029cda74a1563523a202f09641cc2618f80000000101b2a11555ce521e4944e09ab17549d85b487dcd26c84b5017a39e31a3670889ba0000000101ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b60000000101ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a444900000001010000000103290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e5630000000501${aliceSignature}01${bobSignature}01${carolSignature}0000`,
    'hex',
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 25_000_000,
    funcName: 'approveMessages',
    funcArgs: [
      e.Buffer(data),
      e.Buffer(proof),
    ],
  });

  const crossChainId = e.Tuple(
    e.Str('ganache-1'),
    e.Str('0xff822c88807859ff226b58e24f24974a70f04b9442501ae38fd665b3c68f3834-0'),
  );

  assertAccount(await contract.getAccount(), {
    balance: 0,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('signer_hash_by_epoch', e.U(1)).Value(e.TopBuffer(multisigSignersHash)),
      e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(multisigSignersHash)).Value(e.U(1)),

      // Message was approved
      e.kvs.Mapper('messages', crossChainId).Value(messageHash),
    ],
  });
});

test('Rotate signers with multisig prover encoded data', async () => {
  const newWeightedSigners = e.Tuple(
    e.List(
      e.Tuple(e.TopBuffer(ALICE_PUB_KEY), e.U(1)),
      e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(1)),
      e.Tuple(e.TopBuffer(CAROL_PUB_KEY), e.U(1)),
    ),
    e.U(3),
    e.TopBuffer('290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563'),
  );
  const newSignersHash = getSignersHash(
    [
      { signer: ALICE_PUB_KEY, weight: 1 },
      { signer: BOB_PUB_KEY, weight: 1 },
      { signer: CAROL_PUB_KEY, weight: 1 },
    ],
    3,
    '290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563',
  );

  // We need real signatures here
  const aliceSignature = generateRotateSignersSignature(multisigSignersHash, newWeightedSigners).toString('hex');
  const bobSignature = generateRotateSignersSignature(multisigSignersHash, newWeightedSigners, './bob.pem').toString('hex');
  const carolSignature = generateRotateSignersSignature(multisigSignersHash, newWeightedSigners, './carol.pem').toString('hex');

  await deployContract();

  // Mock multisig signers in contract
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('signer_hash_by_epoch', e.U(1)).Value(e.TopBuffer(multisigSignersHash)),
      e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(multisigSignersHash)).Value(e.U(1)),
    ],
  });

  // 00000003 - length of new signers
  // 0139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e1 - first new signer
  // 00000001 01 - length of biguint weight followed by 1 as hex
  // 8049d639e5a6980d1cd2392abcce41029cda74a1563523a202f09641cc2618f8 - second new signer
  // 00000001 01 - length of biguint weight followed by 1 as hex
  // b2a11555ce521e4944e09ab17549d85b487dcd26c84b5017a39e31a3670889ba - third new signer
  // 00000001 01 - length of biguint weight followed by 1 as hex
  // 00000001 03 - length of biguint threshold followed by 3 as hex
  // 290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563 - the nonce (mock created at number as uint256)
  const newSigners = Buffer.from(
    '000000030139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e100000001018049d639e5a6980d1cd2392abcce41029cda74a1563523a202f09641cc2618f80000000101b2a11555ce521e4944e09ab17549d85b487dcd26c84b5017a39e31a3670889ba00000001010000000103290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563',
    'hex',
  );

  // 00000005 - length of signers
  // 0139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e1 00000001 01 - first signer with weight
  // 8049d639e5a6980d1cd2392abcce41029cda74a1563523a202f09641cc2618f8 00000001 01 - second signer with weight
  // b2a11555ce521e4944e09ab17549d85b487dcd26c84b5017a39e31a3670889ba 00000001 01 - third signer with weight
  // ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b6 00000001 01 - fourth signer with weight
  // ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a4449 00000001 01 - fifth signer with weight
  // 00000001 03 - length of biguint threshold followed by 3 as hex
  // 290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563 - the nonce (mock created at number as uint256)
  // 00000005 - length of signatures
  // 01 ${aliceSignature} - first signature encoded as a Some option
  // 01 ${bobSignature} - second signature encoded as a Some option
  // 01 ${carolSignature} - third signature encoded as a Some option
  // 00 - fourth signature encoded as a None option (the fourth signer didn't specify any signature)
  // 00 - fifth signature encoded as a None option (the fifth signer didn't specify any signature)
  const proof = Buffer.from(
    `000000050139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e100000001018049d639e5a6980d1cd2392abcce41029cda74a1563523a202f09641cc2618f80000000101b2a11555ce521e4944e09ab17549d85b487dcd26c84b5017a39e31a3670889ba0000000101ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b60000000101ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a444900000001010000000103290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e5630000000501${aliceSignature}01${bobSignature}01${carolSignature}0000`,
    'hex',
  );

  await world.setCurrentBlockInfo({
    timestamp: 3600,
  });

  await deployer.callContract({
    callee: contract,
    gasLimit: 25_000_000,
    funcName: 'rotateSigners',
    funcArgs: [
      e.Buffer(newSigners),
      e.Buffer(proof),
    ],
  });

  assertAccount(await contract.getAccount(), {
    balance: 0n,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('operator').Value(firstUser),
      e.kvs.Mapper('signer_hash_by_epoch', e.U(1)).Value(e.TopBuffer(multisigSignersHash)),
      e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(multisigSignersHash)).Value(e.U(1)),
      e.kvs.Mapper('epoch').Value(e.U(2)),
      e.kvs.Mapper('last_rotation_timestamp').Value(e.U64(3600)),

      e.kvs.Mapper('signer_hash_by_epoch', e.U(2)).Value(e.TopBuffer(newSignersHash)),
      e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(newSignersHash)).Value(e.U(2)),
    ],
  });
});
