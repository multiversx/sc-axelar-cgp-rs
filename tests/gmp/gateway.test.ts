import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import { assertAccount, e, SContract, SWallet, SWorld } from 'xsuite';
import {
  ADDRESS_ZERO,
  ALICE_PUB_KEY,
  BOB_PUB_KEY,
  CAROL_PUB_KEY,
  DOMAIN_SEPARATOR,
  generateMessageSignature,
  generateProof,
  generateProofOld,
  generateRotateSignersSignature,
  generateSignature,
  getKeccak256Hash,
  getSignersHash, MESSAGE_ID,
  MULTISIG_PROVER_PUB_KEY_1,
  MULTISIG_PROVER_PUB_KEY_2, OTHER_CHAIN_ADDRESS, OTHER_CHAIN_NAME,
  PAYLOAD_HASH,
  SIGNATURE_ZERO,
  TOKEN_ID,
  TOKEN_ID2,
} from '../helpers';
import createKeccakHash from 'keccak';
import { deployPingPongInterchain, gateway, its, mockGatewayMessageApproved, pingPong } from '../itsHelpers';
import { Buffer } from 'buffer';

let world: SWorld;
let deployer: SWallet;
let firstUser: SWallet;
let contract: SContract;
let address: string;

beforeEach(async () => {
  world = await SWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  });

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

  assertAccount(await contract.getAccountWithKvs(), {
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

  assertAccount(await contract.getAccountWithKvs(), {
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

  assertAccount(await contract.getAccountWithKvs(), {
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

  assertAccount(await contract.getAccountWithKvs(), {
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

    const commandId = getKeccak256Hash('ethereum_messageId');

    // Mock message approved
    await contract.setAccount({
      ...await contract.getAccount(),
      codeMetadata: ['payable'],
      kvs: [
        ...baseKvs(),

        // Manually approve message
        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.TopBuffer(messageHash)),
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
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0,
      kvs: [
        ...baseKvs(),

        // Message was executed
        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.TopBuffer(messageHash)),
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

    const commandId = getKeccak256Hash('ethereum_messageId');

    // Mock message executed
    await contract.setAccount({
      ...await contract.getAccount(),
      codeMetadata: ['payable'],
      kvs: [
        ...baseKvs(),

        // Manually execute message
        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.Str('1')),
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
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0,
      kvs: [
        ...baseKvs(),

        // Message was executed
        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.Str('1')),
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
    const messageData = Buffer.concat([
      Buffer.from('ethereum'),
      Buffer.from('messageId'),
      Buffer.from('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      deployer.toTopU8A(),
      Buffer.from(PAYLOAD_HASH, 'hex'),
    ]);
    const messageHash = getKeccak256Hash(messageData);

    const commandId = getKeccak256Hash('ethereum_messageId');

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

    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0,
      kvs: [
        ...baseKvs(),

        // Message was executed
        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.TopBuffer(messageHash)),
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

    assertAccount(await contract.getAccountWithKvs(), {
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

    assertAccount(await contract.getAccountWithKvs(), {
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
  assertAccount(await contract.getAccountWithKvs(), {
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

    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0,
      kvs: baseKvs(),
    });
  });

  test('Validate message valid', async () => {
    await deployContract();

    const messageData = Buffer.concat([
      Buffer.from('ethereum'),
      Buffer.from('messageId'),
      Buffer.from('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      deployer.toTopU8A(),
      Buffer.from(PAYLOAD_HASH, 'hex'),
    ]);
    const messageHash = getKeccak256Hash(messageData);

    const commandId = getKeccak256Hash('ethereum_messageId');

    await contract.setAccount({
      ...await contract.getAccount(),
      codeMetadata: ['payable'],
      kvs: [
        ...baseKvs(),

        // Manually approve message
        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.TopBuffer(messageHash)),
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

    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0,
      kvs: [
        ...baseKvs(),

        // Message was executed
        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.Str('1')),
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

    assertAccount(await contract.getAccountWithKvs(), {
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

    assertAccount(await contract.getAccountWithKvs(), {
      kvs: baseKvs(),
    });
  });
});

describe('View functions', () => {
  const commandId = getKeccak256Hash('ethereum_messageId');

  test('Message approved', async () => {
    await deployContract();

    const messageData = Buffer.concat([
      Buffer.from('ethereum'),
      Buffer.from('messageId'),
      Buffer.from('0x4976da71bF84D750b5451B053051158EC0A4E876'),
      deployer.toTopU8A(),
      Buffer.from(PAYLOAD_HASH, 'hex'),
    ]);
    const messageHash = getKeccak256Hash(messageData);

    // Mock message approved
    await contract.setAccount({
      ...await contract.getAccount(),
      codeMetadata: ['payable'],
      kvs: [
        ...baseKvs(),

        // Manually approve message
        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.TopBuffer(messageHash)),
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
        e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.Str('1')),
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
  const messageData = Buffer.concat([
    Buffer.from(OTHER_CHAIN_NAME),
    Buffer.from(MESSAGE_ID),
    Buffer.from(OTHER_CHAIN_ADDRESS),
    pingPong.toTopU8A(),
    Buffer.from(payloadHash, 'hex'),
  ]);
  const messageHash = getKeccak256Hash(messageData);

  const commandId = getKeccak256Hash(OTHER_CHAIN_NAME + '_' + MESSAGE_ID);

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

  assertAccount(await contract.getAccountWithKvs(), {
    balance: 0,
    kvs: [
      ...baseKvs(),

      // Message was approved
      e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.TopBuffer(messageHash)),
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
  }).assertFail({ code: 4, message: "can't withdraw before deadline" });

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

  assertAccount(await contract.getAccountWithKvs(), {
    balance: 0,
    kvs: [
      ...baseKvs(),

      // Message was executed
      e.kvs.Mapper('messages', e.TopBuffer(commandId)).Value(e.Str("1")),
    ],
  });
  // Other user received funds
  assertAccount(await otherUser.getAccountWithKvs(), {
    balance: 1_000,
  });
  // Ping pong state was modified
  assertAccount(await pingPong.getAccountWithKvs(), {
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

// TODO: Re-enable below tests after updating Amplifier Multisig Prover
test.skip('Execute approve contract call with multisig prover encoded data', async () => {
  await deployContract();

  // 00000001 - length of text
  // 44 - 'D' as hex
  // 00000001 - length of command ids
  // ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff - command id
  // 00000001 - length of commands
  // 00000013 - length of text
  // 617070726f7665436f6e747261637443616c6c - 'approveContractCall' as hex
  // 00000001 - length of params
  // 00000052 - length of param
  // 00000008457468657265756d00000002303000000000000000000500be4eba4b2eccbcf1703bbd6b2e0d1351430e769f54830202020202020202020202020202020202020202020202020202020202020202 - params
  const data = Buffer.from(
    '000000014400000001ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000100000013617070726f7665436f6e747261637443616c6c000000010000005200000008457468657265756d00000002303000000000000000000500be4eba4b2eccbcf1703bbd6b2e0d1351430e769f54830202020202020202020202020202020202020202020202020202020202020202',
    'hex',
  );

  const proof = generateProofOld(data);

  await deployer.callContract({
    callee: contract,
    gasLimit: 25_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(e.Buffer(data), e.Buffer(proof.toTopBytes())),
    ],
  });

  const commandId = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const payloadHash = '0202020202020202020202020202020202020202020202020202020202020202';

  // get_is_contract_call_approved_key hash
  let approvedData = Buffer.concat([
    Buffer.from(commandId, 'hex'),
    Buffer.from('Ethereum'),
    Buffer.from('00'),
    e.Addr('erd1qqqqqqqqqqqqqpgqhe8t5jewej70zupmh44jurgn29psua5l2jps3ntjj3').toTopBytes(),
    Buffer.from(payloadHash, 'hex'),
  ]);

  const approvedDataHash = createKeccakHash('keccak256').update(approvedData).digest('hex');

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    hasKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(addressAuth)),
      e.kvs.Mapper('chain_id').Value(e.Str(DOMAIN_SEPARATOR)),

      e.kvs.Mapper('command_executed', e.TopBuffer(commandId)).Value(e.U8(1)),

      e.kvs.Mapper('contract_call_approved', e.TopBuffer(approvedDataHash)).Value(e.U8(1)),
    ],
  });
});

test.skip('Execute transfer operatorship with multisig prover encoded data', async () => {
  await deployContract();

  // 00000001 - length of text
  // 44 - 'D' as hex
  // 00000001 - length of command ids
  // ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff - command id
  // 00000001 - length of commands
  // 00000014 - length of text
  // 7472616e736665724f70657261746f7273686970 - 'approveContractCall' as hex
  // 00000001 - length of params
  // 00000057 - length of param
  // 00000002ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b6ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a444900000002000000010a000000010a0000000114 - params
  const data = Buffer.from(
    '000000014400000001ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000001000000147472616e736665724f70657261746f7273686970000000010000005700000002ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b6ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a444900000002000000010a000000010a0000000114',
    'hex',
  );

  const signature = generateSignature(data);
  const signatureBob = generateSignature(data, './bob.pem');

  const proof = e.Tuple(
    e.List(e.TopBuffer(ALICE_PUB_KEY), e.TopBuffer(BOB_PUB_KEY)),
    e.List(e.U(10), e.U(2)),
    e.U(12),
    e.List(e.TopBuffer(signature), e.TopBuffer(signatureBob)),
  );

  await deployer.callContract({
    callee: contract,
    gasLimit: 25_000_000,
    funcName: 'execute',
    funcArgs: [
      e.Tuple(e.Buffer(data), e.Buffer(proof.toTopBytes())),
    ],
  });

  const commandId = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    kvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(addressAuth)),
      e.kvs.Mapper('chain_id').Value(e.Str(DOMAIN_SEPARATOR)),

      e.kvs.Mapper('command_executed', e.TopBuffer(commandId)).Value(e.U8(1)),
    ],
  });

  const operatorsHash = getSignersHash([ALICE_PUB_KEY], [10], 10);
  const operatorsHash2 = getSignersHash([ALICE_PUB_KEY, BOB_PUB_KEY], [10, 2], 12);
  const operatorsHash3 = getSignersHash([MULTISIG_PROVER_PUB_KEY_1, MULTISIG_PROVER_PUB_KEY_2], [10, 10], 20);

  // Check that Auth contract was updated
  kvs = await contractAuth.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0,
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash2)).Value(e.U64(16)),
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash3)).Value(e.U64(17)),

      e.kvs.Mapper('hash_for_epoch', e.U64(17)).Value(e.TopBuffer(operatorsHash3)),

      e.kvs.Mapper('current_epoch').Value(e.U64(17)),
    ],
  });
});

test.skip('Validate proof with multisig prover encoded proof', async () => {
  await deployContract();

  const operatorsHash = getSignersHash([MULTISIG_PROVER_PUB_KEY_1, MULTISIG_PROVER_PUB_KEY_2], [10, 10], 10);
  await contract.setAccount({
    ...await contract.getAccount(),
    kvs: [
      // Manually add epoch for hash & current epoch
      e.kvs.Mapper('epoch_for_hash', e.TopBuffer(operatorsHash)).Value(e.U64(1)),

      e.kvs.Mapper('current_epoch').Value(e.U64(16)),
    ],
  });

  // 00000002 - length of operators
  // ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b6 - first operator public key
  // ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a4449 - second operator public key
  // 00000002 - length of weigths
  // 00000001 0a - length of biguint weight followed by 10 as hex
  // 00000001 0a
  // 00000001 0a - length of biguint threshold followed by 10 as hex
  // 00000002 - length of signatures
  // fdae22df86f53a39985674072ed1442d08a66683e464134b8d17e373a07e8b82137b96087fa7bbbd2764c4e7658564c32480b2bb31ba70c1225350724494e507 - first signature
  // b054d00827810f8384b85c88352dabf81dcc9be76a77617df942e8bd65ca15fadaef5941a0022f29d86fa5bd33c7fc593580930e521e337544716b5901f8810f - second signature
  const data = Buffer.from(
    '00000002ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b6ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a444900000002000000010a000000010a000000010a00000002fdae22df86f53a39985674072ed1442d08a66683e464134b8d17e373a07e8b82137b96087fa7bbbd2764c4e7658564c32480b2bb31ba70c1225350724494e507b054d00827810f8384b85c88352dabf81dcc9be76a77617df942e8bd65ca15fadaef5941a0022f29d86fa5bd33c7fc593580930e521e337544716b5901f8810f',
    'hex',
  );

  const messageHash = Buffer.from('84219fac907aad564fe5f1af58993d1c3f8f288af30b8bff5b50ffb5bba96bc0', 'hex');

  // Signature is invalid because we use mock public keys, but we test if decoding of the raw data works properly
  await deployer.callContract({
    callee: contract,
    gasLimit: 10_000_000,
    funcName: 'validateProof',
    funcArgs: [
      e.TopBuffer(messageHash),
      e.TopBuffer(data),
    ],
  }).assertFail({ code: 10, message: 'invalid signature' });
});
