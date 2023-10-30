multiversx_sc::imports!();

use multiversx_sc::types::{ManagedAddress, ManagedBuffer};

pub type Word = [u8; 32];

pub enum Token<M: ManagedTypeApi> {
    Uint256(BigUint<M>),
    Bytes32(ManagedByteArray<M, 32>),
    Bytes(ManagedBuffer<M>),
    String(ManagedBuffer<M>),
    Uint8(u8),
}

impl<M: ManagedTypeApi> Token<M> {
    fn head_len(&self) -> u32 {
        match self {
            Token::Uint256(_) | Token::Bytes32(_) | Token::Bytes(_) | Token::String(_) | Token::Uint8(_) => 32,
        }
    }

    fn tail_len(&self) -> u32 {
        match self {
            Token::Uint256(_) | Token::Bytes32(_) | Token::Uint8(_) => 0,
            Token::Bytes(data) | Token::String(data) => pad_bytes_len(data) * 32,

        }
    }

    fn head_append(&self, acc: &mut ManagedBuffer<M>, suffix_offset: u32) {
        match self {
            Token::Uint256(data) => acc.append_bytes(&pad_biguint(data)),
            Token::Bytes32(data) => fixed_bytes_append(acc, data.as_managed_buffer()),
            Token::Bytes(_) | Token::String(_) => acc.append_bytes(&pad_u32(suffix_offset)),
            Token::Uint8(data) => acc.append_bytes(&pad_u32(*data as u32)),
        }
    }

    fn tail_append(&self, acc: &mut ManagedBuffer<M>) {
        match self {
            Token::Bytes(data) | Token::String(data) => pad_bytes_append(acc, data),
            _ => {}
        };
    }
}

pub fn pad_u32(value: u32) -> Word {
    let mut padded = [0u8; 32];
    padded[28..32].copy_from_slice(&value.to_be_bytes());
    padded
}

fn pad_bytes_len<M: ManagedTypeApi>(bytes: &ManagedBuffer<M>) -> u32 {
    // "+ 1" because len is also appended
    ((bytes.len() + 31) / 32) as u32 + 1
}

fn pad_bytes_append<M: ManagedTypeApi>(data: &mut ManagedBuffer<M>, bytes: &ManagedBuffer<M>) {
    data.append_bytes(&pad_u32(bytes.len() as u32));
    fixed_bytes_append(data, bytes);
}

fn fixed_bytes_len(bytes: &[u8]) -> u32 {
    ((bytes.len() + 31) / 32) as u32
}

fn fixed_bytes_append<M: ManagedTypeApi>(result: &mut ManagedBuffer<M>, data: &ManagedBuffer<M>) {
    let len = (data.len() + 31) / 32;

    let mut i = 0;
    data.for_each_batch::<32, _>(|bytes| {
        let to_copy = match i == len - 1 {
            false => 32,
            true => match bytes.len() % 32 {
                0 => 32,
                x => x,
            },
        };

        if to_copy == 32 {
            result.append_bytes(bytes);
        } else {
            let mut padded = [0u8; 32];
            padded[..to_copy].copy_from_slice(&bytes);
            result.append_bytes(&padded);
        }

        i += 1;
    });
}

pub fn pad_biguint<M: ManagedTypeApi>(value: &BigUint<M>) -> Word {
    let bytes = value.to_bytes_be_buffer();

    // TODO: How to better handle this?
    if bytes.len() > 32 {
        panic!("Unsupported number size");
    }

    let start_from = 32 - bytes.len();

    let mut buffer = [0u8; 32];
    let loaded_slice = &mut buffer[0..bytes.len()];
    let _ = bytes.load_slice(0, loaded_slice);

    let mut padded = [0u8; 32];
    padded[start_from..32].copy_from_slice(&loaded_slice);
    padded
}

// TODO: Test this using Rust tests
pub fn abi_encode<M: ManagedTypeApi>(tokens: &[Token<M>]) -> ManagedBuffer<M> {
    let heads_len = tokens
        .iter()
        .fold((0), |(head_acc), t| (head_acc + t.head_len()));

    let mut acc = ManagedBuffer::new();
    let mut offset = heads_len;
    for token in tokens {
        token.head_append(&mut acc, offset);

        offset += token.tail_len();
    }

    for token in tokens {
        token.tail_append(&mut acc);
    }

    return acc;
}

pub trait AbiEncode<M: ManagedTypeApi> {
    fn abi_encode(self) -> ManagedBuffer<M>;
}
