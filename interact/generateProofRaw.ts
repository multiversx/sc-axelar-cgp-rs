import {
  Address,
  AddressValue,
  BigUIntValue,
  BinaryCodec,
  BytesValue,
  ContractFunction,
  H256Value,
  List,
  SmartContract,
  StringValue,
  Tuple,
} from '@multiversx/sdk-core/out';
import os from 'os';
import path from 'path';
import fs from 'fs';
import createKeccakHash from 'keccak';
import { UserSecretKey } from '@multiversx/sdk-wallet/out';
import { ALICE_PUB_KEY, MULTIVERSX_SIGNED_MESSAGE_PREFIX } from '../tests/helpers';
import { Buffer } from 'buffer';

const codec = new BinaryCodec();

export async function executeGatewayApproveContractCallRaw(
  chainId: string,
  commandName: string,
  commandId: string,
  sourceChain: string,
  sourceAddress: string,
  destinationAddress: string,
  payloadHash: string,
  wallet: string,
) {
  const gatewayContract = new SmartContract({
    address: Address.fromBech32('erd1qqqqqqqqqqqqqpgqsvzyz88e8v8j6x3wquatxuztnxjwnw92kkls6rdtzx'),
  });

  const approveContractCallData = Tuple.fromItems([
    new StringValue(sourceChain),
    new StringValue(sourceAddress),
    new AddressValue(Address.fromBech32(destinationAddress)),
    new H256Value(Buffer.from(payloadHash, 'hex')),
  ]);
  const encodedApproveContractCallData = codec.encodeTopLevel(approveContractCallData);

  const executeData = Tuple.fromItems([
    new StringValue(chainId),
    List.fromItems([new H256Value(Buffer.from(commandId, 'hex'))]),
    List.fromItems([new StringValue(commandName)]),
    List.fromItems([
      new BytesValue(encodedApproveContractCallData),
    ]),
  ]);
  const encodedExecuteData = codec.encodeTopLevel(executeData);

  console.log('MultiversX execute data', executeData);

  const proof = generateProof(encodedExecuteData);
  const encodedProof = codec.encodeTopLevel(proof);

  console.log('MultiversX execute proof', encodedProof.toString('hex'));

  return gatewayContract.call({
    caller: Address.fromBech32(wallet),
    func: new ContractFunction('execute'),
    gasLimit: 50_000_000,
    args: [
      Tuple.fromItems([
        new BytesValue(encodedExecuteData),
        new BytesValue(encodedProof),
      ]),
    ],
    chainID: chainId,
  });
}

function generateProof(encodedData: Buffer) {
  const messageHashData = Buffer.concat([
    Buffer.from(MULTIVERSX_SIGNED_MESSAGE_PREFIX),
    encodedData
  ]);

  const messageHash = createKeccakHash('keccak256').update(messageHashData).digest('hex');

  const homedir = os.homedir();
  const operatorWalletFile = path.resolve(homedir, 'multiversx-sdk/testwallets/latest/users/alice.pem');

  const file = fs.readFileSync(operatorWalletFile).toString();

  const signature = UserSecretKey.fromPem(file).sign(Buffer.from(messageHash, 'hex'));

  console.log('Data hash', messageHash);
  console.log('Signature', signature.toString('hex'));

  return Tuple.fromItems([
    List.fromItems([new H256Value(Buffer.from(ALICE_PUB_KEY, 'hex'))]),
    List.fromItems([new BigUIntValue(10)]),
    new BigUIntValue(10),
    List.fromItems([new H256Value(signature)]),
  ]);
}
