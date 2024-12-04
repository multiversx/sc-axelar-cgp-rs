import { Command } from 'commander';
import { envChain } from 'xsuite/interact';
import { World } from 'xsuite/world';
// @ts-ignore
import data from './data.json';
import { e } from 'xsuite/data';
import { ADDRESS_ZERO } from '../tests/helpers';
import { setupITSCommands } from './its';
import { setupTestCommands } from './test';
import { getCurrentWeightedSigners } from './helpers/axelar-utils';

export const world = World.new({
  proxyUrl: envChain.publicProxyUrl(),
  chainId: envChain.id(),
  gasPrice: 1000000000,
});

export const loadWallet = () => world.newWalletFromFile('wallet.json');

export const program = new Command();

setupITSCommands(program);
setupTestCommands(program);

program.command('deployInitial').action(async () => {
  const wallet = await loadWallet();

  const resultGateway = await wallet.deployContract({
    code: data.codeGateway,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.U(envChain.select(data.previousSignersRetention)),
      e.TopBuffer(envChain.select(data.domainSeparator)),
      e.U64(envChain.select(data.minimumRotationDelay)),
      e.Addr(envChain.select(data.operator)),
    ],
  });
  console.log('Result Gateway:', resultGateway);

  // Deploy gas service
  const resultGasService = await wallet.deployContract({
    code: data.codeGasService,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(envChain.select(data.gasCollector)),
    ],
  });
  console.log('Result Gas Service:', resultGasService);

  console.log('Deployed Gateway Contract:', resultGateway.address);
  console.log('Deployed Gas Service Contract:', resultGasService.address);
});

program.command('deployGatewaySigners').action(async () => {
  const wallet = await loadWallet();

  const existingGateway = world.newContract(e.Addr(envChain.select(data.addressGateway)));
  const existingGatewayAccount = await existingGateway.getAccount();

  const { signers, verifierSetId } = await getCurrentWeightedSigners();

  const result = await wallet.upgradeContract({
    callee: envChain.select(data.addressGateway),
    code: existingGatewayAccount.code, // re-use existing gateway code
    codeMetadata: existingGatewayAccount.codeMetadata,
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(ADDRESS_ZERO), // don't change operator
      signers,
    ],
  });
  console.log('Result Gateway Signers:', result);
  console.log('Set initial signer set to:', verifierSetId);
});

program.command('deployGovernance').action(async () => {
  const wallet = await loadWallet();

  const resultGovernance = await wallet.deployContract({
    code: data.codeGovernance,
    codeMetadata: ['upgradeable'],
    gasLimit: 100_000_000,
    codeArgs: [
      e.Addr(envChain.select(data.addressGateway)),
      e.Str(envChain.select(data.governance.chain)),
      e.Str(envChain.select(data.governance.address)),
      e.U64(envChain.select(data.governance.minimumTimeDelay)),
    ],
  });
  console.log('Result Governance:', resultGovernance);

  // Change owner of gateway contract to be governance contract
  const resultChangeOwner = await wallet.callContract({
    callee: e.Addr(envChain.select(data.addressGateway)),
    value: 0,
    gasLimit: 6_000_000,
    funcName: 'ChangeOwnerAddress',
    funcArgs: [e.Addr(resultGovernance.address)],
  });
  console.log('Result Change Owner Gateway:', resultChangeOwner);

  // Change owner of governance contract to be itself
  const resultChangeOwnerGovernance = await wallet.callContract({
    callee: resultGovernance.address,
    value: 0,
    gasLimit: 6_000_000,
    funcName: 'ChangeOwnerAddress',
    funcArgs: [e.Addr(resultGovernance.address)],
  });
  console.log('Result Change Owner Governance:', resultChangeOwnerGovernance);

  console.log('Deployed Governance Contract:', resultGovernance.address);
});

program.parse(process.argv);
