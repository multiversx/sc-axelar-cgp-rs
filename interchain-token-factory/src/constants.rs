multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::api::KECCAK256_RESULT_LEN;

pub const PREFIX_CANONICAL_TOKEN_SALT : &[u8] = b"canonical-token-salt";
pub const PREFIX_INTERCHAIN_TOKEN_SALT  : &[u8] = b"interchain-token-salt";

pub type Hash<M> = ManagedByteArray<M, KECCAK256_RESULT_LEN>;
pub type TokenId<M> = ManagedByteArray<M, KECCAK256_RESULT_LEN>;

pub trait ManagedBufferAscii<M: ManagedTypeApi> {
    fn ascii_to_u8(&self) -> u8;
}

impl<M: ManagedTypeApi> ManagedBufferAscii<M> for ManagedBuffer<M> {
    fn ascii_to_u8(&self) -> u8 {
        let mut result: u8 = 0;

        self.for_each_batch::<32, _>(|batch| {
            for &byte in batch {
                if byte == 0 {
                    break;
                }

                result *= 10;
                result += (byte as char).to_digit(16).unwrap() as u8;
            }
        });

        result
    }
}
