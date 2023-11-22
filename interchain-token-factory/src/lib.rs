#![no_std]

multiversx_sc::imports!();

// TODO
#[multiversx_sc::contract]
pub trait InterchainTokenFactoryContract {
    #[init]
    fn init(&self) {}
}
