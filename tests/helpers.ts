import fs from 'fs';
import { UserSecretKey } from '@multiversx/sdk-wallet/out';
import createKeccakHash from 'keccak';
import { e, Encodable } from 'xsuite';

export const ALICE_PUB_KEY = '0139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e1';
export const BOB_PUB_KEY = '8049d639e5a6980d1cd2392abcce41029cda74a1563523a202f09641cc2618f8';
export const CAROL_PUB_KEY = 'b2a11555ce521e4944e09ab17549d85b487dcd26c84b5017a39e31a3670889ba';

export const TOKEN_SALT: string = '91b44915de5f5bb438be952d4cda1bcc08829495e8704e40751dcee97aa83886';
export const TOKEN_SALT2: string = '8be14915de5f5bb438be952d4cda1bcc08829495e8704e40751dcee97aa89854';
export const TOKEN_IDENTIFIER: string = 'WEGLD-123456';
export const TOKEN_IDENTIFIER2: string = 'OTHER-654321';
export const TOKEN_IDENTIFIER_EGLD: string = 'EGLD-000000';

export const INTERCHAIN_TOKEN_ID: string = '01b3d64c8c6530a3aad5909ae7e0985d4438ce8eafd90e51ce48fbc809bced39';
export const CANONICAL_INTERCHAIN_TOKEN_ID: string = 'ab13e48029a0672cd3a669e258a97696dc33b4f72f4d758f92ee4afc8a026dc1';

export const TOKEN_MANAGER_ADDRESS: string = 'erd1qqqqqqqqqqqqqpgqzyg3zygqqqqqqqqqqqqq2qqqqqqqqqqqqqqqtstllp';
export const TOKEN_MANAGER_ADDRESS_2: string = 'erd1qqqqqqqqqqqqqpgqzyg3zygqqqqqqqqqqqqq2qqqqqqqqqqpqqqq03de6q';
export const TOKEN_MANAGER_ADDRESS_3: string = 'erd1qqqqqqqqqqqqqpgqqqqqqqqqqqqq2qqqqqqqqqqqqqqqqqqqqqqqglm4l5';

export const ADDRESS_ZERO: string = 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu';

export const CHAIN_NAME: string = 'MultiversX';
export const CHAIN_NAME_HASH: string = createKeccakHash('keccak256').update(CHAIN_NAME).digest('hex');
export const OTHER_CHAIN_NAME: string = 'ethereum';
export const OTHER_CHAIN_ADDRESS: string = '0x032fF26CbbdcE740e1Ff0A069Ad3fCf886fde220';
export const OTHER_CHAIN_TOKEN_ADDRESS: string = '0x79563F018EA5312cD84d7Ca9ecdB37c74A786B72';

export const DOMAIN_SEPARATOR: string = '209d8e45d084f6d3171d9e862bce4c3b17bf03ab71a687406c111f55b8dceb76';

export const MESSAGE_ID: string = 'messageId';

export const PAYLOAD_HASH: string = '07b8e6f7ea72578a764983050201bba8fda552f6510db37cca751f0cae27986f';

export const MULTIVERSX_SIGNED_MESSAGE_PREFIX = '\x19MultiversX Signed Message:\n';

export const getAuthMessageHash = (signersHash: Buffer, dataHash: Buffer): string => {
  const messageHashData = Buffer.concat([
    Buffer.from(MULTIVERSX_SIGNED_MESSAGE_PREFIX),
    Buffer.from(DOMAIN_SEPARATOR, 'hex'),
    signersHash,
    dataHash,
  ]);

  return createKeccakHash('keccak256').update(messageHashData).digest('hex');
};

export const generateMessageSignature = (signersHash: Buffer, data: Encodable, signerPem = './alice.pem'): Buffer => {
  const dataHash = getKeccak256Hash(
    Buffer.concat([
      Buffer.from('00', 'hex'), // ApproveMessages command type,
      data.toTopU8A(),
    ])
  );

  const messageHashToSign = getAuthMessageHash(signersHash, Buffer.from(dataHash, 'hex'));

  const file = fs.readFileSync(signerPem).toString();
  const privateKey = UserSecretKey.fromPem(file);

  return privateKey.sign(Buffer.from(messageHashToSign, 'hex'));
};

export const generateRotateSignersSignature = (
  signersHash: Buffer,
  data: Encodable,
  signerPem = './alice.pem'
): Buffer => {
  const dataHash = getKeccak256Hash(
    Buffer.concat([
      Buffer.from('01', 'hex'), // RotateSigners command type,
      data.toTopU8A(),
    ])
  );

  const messageHashToSign = getAuthMessageHash(signersHash, Buffer.from(dataHash, 'hex'));

  const file = fs.readFileSync(signerPem).toString();
  const privateKey = UserSecretKey.fromPem(file);

  return privateKey.sign(Buffer.from(messageHashToSign, 'hex'));
};

export const getMessageHash = (
  sourceChain: string,
  messageId: string,
  sourceAddress: string,
  contractAddress: Encodable,
  payloadHash: string = PAYLOAD_HASH
): Encodable => {
  const messageData = Buffer.concat([
    e.Tuple(e.Str(sourceChain), e.Str(messageId)).toNestU8A(),
    e.Str(sourceAddress).toNestU8A(),
    contractAddress.toTopU8A(),
    Buffer.from(payloadHash, 'hex'),
  ]);

  return e.TopBuffer(getKeccak256Hash(messageData));
};

export const getSignersHash = (signers: { signer: string; weight: number }[], threshold: number, nonce: string) => {
  let signersLengthHex = numberToHex(signers.length, 4);

  let thresholdHex = numberToHex(threshold);

  let data = Buffer.concat([
    Buffer.from(signersLengthHex, 'hex'),
    ...signers.map((signer) => {
      let weightHex = numberToHex(signer.weight);
      let weightHexLengthHex = numberToHex(weightHex.length / 2, 4);

      return Buffer.concat([
        Buffer.from(signer.signer, 'hex'),
        Buffer.from(weightHexLengthHex, 'hex'),
        Buffer.from(weightHex, 'hex'),
      ]);
    }),
    Buffer.from(numberToHex(thresholdHex.length / 2, 4), 'hex'),
    Buffer.from(thresholdHex, 'hex'),
    Buffer.from(nonce, 'hex'),
  ]);

  return createKeccakHash('keccak256').update(data).digest();
};

const numberToHex = (nb: number, size: number = 0): string => {
  let nbHex = nb.toString(16);
  if (nbHex.length % 2) {
    nbHex = '0' + nbHex;
  }

  while (size && nbHex.length < size * 2) {
    nbHex = '00' + nbHex;
  }

  return nbHex;
};

export const generateProof = (weightedSigners: Encodable, signatures: (Buffer | null)[]): Encodable => {
  return e.Tuple(
    weightedSigners,
    e.List(
      ...signatures.map((signature) => {
        return e.Option(signature === null ? null : e.TopBuffer(signature));
      })
    )
  );
};

export const getKeccak256Hash = (payload: string | Buffer) => {
  return createKeccakHash('keccak256').update(Buffer.from(payload)).digest('hex');
};
