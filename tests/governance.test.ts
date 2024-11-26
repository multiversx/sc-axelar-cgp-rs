import { afterEach, assert, beforeEach, describe, test } from 'vitest';
import { assertAccount, d, e, Encodable, SContract, SWallet, SWorld } from 'xsuite';
import { ADDRESS_ZERO, getKeccak256Hash, getMessageHash, MESSAGE_ID, PAYLOAD_HASH, TOKEN_ID } from './helpers';
import createKeccakHash from 'keccak';
import fs from 'fs';
import { baseGatewayKvs, deployGatewayContract, gateway } from './itsHelpers';
import { Buffer } from 'buffer';

const GOVERNANCE_CHAIN = 'Axelar';
const GOVERNANCE_ADDRESS = 'axelar1u5jhn5876mjzmgw7j37mdvqh4qp5y6z2gc6rc3';

let world: SWorld;
let deployer: SWallet;
let contract: SContract;
let address: string;

beforeEach(async () => {
  world = await SWorld.start();
  await world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  });

  deployer = await world.createWallet({
    balance: 10_000_000_000n,
    kvs: [
      e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000, nonce: 1 }]),
    ],
  });
});

afterEach(async () => {
  await world.terminate();
});

const baseKvs = () => {
  return [
    e.kvs.Mapper('gateway').Value(gateway),
    e.kvs.Mapper('minimum_time_lock_delay').Value(e.U64(10)),
    e.kvs.Mapper('governance_chain').Value(e.Str(GOVERNANCE_CHAIN)),
    e.kvs.Mapper('governance_address').Value(e.Str(GOVERNANCE_ADDRESS)),
    e.kvs.Mapper('multisig').Value(deployer),
  ];
};

const deployContract = async () => {
  await deployGatewayContract(deployer);

  ({ contract, address } = await deployer.deployContract({
    code: 'file:governance/output/governance.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      e.U64(10),
      deployer,
    ],
  }));

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: baseKvs(),
  });

  // Change owner of gateway to governance contract so it can upgrade
  await gateway.setAccount({
    ...await gateway.getAccountWithKvs(),
    owner: contract,
  });
};

const mockCallApprovedByGateway = async (payload: Encodable) => {
  const payloadHash = getKeccak256Hash(Buffer.from(payload.toTopU8A()));

  const messageHash = getMessageHash(GOVERNANCE_CHAIN, MESSAGE_ID, GOVERNANCE_ADDRESS, contract, payloadHash);

  const crossChainId = e.Tuple(e.Str(GOVERNANCE_CHAIN), e.Str(MESSAGE_ID));

  // Mock call approved by gateway
  await gateway.setAccount({
    ...await gateway.getAccount(),
    codeMetadata: ['payable'],
    kvs: [
      ...baseGatewayKvs(deployer),

      // Manually approve message
      e.kvs.Mapper('messages', crossChainId).Value(messageHash),
    ],
  });
};

const getProposalHash = (
  target: Encodable,
  callDataTopBuffer: Encodable,
  nativeValue: Encodable,
): Encodable => {
  const hashData = Buffer.concat([
    target.toTopU8A(),
    e.Buffer(callDataTopBuffer.toTopU8A()).toNestU8A(),
    nativeValue.toNestU8A(),
  ]);

  return e.TopBuffer(getKeccak256Hash(hashData));
};

test('Init errors', async () => {
  await deployGatewayContract(deployer);

  await deployer.deployContract({
    code: 'file:governance/output/governance.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(ADDRESS_ZERO),
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      e.U64(10),
      e.Addr(ADDRESS_ZERO),
    ],
  }).assertFail({ code: 4, message: 'Invalid address' });

  await deployer.deployContract({
    code: 'file:governance/output/governance.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      e.Str(''),
      e.Str(GOVERNANCE_ADDRESS),
      e.U64(10),
      e.Addr(ADDRESS_ZERO),
    ],
  }).assertFail({ code: 4, message: 'Invalid address' });

  await deployer.deployContract({
    code: 'file:governance/output/governance.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      e.Str(GOVERNANCE_CHAIN),
      e.Str(''),
      e.U64(10),
      e.Addr(ADDRESS_ZERO),
    ],
  }).assertFail({ code: 4, message: 'Invalid address' });

  await deployer.deployContract({
    code: 'file:governance/output/governance.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      e.Str(GOVERNANCE_CHAIN),
      e.Str(GOVERNANCE_ADDRESS),
      e.U64(10),
      e.Addr(ADDRESS_ZERO),
    ],
  }).assertFail({ code: 4, message: 'Invalid address' });
});

describe('Execute proposal', () => {
  test('Errors', async () => {
    await deployContract();

    const wrongCallData = e.TopBuffer(e.Tuple(
      e.Str('endpoint'),
    ).toTopU8A());

    await deployer.callContract({
      callee: contract,
      gasLimit: 100_000_000,
      funcName: 'executeProposal',
      funcArgs: [
        gateway,
        wrongCallData,
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Invalid time lock hash' });

    const proposalHash = getProposalHash(
      gateway,
      wrongCallData,
      e.U(0),
    );

    // Mock hash
    await contract.setAccount({
      ...await contract.getAccountWithKvs(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
      ],
    });

    await deployer.callContract({
      callee: contract,
      gasLimit: 100_000_000,
      funcName: 'executeProposal',
      funcArgs: [
        gateway,
        wrongCallData,
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Time lock not ready' });

    // Increase timestamp so finalize_time_lock passes
    await world.setCurrentBlockInfo({ timestamp: 1 });

    await deployer.callContract({
      callee: contract,
      gasLimit: 100_000_000,
      funcName: 'executeProposal',
      funcArgs: [
        gateway,
        wrongCallData,
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Could not decode call data' });
  });

  test('Execute proposal esdt', async () => {
    await deployContract();

    const user = await world.createWallet();

    const callData = e.TopBuffer(e.Tuple(
      e.Str('MultiESDTNFTTransfer'),
      e.List(
        e.Buffer(user.toTopU8A()),
        e.Buffer(e.U32(1).toTopU8A()),
        e.Str(TOKEN_ID),
        e.Buffer(e.U64(1).toTopU8A()),
        e.Buffer(e.U(1_000).toTopU8A()),
      ), // arguments to MultiESDTNFTTransfer function
      e.U64(10_000_000), // min gas limit
    ).toTopU8A());

    const proposalHash = getProposalHash(contract, callData, e.U(0));

    // Mock hash
    await contract.setAccount({
      ...await contract.getAccountWithKvs(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
      ],
    });
    // Increase timestamp so finalize_time_lock passes
    await world.setCurrentBlockInfo({ timestamp: 1 });

    // Async call actually fails
    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'executeProposal',
      funcArgs: [
        contract,
        callData,
        e.U(0),
      ],
    });

    // Time lock eta was NOT deleted
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0n,
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
      ],
    });

    // Assert deployer still has the tokens
    assertAccount(await deployer.getAccountWithKvs(), {
      kvs: [
        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000, nonce: 1 }]),
      ],
    });

    // Deployer needs to send correct tokens
    await deployer.callContract({
      callee: contract,
      gasLimit: 200_000_000,
      funcName: 'executeProposal',
      funcArgs: [
        contract,
        callData,
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000, nonce: 1 }],
    });

    // Time lock eta was deleted
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0n,
      kvs: baseKvs(),
    });

    // Assert user received tokens
    assertAccount(await user.getAccountWithKvs(), {
      kvs: [
        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000, nonce: 1 }]),
      ],
    });
  });

  test('Upgrade gateway', async () => {
    await deployContract();

    const gatewayCode = fs.readFileSync('gateway/output/gateway.wasm');

    const newOperator = await world.createWallet();

    const callData = e.TopBuffer(e.Tuple(
      e.Str('upgradeContract'),
      e.List(
        e.Buffer(gatewayCode), // code
        e.Buffer('0100'), // upgrade metadata (upgradable)
        e.Buffer(newOperator.toTopU8A()), // Arguments to upgrade function fo Gateway
      ),
      e.U64(20_000_000), // min gas limit
    ).toTopU8A());

    const proposalHash = getProposalHash(
      gateway,
      callData,
      e.U(0),
    );

    // Mock hash
    await contract.setAccount({
      ...await contract.getAccountWithKvs(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
      ],
    });
    // Increase timestamp so finalize_time_lock passes
    await world.setCurrentBlockInfo({ timestamp: 1 });

    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'executeProposal',
      funcArgs: [
        gateway,
        callData,
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Insufficient gas for execution' });

    await deployer.callContract({
      callee: contract,
      gasLimit: 200_000_000,
      funcName: 'executeProposal',
      funcArgs: [
        gateway,
        callData,
        e.U(0),
      ],
    });

    // Time lock eta was deleted
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0n,
      kvs: baseKvs(),
    });

    // Assert Gateway was successfully upgraded (operator was changed)
    assertAccount(await gateway.getAccountWithKvs(), {
      kvs: baseGatewayKvs(newOperator),
    });
  });

  test('Upgrade gateway error', async () => {
    await deployContract();

    const gatewayCode = fs.readFileSync('gateway/output/gateway.wasm');

    const callData = e.TopBuffer(e.Tuple(
      e.Str('upgradeContract'),
      e.List(
        e.Buffer(gatewayCode), // code
        e.Buffer('0100'), // upgrade metadata (upgradable)
        e.Str('wrongArgs'),
      ),
      e.U64(1_000_000), // min gas limit
    ).toTopU8A());

    const proposalHash = getProposalHash(gateway, callData, e.U(1_000));

    // Mock hash
    await contract.setAccount({
      ...await contract.getAccountWithKvs(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
      ],
    });
    // Increase timestamp so finalize_time_lock passes
    await world.setCurrentBlockInfo({ timestamp: 1 });

    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'executeProposal',
      value: 1_000, // also send egld
      funcArgs: [
        gateway,
        callData,
        e.U(1_000),
      ],
    }); // async call actually fails

    // Time lock eta was NOT deleted and refund token was created
    let kvs = await contract.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 1_000, // EGLD still in contract
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
        e.kvs.Mapper('refund_token', deployer, e.Tuple(e.Str('EGLD'), e.U64(0))).Value(e.U(1_000)),
      ],
    });

    // Deployer can withdraw his funds in case of failure
    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'withdrawRefundToken',
      funcArgs: [
        e.Tuple(e.Str('EGLD'), e.U64(0)),
      ],
    });

    assertAccount(await deployer.getAccountWithKvs(), {
      balance: 10_000_000_000n, // got egld back
    });
  });

  test('Execute proposal upgrade gateway esdt error', async () => {
    await deployContract();

    const gatewayCode = fs.readFileSync('gateway/output/gateway.wasm');

    const callData = e.TopBuffer(e.Tuple(
      e.Str('upgradeContract'),
      e.List(
        e.Buffer(gatewayCode), // code
        e.Buffer('0100'), // upgrade metadata (upgradable)
        e.Str('wrongArgs'),
      ),
      e.U64(1_000_000), // min gas limit
    ).toTopU8A());

    const proposalHash = getProposalHash(
      gateway,
      callData,
      e.U(0),
    );

    // Mock hash
    await contract.setAccount({
      ...await contract.getAccountWithKvs(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
      ],
    });
    // Increase timestamp so finalize_time_lock passes
    await world.setCurrentBlockInfo({ timestamp: 1 });

    await deployer.callContract({
      callee: contract,
      gasLimit: 47_000_000,
      funcName: 'executeProposal',
      funcArgs: [
        gateway,
        callData,
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 1_000, nonce: 1 }],
    }).assertFail({ code: 4, message: 'Insufficient gas for execution' });
    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'executeProposal',
      funcArgs: [
        gateway,
        callData,
        e.U(0),
      ], esdts: [{ id: TOKEN_ID, amount: 500, nonce: 1 }],
    }); // async call actually fails

    // Time lock eta was NOT deleted and refund token was created
    let kvs = await contract.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
        e.kvs.Mapper('refund_token', deployer, e.Tuple(e.Str(TOKEN_ID), e.U64(1))).Value(e.U(500)),

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 500, nonce: 1 }]), // esdt still in contract
      ],
    });

    // Try to execute again
    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'executeProposal',
      funcArgs: [
        gateway,
        callData,
        e.U(0),
      ],
      esdts: [{ id: TOKEN_ID, amount: 500, nonce: 1 }],
    }); // async call actually fails

    // Amount was added to refund token
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0n,
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
        e.kvs.Mapper('refund_token', deployer, e.Tuple(e.Str(TOKEN_ID), e.U64(1))).Value(e.U(1_000)),

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000, nonce: 1 }]),
      ],
    });

    // Deployer can withdraw his funds in case of failure
    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'withdrawRefundToken',
      funcArgs: [
        e.Tuple(e.Str(TOKEN_ID), e.U64(1)),
      ],
    });

    assertAccount(await deployer.getAccountWithKvs(), {
      balance: 10_000_000_000n,
      kvs: [
        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000, nonce: 1 }]), // got esdt back
      ],
    });
  });

  test('Withdraw refund token', async () => {
    await deployContract();

    // Will do nothing
    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'withdrawRefundToken',
      funcArgs: [
        e.Tuple(e.Str(TOKEN_ID), e.U64(1)),
      ],
    });

    // Nothing has changed
    assertAccount(await deployer.getAccountWithKvs(), {
      balance: 10_000_000_000n,
    });
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0n,
      kvs: baseKvs(),
    });

    // Mock refund tokens
    await contract.setAccount({
      ...(await contract.getAccountWithKvs()),
      balance: 1_000n,
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('refund_token', deployer, e.Tuple(e.Str(TOKEN_ID), e.U64(1))).Value(e.U(1_000)),
        e.kvs.Mapper('refund_token', deployer, e.Tuple(e.Str('EGLD'), e.U64(0))).Value(e.U(1_000)),

        e.kvs.Esdts([{ id: TOKEN_ID, amount: 1_000, nonce: 1 }]),
      ],
    });

    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'withdrawRefundToken',
      funcArgs: [
        e.Tuple(e.Str(TOKEN_ID), e.U64(1)),
      ],
    });

    assertAccount(await deployer.getAccountWithKvs(), {
      balance: 10_000_000_000n,
      kvs: [
        e.kvs.Esdts([{ id: TOKEN_ID, amount: 2_000, nonce: 1 }]), // got esdt back
      ],
    });
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 1_000n,
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('refund_token', deployer, e.Tuple(e.Str('EGLD'), e.U64(0))).Value(e.U(1_000)),
      ],
    });

    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'withdrawRefundToken',
      funcArgs: [
        e.Tuple(e.Str('EGLD'), e.U64(0))],
    });

    assertAccount(await deployer.getAccountWithKvs(), {
      balance: 10_000_001_000n, // got egld back
      kvs: [
        e.kvs.Esdts([{ id: TOKEN_ID, amount: 2_000, nonce: 1 }]),
      ],
    });
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0,
      kvs: baseKvs(),
    });
  });
});

describe('Execute multisig proposal', () => {
  test('Errors', async () => {
    await deployContract();

    const wrongCallData = e.TopBuffer(e.Tuple(
      e.Str('endpoint'),
    ).toTopU8A());

    const user = await world.createWallet();

    await user.callContract({
      callee: contract,
      gasLimit: 100_000_000,
      funcName: 'executeMultisigProposal',
      funcArgs: [
        gateway,
        wrongCallData,
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Not authorized' });

    await deployer.callContract({
      callee: contract,
      gasLimit: 100_000_000,
      funcName: 'executeMultisigProposal',
      funcArgs: [
        gateway,
        wrongCallData,
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Not approved' });

    const proposalHash = getProposalHash(
      gateway,
      wrongCallData,
      e.U(0),
    );

    // Mock hash
    await contract.setAccount({
      ...await contract.getAccountWithKvs(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('multisig_approvals', proposalHash).Value(e.Bool(true)),
      ],
    });

    await deployer.callContract({
      callee: contract,
      gasLimit: 100_000_000,
      funcName: 'executeMultisigProposal',
      funcArgs: [
        gateway,
        wrongCallData,
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Could not decode call data' });
  });

  test('Upgrade gateway', async () => {
    await deployContract();

    const gatewayCode = fs.readFileSync('gateway/output/gateway.wasm');

    const newOperator = await world.createWallet();

    const callData = e.TopBuffer(e.Tuple(
      e.Str('upgradeContract'),
      e.List(
        e.Buffer(gatewayCode), // code
        e.Buffer('0100'), // upgrade metadata (upgradable)
        e.Buffer(newOperator.toTopU8A()), // Arguments to upgrade function fo Gateway
      ),
      e.U64(0),
    ).toTopU8A());

    const proposalHash = getProposalHash(gateway, callData, e.U(0));

    // Mock hash
    await contract.setAccount({
      ...await contract.getAccountWithKvs(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('multisig_approvals', proposalHash).Value(e.Bool(true)),
      ],
    });

    await deployer.callContract({
      callee: contract,
      gasLimit: 30_000_000,
      funcName: 'executeMultisigProposal',
      funcArgs: [
        gateway,
        callData,
        e.U(0),
      ],
    }).assertFail({ code: 4, message: 'Not enough gas left for async call' });

    await deployer.callContract({
      callee: contract,
      gasLimit: 200_000_000,
      funcName: 'executeMultisigProposal',
      funcArgs: [
        gateway,
        callData,
        e.U(0),
      ],
    });

    // Multisig approval was deleted
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0n,
      kvs: baseKvs(),
    });

    // Assert Gateway was successfully upgraded (operator was changed)
    assertAccount(await gateway.getAccountWithKvs(), {
      kvs: baseGatewayKvs(newOperator),
    });
  });

  test('Upgrade gateway error', async () => {
    await deployContract();

    const gatewayCode = fs.readFileSync('gateway/output/gateway.wasm');

    const callData = e.TopBuffer(e.Tuple(
      e.Str('upgradeContract'),
      e.List(
        e.Buffer(gatewayCode), // code
        e.Buffer('0100'), // upgrade metadata (upgradable)
        e.Str('wrongArgs'),
      ),
      e.U64(0),
    ).toTopU8A());

    const proposalHash = getProposalHash(gateway, callData, e.U(0));

    // Mock hash
    await contract.setAccount({
      ...await contract.getAccountWithKvs(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('multisig_approvals', proposalHash).Value(e.Bool(true)),
      ],
    });

    await deployer.callContract({
      callee: contract,
      gasLimit: 50_000_000,
      funcName: 'executeMultisigProposal',
      funcArgs: [
        gateway,
        callData,
        e.U(0),
      ],
    }); // async call actually fails

    // Multisig approval was NOT deleted
    let kvs = await contract.getAccountWithKvs();
    assertAccount(kvs, {
      balance: 0n,
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('multisig_approvals', proposalHash).Value(e.Bool(true)),
      ],
    });
  });

  test('Transfer multisig', async () => {
    await deployContract();

    const newMultisig = await world.createWallet();

    const callData = e.TopBuffer(e.Tuple(
      e.Str('transferMultisig'),
      e.List(
        e.Buffer(newMultisig.toTopU8A()), // Arguments to transferMultisig function
      ),
      e.U64(0),
    ).toTopU8A());

    const proposalHash = getProposalHash(contract, callData, e.U(0));

    // Mock hash
    await contract.setAccount({
      ...await contract.getAccountWithKvs(),
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('multisig_approvals', proposalHash).Value(e.Bool(true)),
      ],
    });

    await deployer.callContract({
      callee: contract,
      gasLimit: 200_000_000,
      funcName: 'executeMultisigProposal',
      funcArgs: [
        contract,
        callData,
        e.U(0),
      ],
    });

    // Multisig approval was deleted and multisig was changed
    assertAccount(await contract.getAccountWithKvs(), {
      balance: 0n,
      kvs: [
        ...baseKvs(),

        e.kvs.Mapper('multisig').Value(newMultisig),
      ],
    });
  });
});

test('Withdraw', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    funcName: 'withdraw',
    gasLimit: 10_000_000,
    funcArgs: [
      deployer,
      e.U(100),
    ],
  }).assertFail({ code: 4, message: 'Not self' });

  // Need to call withdraw through executeProposal
  const callData = e.TopBuffer(e.Tuple(
    e.Str('withdraw'),
    e.List(
      e.Buffer(deployer.toNestBytes()),
      e.U(100),
    ),
    e.U64(1_000_000), // min gas limit
  ).toTopU8A());

  const proposalHash = getProposalHash(contract, callData, e.U(0));

  // Mock hash & balance
  await contract.setAccount({
    ...await contract.getAccountWithKvs(),
    balance: 100,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
    ],
  });
  // Increase timestamp so finalize_time_lock passes
  await world.setCurrentBlockInfo({ timestamp: 1 });

  await deployer.callContract({
    callee: contract,
    gasLimit: 50_000_000,
    funcName: 'executeProposal',
    funcArgs: [
      contract,
      callData,
      e.U(0),
    ],
  });

  // Time lock eta was deleted and amount was sent to deployer
  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [
      ...baseKvs(),
    ],
  });

  kvs = await deployer.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 10_000_000_100n,
  });
});

test('Transfer multisig', async () => {
  await deployContract();

  const user = await world.createWallet();

  await user.callContract({
    callee: contract,
    funcName: 'transferMultisig',
    gasLimit: 10_000_000,
    funcArgs: [
      user,
    ],
  }).assertFail({ code: 4, message: 'Not authorized' });

  await deployer.callContract({
    callee: contract,
    funcName: 'transferMultisig',
    gasLimit: 10_000_000,
    funcArgs: [
      user,
    ],
  });

  // Multisig was changed
  assertAccount(await contract.getAccountWithKvs(), {
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('multisig').Value(user),
    ],
  });

  // Need to call transferMultisig through executeProposal
  const callData = e.TopBuffer(e.Tuple(
    e.Str('transferMultisig'),
    e.List(
      e.Buffer(deployer.toNestU8A()),
    ),
    e.U64(0),
  ).toTopU8A());

  const proposalHash = getProposalHash(
    contract,
    callData,
    e.U(0),
  );

  // Mock hash
  await contract.setAccount({
    ...await contract.getAccountWithKvs(),
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(1)),
    ],
  });
  // Increase timestamp so finalize_time_lock passes
  await world.setCurrentBlockInfo({ timestamp: 1 });

  await deployer.callContract({
    callee: contract,
    gasLimit: 50_000_000,
    funcName: 'executeProposal',
    funcArgs: [
      contract,
      callData,
      e.U(0),
    ],
  });

  // Time lock eta was deleted and multisig was set back to deployer
  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    kvs: [
      ...baseKvs(),
    ],
  });
});

test('Execute errors', async () => {
  await deployContract();

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str('otherChain'),
      e.Str(MESSAGE_ID),
      e.Str(GOVERNANCE_ADDRESS),
      e.TopBuffer(''),
    ],
  }).assertFail({ code: 4, message: 'Not governance' });

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(GOVERNANCE_CHAIN),
      e.Str(MESSAGE_ID),
      e.Str('otherAddress'),
      e.TopBuffer(''),
    ],
  }).assertFail({ code: 4, message: 'Not governance' });

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(GOVERNANCE_CHAIN),
      e.Str(MESSAGE_ID),
      e.Str(GOVERNANCE_ADDRESS),
      e.TopBuffer(''),
    ],
  }).assertFail({ code: 4, message: 'Not approved by gateway' });

  let payload = e.TopBuffer('');
  await mockCallApprovedByGateway(payload);

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(GOVERNANCE_CHAIN),
      e.Str(MESSAGE_ID),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Could not decode execute payload' });

  payload = e.TopBuffer(e.Tuple(
    e.U8(0),
    e.Addr(ADDRESS_ZERO),
    e.Buffer(''),
    e.U(0),
    e.U64(0),
  ).toTopU8A());
  await mockCallApprovedByGateway(payload);

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 10_000_000,
    funcArgs: [
      e.Str(GOVERNANCE_CHAIN),
      e.Str(MESSAGE_ID),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Invalid target' });
});

test('Execute schedule time lock proposal min eta', async () => {
  await deployContract();

  const callData = e.Buffer('');
  const payload = e.TopBuffer(e.Tuple(
    e.U8(0),
    gateway,
    callData,
    e.U(0),
    e.U64(1), // will use min eta instead
  ).toTopU8A());
  await mockCallApprovedByGateway(payload);

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(GOVERNANCE_CHAIN),
      e.Str(MESSAGE_ID),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  });

  const proposalHash = getProposalHash(gateway, callData, e.U(0));

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(10)),
    ],
  });
});

test('Execute schedule time lock proposal eta', async () => {
  await deployContract();

  const callData = e.Buffer('');
  const payload = e.TopBuffer(e.Tuple(
    e.U8(0),
    gateway,
    callData,
    e.U(0),
    e.U64(11),
  ).toTopU8A());
  await mockCallApprovedByGateway(payload);

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(GOVERNANCE_CHAIN),
      e.Str(MESSAGE_ID),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  });

  const proposalHash = getProposalHash(gateway, callData, e.U(0));

  let kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(11)),
    ],
  });

  await mockCallApprovedByGateway(payload);
  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(GOVERNANCE_CHAIN),
      e.Str(MESSAGE_ID),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  }).assertFail({ code: 4, message: 'Time lock already scheduled' });

  const result = await world.query({
    callee: contract,
    funcName: 'getProposalEta',
    funcArgs: [
      gateway,
      callData,
      e.U(0),
    ],
  });
  assert(d.U64().topDecode(result.returnData[0]) === 11n);
});

test('Execute cancel time lock proposal', async () => {
  await deployContract();

  const callData = e.Buffer('');
  const payload = e.TopBuffer(e.Tuple(
    e.U8(1),
    gateway,
    callData,
    e.U(0),
    e.U64(0),
  ).toTopU8A());
  await mockCallApprovedByGateway(payload);

  // Mock time lock era set
  const proposalHash = getProposalHash(gateway, callData, e.U(0));

  await contract.setAccount({
    ...await contract.getAccountWithKvs(),
    kvs: [
      ...baseKvs(),

      e.kvs.Mapper('time_lock_eta', proposalHash).Value(e.U64(10)),
    ],
  });

  await deployer.callContract({
    callee: contract,
    funcName: 'execute',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(GOVERNANCE_CHAIN),
      e.Str(MESSAGE_ID),
      e.Str(GOVERNANCE_ADDRESS),
      payload,
    ],
  });

  // Time lock eta was removed
  const kvs = await contract.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    kvs: baseKvs(),
  });
});
