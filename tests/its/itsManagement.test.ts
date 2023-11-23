import { afterEach, assert, beforeEach, test } from 'vitest'
import { assertAccount, e, SWallet, SWorld } from 'xsuite'
import {
  ADDRESS_ZERO, CHAIN_NAME_HASH,
  OTHER_CHAIN_ADDRESS,
  OTHER_CHAIN_NAME,
  OTHER_CHAIN_TOKEN_ADDRESS,
  TOKEN_ID,
  TOKEN_ID2,
  TOKEN_ID2_MANAGER_ADDRESS,
  TOKEN_ID2_MOCK,
  TOKEN_ID_CANONICAL,
  TOKEN_ID_MANAGER_ADDRESS,
  TOKEN_SALT,
} from '../helpers'
import {
  baseItsKvs,
  computeInterchainTokenId,
  deployContracts, deployTokenManagerMintBurn,
  gasService, gateway,
  interchainTokenFactory,
  its, tokenManagerLockUnlock, tokenManagerMintBurn,
} from '../itsHelpers'
import { AbiCoder } from 'ethers'

let world: SWorld
let deployer: SWallet
let collector: SWallet
let user: SWallet
let otherUser: SWallet

beforeEach(async () => {
  world = await SWorld.start()
  world.setCurrentBlockInfo({
    nonce: 0,
    epoch: 0,
  })

  collector = await world.createWallet()
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
  })
  user = await world.createWallet({
    balance: BigInt('10000000000000000'),
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
  })
  otherUser = await world.createWallet({
    balance: BigInt('10000000000000000'),
  })

  await deployContracts(deployer, collector)
})

afterEach(async () => {
  await world.terminate()
})

test.skip('Set flow limit', async () => {
  await user.callContract({
    callee: its,
    funcName: 'registerCanonicalToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID),
    ],
  })

  await user.callContract({
    callee: its,
    funcName: 'deployCustomTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.U8(0), // Mint/burn
      its,
    ],
  })

  const computedTokenId = computeInterchainTokenId(user)

  await deployer.callContract({
    callee: its,
    funcName: 'setFlowLimit',
    gasLimit: 20_000_000,
    funcArgs: [
      e.U32(2),
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Bytes(computedTokenId),

      e.U32(2),
      e.U(99),
      e.U(100),
    ],
  })

  let tokenManager = await world.newContract(TOKEN_ID_MANAGER_ADDRESS)
  let tokenManagerKvs = await tokenManager.getAccountWithKvs()
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(TOKEN_ID_CANONICAL)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Mapper('flow_limit').Value(e.U(99)),
    ],
  })

  tokenManager = await world.newContract('erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqpqqqqdz2m2t')
  tokenManagerKvs = await tokenManager.getAccountWithKvs()
  assertAccount(tokenManagerKvs, {
    balance: 0n,
    allKvs: [
      e.kvs.Mapper('token_id').Value(e.Bytes(computedTokenId)),
      e.kvs.Mapper('token_identifier').Value(e.Str(TOKEN_ID2)),
      e.kvs.Mapper('interchain_token_service').Value(its),
      e.kvs.Mapper('operator').Value(its),

      e.kvs.Mapper('flow_limit').Value(e.U(100)),
    ],
  })
})

test.skip('Set flow limit errors', async () => {
  await user.callContract({
    callee: its,
    funcName: 'setFlowLimit',
    gasLimit: 20_000_000,
    funcArgs: [
      e.U32(1),
      e.Bytes(TOKEN_ID_CANONICAL),

      e.U32(1),
      e.U(99),
    ],
  }).assertFail({ code: 4, message: 'Endpoint can only be called by owner' })

  await deployer.callContract({
    callee: its,
    funcName: 'setFlowLimit',
    gasLimit: 20_000_000,
    funcArgs: [
      e.U32(1),
      e.Bytes(TOKEN_ID_CANONICAL),

      e.U32(2),
      e.U(99),
      e.U(100),
    ],
  }).assertFail({ code: 4, message: 'Length mismatch' })

  await user.callContract({
    callee: its,
    funcName: 'registerCanonicalToken',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID),
    ],
  })

  await deployer.callContract({
    callee: its,
    funcName: 'setFlowLimit',
    gasLimit: 20_000_000,
    funcArgs: [
      e.U32(2),
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Bytes(TOKEN_ID2_MOCK),

      e.U32(2),
      e.U(99),
      e.U(100),
    ],
  }).assertFail({ code: 4, message: 'Token manager does not exist' })

  await user.callContract({
    callee: its,
    funcName: 'deployCustomTokenManager',
    gasLimit: 20_000_000,
    funcArgs: [
      e.Str(TOKEN_ID2),
      e.U8(0), // Mint/burn
      user,
    ],
  })

  const computedTokenId = computeInterchainTokenId(user)

  // ITS not operator of token manager
  await deployer.callContract({
    callee: its,
    funcName: 'setFlowLimit',
    gasLimit: 20_000_000,
    funcArgs: [
      e.U32(2),
      e.Bytes(TOKEN_ID_CANONICAL),
      e.Bytes(computedTokenId),

      e.U32(2),
      e.U(99),
      e.U(100),
    ],
  }).assertFail({ code: 10, message: 'error signalled by smartcontract' })
})
