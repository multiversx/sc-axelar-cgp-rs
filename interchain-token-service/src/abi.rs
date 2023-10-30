multiversx_sc::imports!();
multiversx_sc::derive_imports!();

use multiversx_sc::types::ManagedBuffer;

pub type Word = [u8; 32];

#[derive(TypeAbi, TopEncode)]
pub enum Token<M: ManagedTypeApi> {
    Uint256(BigUint<M>),
    Bytes32(ManagedByteArray<M, 32>),
    Bytes(ManagedBuffer<M>),
    String(ManagedBuffer<M>),
    Uint8(u8),
}

impl<M: ManagedTypeApi> Token<M> {
    pub fn into_biguint(self) -> BigUint<M> {
        if let Token::Uint256(value) = self {
            return value;
        }

        panic!("Unsupported type");
    }

    pub fn into_managed_byte_array(self) -> ManagedByteArray<M, 32> {
        if let Token::Bytes32(value) = self {
            return value;
        }

        panic!("Unsupported type");
    }

    pub fn into_managed_buffer(self) -> ManagedBuffer<M> {
        if let Token::Bytes(value) = self {
            return value;
        }

        if let Token::String(value) = self {
            return value;
        }

        panic!("Unsupported type");
    }
}

pub enum ParamType {
    Uint256,
    Bytes32,
    Bytes,
    String,
    Uint8,
}

impl<M: ManagedTypeApi> Token<M> {
    fn head_len(&self) -> u32 {
        match self {
            Token::Uint256(_)
            | Token::Bytes32(_)
            | Token::Bytes(_)
            | Token::String(_)
            | Token::Uint8(_) => 32,
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

pub struct DecodeResult<M: ManagedTypeApi> {
    pub token: Token<M>,
    pub new_offset: usize,
}

fn peek_32_bytes<M: ManagedTypeApi>(data: &ManagedBuffer<M>, offset: usize) -> Word {
    let mut word = [0u8; 32];

    let _ = data.load_slice(offset, &mut word);

    word
}

fn as_usize(slice: &Word) -> usize {
    if !slice[..28].iter().all(|x| *x == 0) {
        panic!("Invalid data");
    }

    ((slice[28] as usize) << 24)
        + ((slice[29] as usize) << 16)
        + ((slice[30] as usize) << 8)
        + (slice[31] as usize)
}

fn as_u8(slice: &Word) -> u8 {
    if !slice[..31].iter().all(|x| *x == 0) {
        panic!("Invalid data");
    }

    slice[31]
}

fn take_bytes<M: ManagedTypeApi>(data: &ManagedBuffer<M>, offset: usize, len: usize) -> ManagedBuffer<M> {
    data.copy_slice(offset, len).unwrap()
}

pub fn decode_param<M: ManagedTypeApi>(
    param: &ParamType,
    data: &ManagedBuffer<M>,
    offset: usize,
) -> DecodeResult<M> {
    match param {
        ParamType::Uint256 => {
            let slice = peek_32_bytes(data, offset);

            let value = BigUint::from_bytes_be(&slice);

            DecodeResult {
                token: Token::Uint256(value),
                new_offset: offset + 32,
            }
        }
        ParamType::Bytes32 => {
            let slice = peek_32_bytes(data, offset);

            let value = ManagedByteArray::<M, 32>::from(&slice);

            DecodeResult {
                token: Token::Bytes32(value),
                new_offset: offset + 32,
            }
        },
        ParamType::Bytes => {
            let dynamic_offset = as_usize(&peek_32_bytes(data, offset));
            let len = as_usize(&peek_32_bytes(data, dynamic_offset));

            let value = take_bytes(data, dynamic_offset + 32, len);

            DecodeResult {
                token: Token::Bytes(value),
                new_offset: offset + 32,
            }
        },
        ParamType::String => {
            let dynamic_offset = as_usize(&peek_32_bytes(data, offset));
            let len = as_usize(&peek_32_bytes(data, dynamic_offset));

            let value = take_bytes(data, dynamic_offset + 32, len);

            DecodeResult {
                token: Token::String(value),
                new_offset: offset + 32,
            }
        },
        ParamType::Uint8 => {
            let slice = peek_32_bytes(data, offset);

            let value = as_u8(&slice);

            DecodeResult {
                token: Token::Uint8(value),
                new_offset: offset + 32,
            }
        },
    }
}

// TODO: Test this using Rust tests
pub fn abi_encode<M: ManagedTypeApi>(tokens: &[Token<M>]) -> ManagedBuffer<M> {
    let heads_len = tokens.iter().fold(0, |head_acc, t| head_acc + t.head_len());

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

pub fn abi_decode<M: ManagedTypeApi, const CAP: usize>(
    types: &[ParamType],
    data: &ManagedBuffer<M>,
    result: &mut ArrayVec<Token<M>, CAP>,
    initial_offset: usize
) {
    let mut offset = initial_offset * 32;

    for param in types {
        let res = decode_param(param, data, offset);

        offset = res.new_offset;

        result.push(res.token);
    }
}

pub trait AbiEncode<M: ManagedTypeApi> {
    fn abi_encode(self) -> ManagedBuffer<M>;
}

pub trait AbiDecode<M: ManagedTypeApi> {
    fn abi_decode(payload: ManagedBuffer<M>) -> Self;
}
