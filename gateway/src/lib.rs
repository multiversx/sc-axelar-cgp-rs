#![no_std]

multiversx_sc::imports!();

#[multiversx_sc::contract]
pub trait Gateway
{
    #[init]
    fn init(&self) {}
}
