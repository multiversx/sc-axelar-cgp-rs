import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { envChain } from 'xsuite/interact';
// @ts-ignore
import data from '../data.json';
import { zeroPadValue } from 'ethers';
import { e } from 'xsuite';

export async function getCurrentWeightedSigners() {
  const currentSignerSet = await getMultisigProverCurrentSignerSet();

  const nonce = zeroPadValue(Buffer.from(BigInt(currentSignerSet.created_at).toString(16), 'hex'), 32).substring(2);

  const readableSigners = {
    signers: currentSignerSet.addresses.map(({ address, weight }) => ({ signer: address, weight: Number(weight) })),
    threshold: Number(currentSignerSet.threshold),
    nonce,
  };

  const verifierSetId = currentSignerSet.verifierSetId;

  console.log('Readable Signers', readableSigners);
  console.log('Verifier set id', verifierSetId);

  const signers = e.Tuple(
    e.List(
      ...currentSignerSet.addresses.map(({ address, weight }) => e.Tuple(
        e.TopBuffer(address),
        e.U(BigInt(weight)))
      ),
    ),
    e.U(BigInt(currentSignerSet.threshold)),
    e.TopBuffer(nonce),
  );

  return { signers, verifierSetId };
}

const getMultisigProverCurrentSignerSet = async () => {
  const { rpc, contracts: { MultisigProver } } = envChain.select(data.axelar);

  if (!rpc) {
    throw new Error('Missing Axelar RPC URL');
  }

  if (!MultisigProver?.address) {
    throw new Error(`Missing or invalid Axelar MultisigProver address`);
  }

  const client = await CosmWasmClient.connect(rpc);
  const { id: verifierSetId, verifier_set: verifierSet } = await client.queryContractSmart(
    MultisigProver.address,
    'current_verifier_set',
  );
  const signers = Object.values(verifierSet.signers);

  const weightedAddresses = signers
    .map((signer: any) => ({
      address: signer.pub_key.ed25519,
      weight: signer.weight,
    }))
    .sort((a, b) => a.address.localeCompare(b.address));

  return {
    addresses: weightedAddresses,
    threshold: verifierSet.threshold,
    created_at: verifierSet.created_at,
    verifierSetId,
  };
};
