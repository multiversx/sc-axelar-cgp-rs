import { assertAccount, e, Encodable, LSContract, LSWallet, LSWorld, Wallet } from 'xsuite';
import {
  ADDRESS_ZERO,
  ALICE_PUB_KEY,
  BOB_PUB_KEY,
  CAROL_PUB_KEY,
  CHAIN_NAME,
  CHAIN_NAME_HASH,
  DOMAIN_SEPARATOR,
  getKeccak256Hash,
  getMessageHash,
  getSignersHash,
  INTERCHAIN_TOKEN_ID,
  MESSAGE_ID,
  OTHER_CHAIN_NAME,
  TOKEN_IDENTIFIER,
  TOKEN_MANAGER_ADDRESS,
  TOKEN_SALT,
} from './helpers';
import createKeccakHash from 'keccak';
import { Buffer } from 'buffer';
import { Kvs } from 'xsuite/dist/data/kvs';
import { assert } from 'vitest';
import { AbiCoder } from 'ethers';

export const PREFIX_INTERCHAIN_TOKEN_ID = 'its-interchain-token-id';

export const PREFIX_CANONICAL_TOKEN_SALT = 'canonical-token-salt';
export const PREFIX_INTERCHAIN_TOKEN_SALT = 'interchain-token-salt';
export const PREFIX_CUSTOM_TOKEN_SALT = 'custom-token-salt';

export const MESSAGE_TYPE_INTERCHAIN_TRANSFER = 0;
export const MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN = 1;
export const MESSAGE_TYPE_SEND_TO_HUB = 3;
export const MESSAGE_TYPE_RECEIVE_FROM_HUB = 4;
export const MESSAGE_TYPE_LINK_TOKEN = 5;
export const MESSAGE_TYPE_REGISTER_TOKEN_METADATA = 6;

export const ITS_HUB_CHAIN = 'axelar';
export const ITS_HUB_ADDRESS = 'axelar10jzzmv5m7da7dn2xsfac0yqe7zamy34uedx3e28laq0p6f3f8dzqp649fp';

export const TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN = 0;
export const TOKEN_MANAGER_TYPE_LOCK_UNLOCK = 2;
export const TOKEN_MANAGER_TYPE_MINT_BURN = 4;

export const ESDT_SYSTEM_CONTRACT = 'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzllls8a5w6u';

let address: string;
export let gateway: LSContract;
export let gasService: LSContract;
export let tokenManager: LSContract;
export let its: LSContract;
export let pingPong: LSContract;

export const defaultWeightedSigners = e.Tuple(
  e.List(
    e.Tuple(e.TopBuffer(ALICE_PUB_KEY), e.U(5)),
    e.Tuple(e.TopBuffer(BOB_PUB_KEY), e.U(6)),
    e.Tuple(e.TopBuffer(CAROL_PUB_KEY), e.U(7))
  ),
  e.U(10),
  e.TopBuffer(getKeccak256Hash('nonce1'))
);

export const defaultSignersHash = getSignersHash(
  [
    { signer: ALICE_PUB_KEY, weight: 5 },
    { signer: BOB_PUB_KEY, weight: 6 },
    { signer: CAROL_PUB_KEY, weight: 7 },
  ],
  10,
  getKeccak256Hash('nonce1')
);

export const baseGatewayKvs = (operator: Wallet) => {
  return [
    e.kvs.Mapper('previous_signers_retention').Value(e.U(16)),
    e.kvs.Mapper('domain_separator').Value(e.TopBuffer(DOMAIN_SEPARATOR)),
    e.kvs.Mapper('minimum_rotation_delay').Value(e.U64(3600)),

    e.kvs.Mapper('operator').Value(operator),
    e.kvs.Mapper('signer_hash_by_epoch', e.U(1)).Value(e.TopBuffer(defaultSignersHash)),
    e.kvs.Mapper('epoch_by_signer_hash', e.TopBuffer(defaultSignersHash)).Value(e.U(1)),
    e.kvs.Mapper('epoch').Value(e.U(1)),
  ];
};

export const deployGatewayContract = async (deployer: LSWallet) => {
  ({ contract: gateway, address } = await deployer.deployContract({
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [e.U(16), e.TopBuffer(DOMAIN_SEPARATOR), e.U64(3600), deployer, defaultWeightedSigners],
  }));

  const kvs = await gateway.getAccount();
  assertAccount(kvs, {
    balance: 0n,
    kvs: baseGatewayKvs(deployer),
  });
};

export const deployGasService = async (deployer: LSWallet, collector: LSWallet) => {
  ({ contract: gasService, address } = await deployer.deployContract({
    code: 'file:gas-service/output/gas-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [e.Addr(collector.toString())],
  }));

  const kvs = await gasService.getAccount();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString()))],
  });
};

export const deployTokenManagerInterchainToken = async (
  deployer: LSWallet,
  operator: LSWallet | LSContract = deployer,
  its: LSWallet | LSContract = operator,
  tokenIdentifier: string | null = null,
  burnRole: boolean = true,
  minter: LSWallet | LSContract | null = null
): Promise<Kvs[]> => {
  ({ contract: tokenManager, address } = await deployer.deployContract({
    code: 'file:token-manager/output/token-manager.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      its,
      e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN),
      e.TopBuffer(INTERCHAIN_TOKEN_ID),
      e.Tuple(e.Option(operator), e.Option(null)),
    ],
  }));

  let baseKvs = [
    e.kvs.Mapper('interchain_token_service').Value(its),
    e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN)),
    e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
    e.kvs.Mapper('account_roles', operator).Value(e.U32(0b00000110)), // flow limit & operator role

    ...(its !== operator ? [e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110))] : []), // flow limit & operator role
  ];

  const kvs = await tokenManager.getAccount();
  assertAccount(kvs, {
    balance: 0n,
    kvs: baseKvs,
  });

  // Set mint/burn roles if token is set
  if ((tokenIdentifier && burnRole) || minter) {
    baseKvs = [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_INTERCHAIN_TOKEN)),
      e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),

      ...(operator !== minter ? [e.kvs.Mapper('account_roles', operator).Value(e.U32(0b00000110))] : []), // flow limit & operator roles

      ...(tokenIdentifier && burnRole
        ? [
            e.kvs.Mapper('token_identifier').Value(e.Str(tokenIdentifier)),
            e.kvs.Esdts([{ id: tokenIdentifier, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
          ]
        : []),

      ...(its !== operator
        ? [e.kvs.Mapper('account_roles', its).Value(e.U32(tokenIdentifier && burnRole ? 0b00000111 : 0b00000110))]
        : []), // all roles OR flow limit & operator role
      ...(minter
        ? [e.kvs.Mapper('account_roles', minter).Value(e.U32(operator === minter ? 0b00000111 : 0b00000001))]
        : []), // all roles OR minter role
    ];

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      balance: 0n,
      kvs: baseKvs,
    });
  }

  return baseKvs;
};

export const deployTokenManagerMintBurn = async (
  deployer: LSWallet,
  operator: LSWallet | LSContract = deployer,
  its: LSWallet | LSContract = operator,
  tokenIdentifier: string = TOKEN_IDENTIFIER,
  burnRole: boolean = true
): Promise<Kvs[]> => {
  ({ contract: tokenManager, address } = await deployer.deployContract({
    code: 'file:token-manager/output/token-manager.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      its,
      e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
      e.TopBuffer(INTERCHAIN_TOKEN_ID),
      e.Tuple(e.Option(operator), e.Option(e.Str(tokenIdentifier))),
    ],
  }));

  let baseKvs = [
    e.kvs.Mapper('interchain_token_service').Value(its),
    e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_MINT_BURN)),
    e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
    e.kvs.Mapper('account_roles', operator).Value(e.U32(0b00000110)), // flow limit & operator role
    e.kvs.Mapper('token_identifier').Value(e.Str(tokenIdentifier)),

    ...(its !== operator ? [e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110))] : []), // flow limit & operator role
  ];

  const kvs = await tokenManager.getAccount();
  assertAccount(kvs, {
    balance: 0n,
    kvs: baseKvs,
  });

  // Set mint/burn roles if token is set
  if (burnRole) {
    baseKvs.push(e.kvs.Esdts([{ id: tokenIdentifier, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]));

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      balance: 0n,
      kvs: baseKvs,
    });
  }

  return baseKvs;
};

export const deployTokenManagerLockUnlock = async (
  deployer: LSWallet,
  its: LSWallet | LSContract = deployer,
  operator: LSWallet = deployer,
  tokenId: string = TOKEN_IDENTIFIER,
  interchainTokenId: string = INTERCHAIN_TOKEN_ID
): Promise<Kvs[]> => {
  ({ contract: tokenManager, address } = await deployer.deployContract({
    code: 'file:token-manager/output/token-manager.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      its,
      e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
      e.TopBuffer(interchainTokenId),
      e.Tuple(e.Option(operator), e.Option(e.Str(tokenId))),
    ],
  }));

  const baseKvs = [
    e.kvs.Mapper('interchain_token_service').Value(its),
    e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
    e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(interchainTokenId)),
    e.kvs.Mapper('account_roles', operator).Value(e.U32(0b00000110)), // flow limit & operator role
    e.kvs.Mapper('token_identifier').Value(e.Str(tokenId)),

    ...(its !== operator ? [e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110))] : []), // flow limit & operator role
  ];

  const kvs = await tokenManager.getAccount();
  assertAccount(kvs, {
    balance: 0n,
    kvs: baseKvs,
  });

  return baseKvs;
};

export const deployIts = async (deployer: LSWallet) => {
  ({ contract: its, address } = await deployer.deployContract({
    code: 'file:interchain-token-service/output/interchain-token-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      gateway,
      gasService,
      tokenManager,

      deployer,
      e.Str(CHAIN_NAME),
      e.Str(ITS_HUB_ADDRESS),

      e.U32(1),
      e.Str(OTHER_CHAIN_NAME),
    ],
  }));

  const kvs = await its.getAccount();
  assertAccount(kvs, {
    balance: 0n,
    kvs: [...baseItsKvs(deployer)],
  });
};

export const deployPingPongInterchain = async (deployer: LSWallet, amount = 1_000, itLSContract = its) => {
  ({ contract: pingPong } = await deployer.deployContract({
    code: 'file:ping-pong-interchain/output/ping-ping-interchain.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [itLSContract, e.U(amount), e.U64(10), e.Option(null)],
  }));
};

export const deployContracts = async (deployer: LSWallet, collector: LSWallet, includeIts: boolean = true) => {
  await deployGatewayContract(deployer);
  await deployGasService(deployer, collector);
  await deployTokenManagerLockUnlock(deployer);

  if (includeIts) {
    await deployIts(deployer);
  }
};

export const itsRegisterCanonicalToken = async (
  world: LSWorld,
  user: LSWallet,
  addTokens: boolean = false,
  tokenIdentifier: string = TOKEN_IDENTIFIER
) => {
  const deploySalt = computeCanonicalInterchainTokenDeploySalt(tokenIdentifier);
  const computedTokenId = computeInterchainTokenIdRaw(deploySalt);

  const result = await user.callContract({
    callee: its,
    funcName: 'registerCanonicalInterchainToken',
    gasLimit: 20_000_000,
    funcArgs: [e.Str(tokenIdentifier)],
  });

  assert(result.returnData[0] === computedTokenId);

  const tokenManager = await world.newContract(TOKEN_MANAGER_ADDRESS);
  const baseTokenManagerKvs = [
    e.kvs.Mapper('interchain_token_service').Value(its),
    e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
    e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
    e.kvs.Mapper('token_identifier').Value(e.Str(tokenIdentifier)),
    e.kvs.Mapper('account_roles', e.Addr(ADDRESS_ZERO)).Value(e.U32(0b00000110)), // flow limit & operator roles
    e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit & operator roles
  ];

  if (addTokens) {
    if (tokenIdentifier === 'EGLD') {
      await tokenManager.setAccount({
        ...(await tokenManager.getAccount()),
        balance: 100_000,
        kvs: [...baseTokenManagerKvs],
      });
    } else {
      await tokenManager.setAccount({
        ...(await tokenManager.getAccount()),
        kvs: [...baseTokenManagerKvs, e.kvs.Esdts([{ id: tokenIdentifier, amount: 100_000 }])],
      });
    }
  }

  const kvs = await its.getAccount();

  // Token manager was succesfully deployed
  assertAccount(kvs, {
    hasKvs: [e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS))],
  });

  return { computedTokenId, tokenManager, baseTokenManagerKvs };
};

export const itsRegisterCustomTokenLockUnlock = async (
  world: LSWorld,
  user: LSWallet,
  addTokens: boolean = false,
  tokenIdentifier: string = TOKEN_IDENTIFIER
) => {
  const computedTokenId = computeLinkedTokenId(user);

  await user.callContract({
    callee: its,
    funcName: 'registerCustomToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(TOKEN_SALT),
      e.Str(tokenIdentifier),
      e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
      e.Buffer(user.toTopU8A()),
    ],
  });

  const tokenManager = await world.newContract(TOKEN_MANAGER_ADDRESS);
  const baseTokenManagerKvs = [
    e.kvs.Mapper('interchain_token_service').Value(its),
    e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK)),
    e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
    e.kvs.Mapper('token_identifier').Value(e.Str(tokenIdentifier)),
    e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limit & operator roles
    e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110)), // flow limit & operator roles
  ];

  if (addTokens) {
    if (tokenIdentifier === 'EGLD') {
      await tokenManager.setAccount({
        ...(await tokenManager.getAccount()),
        balance: 100_000,
        kvs: [...baseTokenManagerKvs],
      });
    } else {
      await tokenManager.setAccount({
        ...(await tokenManager.getAccount()),
        kvs: [...baseTokenManagerKvs, e.kvs.Esdts([{ id: tokenIdentifier, amount: 100_000 }])],
      });
    }
  }

  const kvs = await its.getAccount();

  // Token manager was succesfully deployed
  assertAccount(kvs, {
    hasKvs: [e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS))],
  });

  return { computedTokenId, tokenManager, baseTokenManagerKvs };
};

export const itsRegisterCustomTokenMintBurn = async (world: LSWorld, user: LSWallet, flowLimit: number = 0) => {
  const computedTokenId = computeLinkedTokenId(user);

  await user.callContract({
    callee: its,
    funcName: 'registerCustomToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(TOKEN_SALT),
      e.Str(TOKEN_IDENTIFIER),
      e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
      e.Buffer(user.toTopU8A()),
    ],
  });

  const tokenManager = await world.newContract(TOKEN_MANAGER_ADDRESS);
  const baseTokenManagerKvs = [
    e.kvs.Mapper('interchain_token_service').Value(its),
    e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
    e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_IDENTIFIER)),
    e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limit and operator roles
    e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)), // flow limit role

    e.kvs.Esdts([{ id: TOKEN_IDENTIFIER, roles: ['ESDTRoleLocalMint', 'ESDTRoleLocalBurn'] }]),

    ...(flowLimit ? [e.kvs.Mapper('flow_limit').Value(e.Option(e.U(flowLimit)))] : []),
  ];

  // Set mint/burn role for token
  await tokenManager.setAccount({
    ...(await tokenManager.getAccount()),
    kvs: baseTokenManagerKvs,
  });

  const kvs = await its.getAccount();

  // Token manager was succesfully deployed
  assertAccount(kvs, {
    hasKvs: [e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(TOKEN_MANAGER_ADDRESS))],
  });

  return { computedTokenId, tokenManager, baseTokenManagerKvs };
};

export const computeInterchainTokenIdRaw = (deploySalt = TOKEN_SALT) => {
  const prefix = createKeccakHash('keccak256').update(PREFIX_INTERCHAIN_TOKEN_ID).digest('hex');
  const buffer = Buffer.concat([
    Buffer.from(prefix, 'hex'),
    Buffer.from(deploySalt, 'hex'),
  ]);

  return createKeccakHash('keccak256').update(buffer).digest('hex');
};

export const computeInterchainTokenDeploySalt = (user: Encodable, salt = TOKEN_SALT) => {
  const prefix = createKeccakHash('keccak256').update(PREFIX_INTERCHAIN_TOKEN_SALT).digest('hex');
  const chain_name_hash = createKeccakHash('keccak256').update(CHAIN_NAME).digest('hex');
  const buffer = Buffer.concat([
    Buffer.from(prefix, 'hex'),
    Buffer.from(chain_name_hash, 'hex'),
    Buffer.from(user.toTopHex(), 'hex'),
    Buffer.from(salt, 'hex'),
  ]);

  return createKeccakHash('keccak256').update(buffer).digest('hex');
};

export const computeCanonicalInterchainTokenDeploySalt = (tokenIdentifier: string = TOKEN_IDENTIFIER) => {
  const prefix = createKeccakHash('keccak256').update(PREFIX_CANONICAL_TOKEN_SALT).digest('hex');
  const chain_name_hash = createKeccakHash('keccak256').update(CHAIN_NAME).digest('hex');
  const buffer = Buffer.concat([
    Buffer.from(prefix, 'hex'),
    Buffer.from(chain_name_hash, 'hex'),
    Buffer.from(tokenIdentifier),
  ]);

  return createKeccakHash('keccak256').update(buffer).digest('hex');
};

export const computeLinkedTokenId = (user: Encodable, salt = TOKEN_SALT) => {
  const deploySaltLink = computeLinkedTokenDeploySalt(user, salt);

  return computeInterchainTokenIdRaw(deploySaltLink);
};

export const computeLinkedTokenDeploySalt = (user: Encodable, salt = TOKEN_SALT) => {
  const prefix = createKeccakHash('keccak256').update(PREFIX_CUSTOM_TOKEN_SALT).digest('hex');
  const chain_name_hash = createKeccakHash('keccak256').update(CHAIN_NAME).digest('hex');
  const buffer = Buffer.concat([
    Buffer.from(prefix, 'hex'),
    Buffer.from(chain_name_hash, 'hex'),
    Buffer.from(user.toTopHex(), 'hex'),
    Buffer.from(salt, 'hex'),
  ]);

  return createKeccakHash('keccak256').update(buffer).digest('hex');
};

export const baseItsKvs = (
  operator: LSWallet | LSContract,
  computedTokenId: string | null = null,
  tokenManagerAddress: string = TOKEN_MANAGER_ADDRESS
) => {
  return [
    e.kvs.Mapper('gateway').Value(gateway),
    e.kvs.Mapper('gas_service').Value(gasService),
    e.kvs.Mapper('token_manager').Value(tokenManager),
    e.kvs.Mapper('account_roles', operator).Value(e.U32(0b00000010)), // operator role

    e.kvs.Mapper('chain_name').Value(e.Str(CHAIN_NAME)),
    e.kvs.Mapper('chain_name_hash').Value(e.TopBuffer(CHAIN_NAME_HASH)),
    e.kvs.Mapper('its_hub_address').Value(e.Str(ITS_HUB_ADDRESS)),

    e.kvs.Mapper('trusted_chains').UnorderedSet([e.Str(OTHER_CHAIN_NAME)]),

    ...(computedTokenId
      ? [e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(tokenManagerAddress))]
      : []),
  ];
};

export async function mockGatewayMessageApproved(
  payload: string,
  operator: LSWallet,
  sourceChain: string = ITS_HUB_CHAIN,
  sourceAddress: string = ITS_HUB_ADDRESS
) {
  const payloadHash = getKeccak256Hash(Buffer.from(payload, 'hex'));

  const messageHash = getMessageHash(sourceChain, MESSAGE_ID, sourceAddress, its, payloadHash);

  const crossChainId = e.Tuple(e.Str(sourceChain), e.Str(MESSAGE_ID));

  // Mock call approved by gateway
  await gateway.setAccount({
    ...(await gateway.getAccount()),
    codeMetadata: ['payable'],
    kvs: [
      ...baseGatewayKvs(operator),

      // Manually approve message
      e.kvs.Mapper('messages', crossChainId).Value(messageHash),
    ],
  });

  return { crossChainId, messageHash };
}

export const wrapFromItsHubPayload = (payload: string, sourceChain: string = OTHER_CHAIN_NAME) => {
  return AbiCoder.defaultAbiCoder()
    .encode(['uint256', 'string', 'bytes'], [MESSAGE_TYPE_RECEIVE_FROM_HUB, sourceChain, payload])
    .substring(2);
};

export const wrapToItsHubPayload = (payload: string, sourceChain: string = OTHER_CHAIN_NAME) => {
  return AbiCoder.defaultAbiCoder()
    .encode(['uint256', 'string', 'bytes'], [MESSAGE_TYPE_SEND_TO_HUB, sourceChain, payload])
    .substring(2);
};
