import fs from "fs"
import { UserSecretKey } from "@multiversx/sdk-wallet/out"
import { Address } from "@multiversx/sdk-core/out"
import createKeccakHash from "keccak";
import { e } from 'xsuite';

export const MOCK_CONTRACT_ADDRESS_1: string = "erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax";
export const MOCK_CONTRACT_ADDRESS_2: string = "erd1qqqqqqqqqqqqqpgq7ykazrzd905zvnlr88dpfw06677lxe9w0n4suz00uh";

export const ALICE_ADDR = 'erd1qyu5wthldzr8wx5c9ucg8kjagg0jfs53s8nr3zpz3hypefsdd8ssycr6th';
export const BOB_ADDR = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx';

export const TOKEN_SYMBOL: string = "WEGLD";
export const TOKEN_ID: string = "WEGLD-123456";
export const TOKEN_ID_CANONICAL: string = "699fcfca47501d1619d08531652f17d000332fbf7bab5f00d7d5746089dc1f43";
export const TOKEN_ID_MANAGER_ADDRESS: string = "erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfrva02";

export const TOKEN_ID2: string = "OTHER-654321";
export const TOKEN_ID2_CUSTOM: string = "1b5920d64a5c1797d482e549b4c39541f8bfe18c4d3b8c8979339f54115c200f";
export const TOKEN_ID2_MANAGER_ADDRESS: string = "erd1qqqqqqqqqqqqqqqqzyg3zygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfrva02";

export const CHAIN_NAME: string = 'MultiversX';
export const CHAIN_NAME_HASH: string = createKeccakHash('keccak256').update(CHAIN_NAME).digest('hex');
export const OTHER_CHAIN_NAME: string = 'Ethereum';
export const OTHER_CHAIN_TOKEN_ADDRESS: string = 'Ethereum-Address';

export const generateSignature = (dataHash: string, signerPem = './alice.pem') => {
  const file = fs.readFileSync(signerPem).toString();
  const privateKey = UserSecretKey.fromPem(file);

  return privateKey.sign(Buffer.from(dataHash, 'hex'));
}

export const getOperatorsHash = (addresses: string[], weights: number[], threshold: number) => {
  let thresholdHex = threshold.toString(16);
  if (thresholdHex.length % 2) {
    thresholdHex = '0' + thresholdHex;
  }

  let data = Buffer.concat([
    // price_keys
    ...addresses.map(address => Address.fromBech32(address).pubkey()),
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
    e.List(e.Addr(ALICE_ADDR)),
    e.List(e.U(10)),
    e.U(10),
    e.List(e.Bytes(signature))
  );

  return { hash, proof };
}
