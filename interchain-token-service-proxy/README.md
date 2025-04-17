# Interchain Token Service Proxy reference contract

This contract is to be used as a reference by dApps which reside on another Shard than the Axelar ITS contract that still want to integrate with the protocol.

Because the ITS contract only supports sync calls, in order for a dApp on MultiversX to be callable cross-chain, it will either need to reside on the same Shard as the ITS contract,
or it will need to implement a Proxy contract, which forwards the call to the dApp's contracts on some other Shard.

This Proxy is to be used as a reference starting point for dApps and **should** be modified to suit each individual dApp need.
