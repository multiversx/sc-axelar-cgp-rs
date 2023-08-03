#![no_std]

multiversx_sc::imports!();

#[multiversx_sc::contract]
pub trait Auth
{
    #[init]
    fn init(&self) {}
}
