import fs from 'fs';
import { UserSecretKey } from '@multiversx/sdk-wallet/out';
import createKeccakHash from 'keccak';
import { e } from 'xsuite';
import { Buffer } from 'buffer';
import { Encodable } from 'xsuite/dist/data/Encodable';
import { TupleEncodable } from 'xsuite/dist/data/TupleEncodable';

export const MOCK_CONTRACT_ADDRESS_1: string = 'erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax';
export const MOCK_CONTRACT_ADDRESS_2: string = 'erd1qqqqqqqqqqqqqpgq7ykazrzd905zvnlr88dpfw06677lxe9w0n4suz00uh';

export const ALICE_PUB_KEY = '0139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e1';
export const BOB_PUB_KEY = '8049d639e5a6980d1cd2392abcce41029cda74a1563523a202f09641cc2618f8';
export const MOCK_PUB_KEY_1 = '000000000000000005006fbc99e58a82ef3c082afcd2679292693049c9371090';
export const MOCK_PUB_KEY_2 = '00000000000000000500f12dd10c4d2be8264fe339da14b9fad7bdf364ae7ceb';

export const MULTISIG_PROVER_PUB_KEY_1 = 'ca5b4abdf9eec1f8e2d12c187d41ddd054c81979cae9e8ee9f4ecab901cac5b6';
export const MULTISIG_PROVER_PUB_KEY_2 = 'ef637606f3144ee46343ba4a25c261b5c400ade88528e876f3deababa22a4449';

export const TOKEN_SALT: string = '91b44915de5f5bb438be952d4cda1bcc08829495e8704e40751dcee97aa83886';
export const TOKEN_ID: string = 'WEGLD-123456';
export const INTERCHAIN_TOKEN_ID: string = '01b3d64c8c6530a3aad5909ae7e0985d4438ce8eafd90e51ce48fbc809bced39';
export const CANONICAL_INTERCHAIN_TOKEN_ID: string = 'ab13e48029a0672cd3a669e258a97696dc33b4f72f4d758f92ee4afc8a026dc1';
export const TOKEN_ID_MANAGER_ADDRESS: string = 'erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfrva02';

export const TOKEN_ID2: string = 'OTHER-654321';
export const TOKEN_ID2_MANAGER_ADDRESS: string = 'erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfrva02';

export const ADDRESS_ZERO: string = 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu';

export const CHAIN_NAME: string = 'MultiversX';
export const CHAIN_NAME_HASH: string = createKeccakHash('keccak256').update(CHAIN_NAME).digest('hex');
export const OTHER_CHAIN_NAME: string = 'Ethereum';
export const OTHER_CHAIN_ADDRESS: string = '0x032fF26CbbdcE740e1Ff0A069Ad3fCf886fde220';
export const OTHER_CHAIN_ADDRESS_HASH: string = createKeccakHash('keccak256').update(OTHER_CHAIN_ADDRESS).digest('hex');
export const OTHER_CHAIN_TOKEN_ADDRESS: string = '0x79563F018EA5312cD84d7Ca9ecdB37c74A786B72';

export const CHAIN_ID: string = 'D';

export const COMMAND_ID: string = '8e45d084f6d317209d1d9e862bce4c3b17bf03ab71a687406c111f55b8dceb76';

export const PAYLOAD_HASH: string = '07b8e6f7ea72578a764983050201bba8fda552f6510db37cca751f0cae27986f';

export const MULTIVERSX_SIGNED_MESSAGE_PREFIX = '\x19MultiversX Signed Message:\n';

export const generateMessageHash = (data: Buffer): string => {
  const messageHashData = Buffer.concat([
    Buffer.from(MULTIVERSX_SIGNED_MESSAGE_PREFIX),
    data
  ]);

  return createKeccakHash('keccak256').update(messageHashData).digest('hex');
};

export const generateSignature = (data: Buffer, signerPem = './alice.pem'): Buffer => {
  const file = fs.readFileSync(signerPem).toString();
  const privateKey = UserSecretKey.fromPem(file);

  const messageHash = generateMessageHash(data);

  return privateKey.sign(Buffer.from(messageHash, 'hex'));
};

export const getOperatorsHash = (pubKeys: string[], weights: number[], threshold: number) => {
  let thresholdHex = threshold.toString(16);
  if (thresholdHex.length % 2) {
    thresholdHex = '0' + thresholdHex;
  }

  let data = Buffer.concat([
    // price_keys
    ...pubKeys.map(pubkey => Buffer.from(pubkey, 'hex')),
    ...weights.map(weight => {
      let weightHex = weight.toString(16);
      if (weightHex.length % 2) {
        weightHex = '0' + weightHex;
      }

      return Buffer.from(weightHex, 'hex');
    }),
    Buffer.from(thresholdHex, 'hex')
  ]);

  return createKeccakHash('keccak256').update(data).digest();
};

export const generateProof = (data: Encodable | Buffer): TupleEncodable => {
  if (data instanceof Encodable) {
    data = Buffer.from(data.toTopHex(), 'hex');
  }

  const signature = generateSignature(data);

  return e.Tuple(
    e.List(e.TopBuffer(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(10),
    e.List(e.TopBuffer(signature)),
  );
};

export const getCommandId = (commandId: string = 'commandId') => {
  return createKeccakHash('keccak256').update(Buffer.from(commandId)).digest('hex');
};
