import fs from "fs"
import { UserSecretKey } from "@multiversx/sdk-wallet/out"
import createKeccakHash from "keccak";
import { e } from 'xsuite';

export const MOCK_CONTRACT_ADDRESS_1: string = "erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax";
export const MOCK_CONTRACT_ADDRESS_2: string = "erd1qqqqqqqqqqqqqpgq7ykazrzd905zvnlr88dpfw06677lxe9w0n4suz00uh";

export const ALICE_PUB_KEY = '0139472eff6886771a982f3083da5d421f24c29181e63888228dc81ca60d69e1';
export const BOB_PUB_KEY = '8049d639e5a6980d1cd2392abcce41029cda74a1563523a202f09641cc2618f8';
export const MOCK_PUB_KEY_1 = '000000000000000005006fbc99e58a82ef3c082afcd2679292693049c9371090';
export const MOCK_PUB_KEY_2 = '00000000000000000500f12dd10c4d2be8264fe339da14b9fad7bdf364ae7ceb';

export const TOKEN_SYMBOL: string = "WEGLD";
export const TOKEN_ID: string = "WEGLD-123456";
export const TOKEN_ID2: string = "OTHER-654321";

export const generateSignature = (dataHash: string, signerPem = './alice.pem') => {
  const file = fs.readFileSync(signerPem).toString();
  const privateKey = UserSecretKey.fromPem(file);

  return privateKey.sign(Buffer.from(dataHash, 'hex'));
}

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
    Buffer.from(thresholdHex, 'hex'),
  ]);

  return createKeccakHash('keccak256').update(data).digest();
}

export const generateProof = (data: any): any => {
  const hash = createKeccakHash('keccak256').update(Buffer.from(data.toTopHex(), 'hex')).digest('hex');
  const signature = generateSignature(hash);

  const proof = e.Tuple(
    e.List(e.Bytes(ALICE_PUB_KEY)),
    e.List(e.U(10)),
    e.U(10),
    e.List(e.Bytes(signature))
  );

  return { hash, proof };
}
