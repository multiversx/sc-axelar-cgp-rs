import { Command } from 'commander';
import { loadWallet, world } from './index';
import data from './data.json';
import { e } from 'xsuite/data';
import { envChain } from 'xsuite/interact';
import { AbiCoder } from 'ethers';
import { d } from 'xsuite';

export const setupTestCommands = (program: Command) => {
  program.command('deployHelloWorld').action(async () => {
    const wallet = await loadWallet();

    const result = await wallet.deployContract({
      code: data.codeHelloWorld,
      codeMetadata: ['upgradeable'],
      gasLimit: 100_000_000,
      codeArgs: [
        e.Addr(envChain.select(data.addressGateway)),
        e.Addr(envChain.select(data.addressGasService)),
      ],
    });
    console.log('Result:', result);

    console.log('Deployed Hello World Contract:', result.address);
  });

  program.command('helloWorldSetRemoteValue [destinationChain] [destinationAddress] [message]')
    .action(async (destinationChain, destinationAddress, message) => {
      const wallet = await loadWallet();

      // Remove '0x' from beginning of hex strings encoded by Ethereum
      const payloadEvm = AbiCoder.defaultAbiCoder()
        .encode(['string'], [message]).substring(2);

      const result = await wallet.callContract({
        callee: envChain.select(data.addressHelloWorld),
        funcName: 'setRemoteValue',
        gasLimit: 20_000_000,
        value: 10000000000000000n, // 0.01 EGLD
        funcArgs: [
          e.Str(destinationChain),
          e.Str(destinationAddress),
          e.TopBuffer(Buffer.from(payloadEvm, 'hex')),
        ],
      });

      console.log(`Result`, result);
    });

  program.command('helloWorldReceivedValue')
    .action(async () => {
      const result = await world.query({
        callee: envChain.select(data.addressHelloWorld),
        funcName: 'received_value',
      });

      const decoded = d.Tuple({
        sourceChain: d.Str(),
        sourceAddress: d.Str(),
        payload: d.Str()
      }).fromTop(result.returnData[0]);

      console.log(`Value at MultiversX is "${decoded.sourceChain}", "${decoded.sourceAddress}" - "${decoded.payload}"`);
    });
};
