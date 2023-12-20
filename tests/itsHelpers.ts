import { assertAccount, e, SContract, SWallet } from 'xsuite';
import {
  CHAIN_ID,
  CHAIN_NAME,
  CHAIN_NAME_HASH,
  COMMAND_ID,
  INTERCHAIN_TOKEN_ID,
  MOCK_CONTRACT_ADDRESS_1,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_ADDRESS_HASH,
  OTHER_CHAIN_NAME,
  TOKEN_ID,
  TOKEN_ID_MANAGER_ADDRESS,
  TOKEN_SALT,
} from './helpers';
import createKeccakHash from 'keccak';
import { Buffer } from 'buffer';
import { Kvs } from 'xsuite/dist/data/kvs';
import { AddressEncodable } from 'xsuite/dist/data/AddressEncodable';

export const PREFIX_INTERCHAIN_TOKEN_ID = 'its-interchain-token-id';

export const PREFIX_CANONICAL_TOKEN_SALT = 'canonical-token-salt';
export const PREFIX_INTERCHAIN_TOKEN_SALT = 'interchain-token-salt';

export const MESSAGE_TYPE_INTERCHAIN_TRANSFER = 0;
export const MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN = 1;
export const MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER = 2;

export const LATEST_METADATA_VERSION = 1;

export const TOKEN_MANAGER_TYPE_MINT_BURN = 0;
export const TOKEN_MANAGER_TYPE_LOCK_UNLOCK = 2;

let address: string;
export let gateway: SContract;
export let gasService: SContract;
export let interchainTokenFactory: SContract;
export let tokenManager: SContract;
export let its: SContract;
export let pingPong: SContract;

export const deployGatewayContract = async (deployer: SWallet) => {
  ({ contract: gateway, address } = await deployer.deployContract({
    code: 'file:gateway/output/gateway.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(MOCK_CONTRACT_ADDRESS_1),
      e.Str(CHAIN_ID),
    ],
  }));

  const kvs = await gateway.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('auth_module').Value(e.Addr(MOCK_CONTRACT_ADDRESS_1)),
      e.kvs.Mapper('chain_id').Value(e.Str(CHAIN_ID)),
    ],
  });
};

export const deployGasService = async (deployer: SWallet, collector: SWallet) => {
  ({ contract: gasService, address } = await deployer.deployContract({
    code: 'file:gas-service/output/gas-service.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(collector.toString()),
    ],
  }));

  const kvs = await gasService.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('gas_collector').Value(e.Addr(collector.toString())),
    ],
  });
};

export const deployTokenManagerMintBurn = async (
  deployer: SWallet,
  operator: SWallet | SContract = deployer,
  its: SWallet | SContract = operator,
  tokenIdentifier: string | null = null,
  burnRole: boolean = true,
  minter: SWallet | SContract | null = null,
): Promise<Kvs> => {
  ({ contract: tokenManager, address } = await deployer.deployContract({
    code: 'file:token-manager/output/token-manager.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      its,
      e.U8(TOKEN_MANAGER_TYPE_MINT_BURN),
      e.TopBuffer(INTERCHAIN_TOKEN_ID),
      e.Tuple(
        e.Option(operator),
        e.Option(tokenIdentifier ? e.Str(tokenIdentifier) : null),
      ),
    ],
  }));

  let baseKvs = [
    e.kvs.Mapper('interchain_token_service').Value(its),
    e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_MINT_BURN)),
    e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),
    e.kvs.Mapper('account_roles', operator).Value(e.U32(0b00000110)), // flow limit & operator role

    ...(its !== operator ? [e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110))] : []), // flow limit & operator role
    ...(tokenIdentifier ? [e.kvs.Mapper('token_identifier').Value(e.Str(tokenIdentifier))] : []),
  ];

  const kvs = await tokenManager.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: baseKvs,
  });

  // Set mint/burn roles if token is set
  if ((tokenIdentifier && burnRole) || minter) {
    baseKvs = [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('implementation_type').Value(e.U8(TOKEN_MANAGER_TYPE_MINT_BURN)),
      e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(INTERCHAIN_TOKEN_ID)),

      ...(operator !== minter ? [e.kvs.Mapper('account_roles', operator).Value(e.U32(0b00000110))] : []), // flow limit & operator roles

      ...(tokenIdentifier && burnRole ?
        [
          e.kvs.Mapper('token_identifier').Value(e.Str(tokenIdentifier)),
          e.kvs.Esdts([{ id: tokenIdentifier, roles: ['ESDTRoleLocalBurn', 'ESDTRoleLocalMint'] }]),
        ] : []),

      ...(its !== operator ? [e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000110))] : []), // flow limit & operator role
      ...(minter ? [e.kvs.Mapper(
        'account_roles',
        minter,
      ).Value(e.U32(operator === minter ? 0b00000111 : 0b00000001))] : []), // all roles OR minter role
    ];

    await tokenManager.setAccount({
      ...(await tokenManager.getAccount()),
      balance: 0n,
      kvs: baseKvs,
    });
  }

  return baseKvs;
};

export const deployTokenManagerLockUnlock = async (
  deployer: SWallet,
  its: SWallet | SContract = deployer,
  operator: SWallet = deployer,
  tokenId: string = TOKEN_ID,
  interchainTokenId: string = INTERCHAIN_TOKEN_ID,
): Promise<Kvs> => {
  ({ contract: tokenManager, address } = await deployer.deployContract({
    code: 'file:token-manager/output/token-manager.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      its,
      e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
      e.TopBuffer(interchainTokenId),
      e.Tuple(
        e.Option(operator),
        e.Option(e.Str(tokenId)),
      ),
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

  const kvs = await tokenManager.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: baseKvs,
  });

  return baseKvs;
};

export const deployIts = async (deployer: SWallet) => {
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

      e.U32(1),
      e.Str(OTHER_CHAIN_NAME),

      e.U32(1),
      e.Str(OTHER_CHAIN_ADDRESS),
    ],
  }));

  const kvs = await its.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      ...baseItsKvs(deployer),
    ],
  });
};

export const deployInterchainTokenFactory = async (deployer: SWallet, callIts: boolean = true) => {
  ({ contract: interchainTokenFactory, address } = await deployer.deployContract({
    code: 'file:interchain-token-factory/output/interchain-token-factory.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      its,
    ],
  }));

  const kvs = await interchainTokenFactory.getAccountWithKvs();
  assertAccount(kvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('chain_name_hash').Value(CHAIN_NAME_HASH),
    ],
  });

  if (callIts) {
    // Set interchain token factory contract on its
    await deployer.callContract({
      callee: its,
      funcName: 'setInterchainTokenFactory',
      funcArgs: [
        interchainTokenFactory,
      ],
      gasLimit: 10_000_000,
    });
  }
};

export const deployPingPongInterchain = async (deployer: SWallet, amount = 1_000) => {
  ({ contract: pingPong } = await deployer.deployContract({
    code: 'file:ping-pong-interchain/output/ping-ping-interchain.wasm',
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      its,
      e.U(amount),
      e.U64(10),
      e.Option(null),
    ],
  }));
};

export const deployContracts = async (deployer: SWallet, collector: SWallet, includeIts: boolean = true) => {
  await deployGatewayContract(deployer);
  await deployGasService(deployer, collector);
  await deployTokenManagerLockUnlock(deployer);

  if (includeIts) {
    await deployIts(deployer);
    await deployInterchainTokenFactory(deployer);
  }
};

export const itsDeployTokenManagerLockUnlock = async (world, user: SWallet, addTokens: boolean = false, tokenIdentifier: string = TOKEN_ID) => {
  const computedTokenId = computeInterchainTokenId(user);

  await user.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(TOKEN_SALT),
      e.Str(''), // destination chain empty
      e.U8(TOKEN_MANAGER_TYPE_LOCK_UNLOCK),
      e.Buffer(e.Tuple(
        e.Option(user),
        e.Option(e.Str(tokenIdentifier)),
      ).toTopBytes()),
    ],
  });

  const tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
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
        ...(await tokenManager.getAccountWithKvs()),
        balance: 100_000,
        kvs: [
          ...baseTokenManagerKvs,
        ],
      });
    } else {
      await tokenManager.setAccount({
        ...(await tokenManager.getAccountWithKvs()),
        kvs: [
          ...baseTokenManagerKvs,

          e.kvs.Esdts([{ id: tokenIdentifier, amount: 100_000 }]),
        ],
      });
    }
  }

  return { computedTokenId, tokenManager, baseTokenManagerKvs };
};

export const itsDeployTokenManagerMintBurn = async (world, user: SWallet, flowLimit: number = 0) => {
  const computedTokenId = computeInterchainTokenId(user);

  await user.callContract({
    callee: its,
    funcName: 'deployTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.TopBuffer(TOKEN_SALT),
      e.Str(''), // destination chain empty
      e.U8(0), // Mint/burn
      e.Buffer(e.Tuple(
        e.Option(user),
        e.Option(e.Str(TOKEN_ID)),
      ).toTopBytes()),
    ],
  });

  const tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS);
  const baseTokenManagerKvs = [
    e.kvs.Mapper('interchain_token_service').Value(its),
    e.kvs.Mapper('interchain_token_id').Value(e.TopBuffer(computedTokenId)),
    e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
    e.kvs.Mapper('account_roles', user).Value(e.U32(0b00000110)), // flow limit and operator roles
    e.kvs.Mapper('account_roles', its).Value(e.U32(0b00000100)), // flow limit role

    e.kvs.Esdts([{ id: TOKEN_ID, roles: ['ESDTRoleLocalMint', 'ESDTRoleLocalBurn'] }]),

    ...(flowLimit ? [e.kvs.Mapper('flow_limit').Value(e.U(flowLimit))] : []),
  ];

  // Set mint/burn role for token
  await tokenManager.setAccount({
    ...(await tokenManager.getAccountWithKvs()),
    kvs: baseTokenManagerKvs,
  });

  return { computedTokenId, tokenManager, baseTokenManagerKvs };
};

export const computeInterchainTokenId = (user: AddressEncodable, salt = TOKEN_SALT) => {
  const prefix = createKeccakHash('keccak256').update(PREFIX_INTERCHAIN_TOKEN_ID).digest('hex');
  const buffer = Buffer.concat([
    Buffer.from(prefix, 'hex'),
    Buffer.from(user.toTopHex(), 'hex'),
    Buffer.from(salt, 'hex'),
  ]);

  return createKeccakHash('keccak256').update(buffer).digest('hex');
};

export const computeExpressExecuteHash = (payload: string) => {
  const payloadHash = createKeccakHash('keccak256').update(Buffer.from(payload, 'hex')).digest();
  const data = Buffer.concat([
    Buffer.from(COMMAND_ID, 'hex'),
    Buffer.from(OTHER_CHAIN_NAME),
    Buffer.from(OTHER_CHAIN_ADDRESS),
    payloadHash,
  ]);

  return createKeccakHash('keccak256').update(data).digest('hex');
};

export const computeInterchainTokenSalt = (chain_name: string, user: AddressEncodable, salt = TOKEN_SALT) => {
  const prefix = createKeccakHash('keccak256').update(PREFIX_INTERCHAIN_TOKEN_SALT).digest('hex');
  const chain_name_hash = createKeccakHash('keccak256').update(chain_name).digest('hex');
  const buffer = Buffer.concat([
    Buffer.from(prefix, 'hex'),
    Buffer.from(chain_name_hash, 'hex'),
    Buffer.from(user.toTopHex(), 'hex'),
    Buffer.from(salt, 'hex'),
  ]);

  return createKeccakHash('keccak256').update(buffer).digest('hex');
};

export const computeCanonicalInterchainTokenSalt = (chain_name: string, tokenIdentifier: string = TOKEN_ID) => {
  const prefix = createKeccakHash('keccak256').update(PREFIX_CANONICAL_TOKEN_SALT).digest('hex');
  const chain_name_hash = createKeccakHash('keccak256').update(chain_name).digest('hex');
  const buffer = Buffer.concat([
    Buffer.from(prefix, 'hex'),
    Buffer.from(chain_name_hash, 'hex'),
    Buffer.from(tokenIdentifier),
  ]);

  return createKeccakHash('keccak256').update(buffer).digest('hex');
};

export const baseItsKvs = (operator: SWallet | SContract, interchainTokenFactory: SContract | null = null, computedTokenId: string | null = null) => {
  return [
    e.kvs.Mapper('gateway').Value(gateway),
    e.kvs.Mapper('gas_service').Value(gasService),
    e.kvs.Mapper('token_manager').Value(tokenManager),
    e.kvs.Mapper('account_roles', operator).Value(e.U32(0b00000010)), // operator role

    e.kvs.Mapper('chain_name_hash').Value(e.TopBuffer(CHAIN_NAME_HASH)),
    e.kvs.Mapper('chain_name').Value(e.Str(CHAIN_NAME)),

    e.kvs.Mapper('trusted_address_hash', e.Str(OTHER_CHAIN_NAME)).Value(e.TopBuffer(OTHER_CHAIN_ADDRESS_HASH)),
    e.kvs.Mapper('trusted_address', e.Str(OTHER_CHAIN_NAME)).Value(e.Str(OTHER_CHAIN_ADDRESS)),

    ...(interchainTokenFactory ? [e.kvs.Mapper('interchain_token_factory').Value(interchainTokenFactory)] : []),
    ...(computedTokenId ? [e.kvs.Mapper('token_manager_address', e.TopBuffer(computedTokenId)).Value(e.Addr(
      TOKEN_ID_MANAGER_ADDRESS))] : []),
  ];
};
