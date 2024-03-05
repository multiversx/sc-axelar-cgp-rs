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
import { ALICE_PUB_KEY } from '../tests/helpers';

export async function executeGateway (
  commandName: string,
  commandId: string,
  sourceChain: string,
  sourceAddress: string,
  destinationAddress: string,
  payloadHash: Uint8Array,
  sourceTxHash: string,
  sourceTxIndex: number,
  wallet: string,
) {
  const gatewayContract = new SmartContract({
    address: Address.fromBech32('erd1qqqqqqqqqqqqqpgqsvzyz88e8v8j6x3wquatxuztnxjwnw92kkls6rdtzx'),
  });

  const nestedData = Tuple.fromItems([
    new StringValue(sourceChain),
    new StringValue(sourceAddress),
    new AddressValue(Address.fromBech32(destinationAddress)),
    new BytesValue(Buffer.from(payloadHash)),
    new StringValue(sourceTxHash),
    new BigUIntValue(sourceTxIndex),
  ]);
  const encodedNestedData = new BinaryCodec().encodeTopLevel(nestedData);

  const executeData = Tuple.fromItems([
    List.fromItems([new StringValue(commandId)]),
    List.fromItems([new StringValue(commandName)]),
    List.fromItems([
      new BytesValue(encodedNestedData),
    ]),
  ]);

  console.log('MultiversX execute data', executeData);

  const proof = generateProof(executeData);

  console.log('MultiversX execute proof', new BinaryCodec().encodeTopLevel(proof).toString('hex'));

  return gatewayContract.call({
    caller: Address.fromBech32(wallet),
    func: new ContractFunction('execute'),
    gasLimit: 50_000_000,
    args: [
      executeData,
      proof,
    ],
    chainID: 'localnet',
  });
}

function generateProof (executeData: Tuple) {
  const encodedData = new BinaryCodec().encodeTopLevel(executeData);

  const dataHash = createKeccakHash('keccak256').update(encodedData).digest('hex');

  const homedir = os.homedir();
  const operatorWalletFile = path.resolve(homedir, 'multiversx-sdk/testwallets/latest/users/alice.pem');

  const file = fs.readFileSync(operatorWalletFile).toString();

  const signature = UserSecretKey.fromPem(file).sign(Buffer.from(dataHash, 'hex'));

  console.log('Data hash', dataHash);
  console.log('Signature', signature.toString('hex'));

  return Tuple.fromItems([
    List.fromItems([new AddressValue(Address.fromBech32(ALICE_PUB_KEY))]),
    List.fromItems([new BigUIntValue(10)]),
    new BigUIntValue(10),
    List.fromItems([new H256Value(signature)]),
  ]);
}
