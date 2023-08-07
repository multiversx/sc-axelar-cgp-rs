import fs from "fs"
import { UserSecretKey } from "@multiversx/sdk-wallet/out"
import { Address } from "@multiversx/sdk-core/out"
import createKeccakHash from "keccak";

export const MOCK_CONTRACT_ADDRESS_1: string = "erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax";
export const MOCK_CONTRACT_ADDRESS_2: string = "erd1qqqqqqqqqqqqqpgq7ykazrzd905zvnlr88dpfw06677lxe9w0n4suz00uh";

export const ALICE_ADDR = 'erd1qyu5wthldzr8wx5c9ucg8kjagg0jfs53s8nr3zpz3hypefsdd8ssycr6th';
export const BOB_ADDR = 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx';

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
