import { afterEach, assert, beforeEach, test } from "vitest";
import { assertAccount, e, SWallet, SWorld } from "xsuite";
import createKeccakHash from "keccak";
import { CHAIN_NAME, OTHER_CHAIN_ADDRESS, OTHER_CHAIN_NAME, TOKEN_ID, TOKEN_ID2 } from '../helpers';
import { deployInterchainTokenFactory, interchainTokenFactory } from '../itsHelpers';

let world: SWorld;
let deployer: SWallet;
let user: SWallet;

beforeEach(async () => {
  world = await SWorld.start();
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  })

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
  user = await world.createWallet();
});

afterEach(async () => {
  await world.terminate();
});

test("Init errors", async () => {
  await deployer.deployContract({
    code: "file:remote-address-validator/output/remote-address-validator.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 10_000_000,
    codeArgs: [
      e.Str(''),

      e.U32(1),
      e.Str(OTHER_CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_ADDRESS)
    ]
  }).assertFail({ code: 4, message: 'Zero string length' });

  await deployer.deployContract({
    code: "file:remote-address-validator/output/remote-address-validator.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 10_000_000,
    codeArgs: [
      e.Str(CHAIN_NAME),

      e.U32(2),
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_ADDRESS)
    ]
  }).assertFail({ code: 4, message: 'Length mismatch' });

  await deployer.deployContract({
    code: "file:remote-address-validator/output/remote-address-validator.wasm",
    codeMetadata: ["upgradeable"],
    gasLimit: 10_000_000,
    codeArgs: [
      e.Str(CHAIN_NAME),

      e.U32(1),
      e.Str(''),

      e.U32(1),
      e.Str(OTHER_CHAIN_ADDRESS)
    ]
  }).assertFail({ code: 4, message: 'Zero string length' });
});

test("Add trusted address", async () => {
  await deployInterchainTokenFactory(deployer);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: "addTrustedAddress",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str('SomeChain'),
      e.Str('SomeAddress'),
    ],
  }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' });

  await deployer.callContract({
    callee: interchainTokenFactory,
    funcName: "addTrustedAddress",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(''),
      e.Str(''),
    ],
  }).assertFail({ code: 4, message: 'Zero string length' });

  const someChainName = 'SomeChain';
  const someChainAddress = 'SomeAddress';

  await deployer.callContract({
    callee: interchainTokenFactory,
    funcName: "addTrustedAddress",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(someChainName),
      e.Str(someChainAddress),
    ],
  });

  const otherChainAddressHash = createKeccakHash('keccak256').update(OTHER_CHAIN_ADDRESS.toLowerCase()).digest('hex');
  const someChainAddressHash =  createKeccakHash('keccak256').update(someChainAddress.toLowerCase()).digest('hex');

  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('chain_name').Value(e.Str(CHAIN_NAME)),

      e.kvs.Mapper('remote_address_hashes', e.Str(OTHER_CHAIN_NAME)).Value(e.Bytes(otherChainAddressHash)),
      e.kvs.Mapper('remote_addresses', e.Str(OTHER_CHAIN_NAME)).Value(e.Str(OTHER_CHAIN_ADDRESS)),

      e.kvs.Mapper('remote_address_hashes', e.Str(someChainName)).Value(e.Bytes(someChainAddressHash)),
      e.kvs.Mapper('remote_addresses', e.Str(someChainName)).Value(e.Str(someChainAddress)),
    ],
  });
});

test("Remove trusted address", async () => {
  await deployInterchainTokenFactory(deployer);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: "removeTrustedAddress",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
    ],
  }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' });

  await deployer.callContract({
    callee: interchainTokenFactory,
    funcName: "removeTrustedAddress",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(''),
    ],
  }).assertFail({ code: 4, message: 'Zero string length' });

  await deployer.callContract({
    callee: interchainTokenFactory,
    funcName: "removeTrustedAddress",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
    ],
  });


  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('chain_name').Value(e.Str(CHAIN_NAME)),

      // OTHER_CHAIN_NAME was deleted
    ],
  });
});

test("Validate sender", async () => {
  await deployInterchainTokenFactory(deployer);

  let result = await user.callContract({
    callee: interchainTokenFactory,
    funcName: "validateSender",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS.toUpperCase()),
    ],
  });

  assert(result.returnData[0] === '01');

  result = await user.callContract({
    callee: interchainTokenFactory,
    funcName: "validateSender",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str(OTHER_CHAIN_ADDRESS),
    ],
  });

  assert(result.returnData[0] === '01');

  result = await user.callContract({
    callee: interchainTokenFactory,
    funcName: "validateSender",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
      e.Str('OtherAddress'),
    ],
  });

  assert(result.returnData[0] === '');

  result = await user.callContract({
    callee: interchainTokenFactory,
    funcName: "validateSender",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str('OtherChain'),
      e.Str(OTHER_CHAIN_ADDRESS),
    ],
  });

  assert(result.returnData[0] === '');
});

test("Get remote address", async () => {
  await deployInterchainTokenFactory(deployer);

  await user.callContract({
    callee: interchainTokenFactory,
    funcName: "getRemoteAddress",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str('SomeChain'),
    ],
  }).assertFail({ code: 4, message: 'Untrusted chain' });

  let result = await user.callContract({
    callee: interchainTokenFactory,
    funcName: "getRemoteAddress",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  assert(result.returnData[0] === e.Str(OTHER_CHAIN_ADDRESS).toTopHex());
});

test("Storage mapper views", async () => {
  await deployInterchainTokenFactory(deployer);

  let result = await user.callContract({
    callee: interchainTokenFactory,
    funcName: "remote_address_hashes",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  const otherChainAddressHash = createKeccakHash('keccak256').update(OTHER_CHAIN_ADDRESS.toLowerCase()).digest('hex');

  assert(result.returnData[0] === otherChainAddressHash);

  result = await user.callContract({
    callee: interchainTokenFactory,
    funcName: "remote_addresses",
    gasLimit: 5_000_000,
    funcArgs: [
      e.Str(OTHER_CHAIN_NAME),
    ],
  });

  assert(result.returnData[0] === e.Str(OTHER_CHAIN_ADDRESS).toTopHex());

  result = await user.callContract({
    callee: interchainTokenFactory,
    funcName: "chainName",
    gasLimit: 5_000_000,
    funcArgs: [],
  });

  assert(result.returnData[0] === e.Str(CHAIN_NAME).toTopHex());
});
