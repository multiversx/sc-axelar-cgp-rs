multiversx_sc::imports!();

use multiversx_sc::types::{ManagedAddress, ManagedBuffer};

pub type Word = [u8; 32];

#[derive(Debug)]
pub enum Token<M: ManagedTypeApi> {
    // Address.
    //
    // solidity name: address
    // Encoded to left padded [0u8; 32].
    // Address(ManagedAddress<M>),
    /// Vector of bytes with known size.
    ///
    /// solidity name eg.: bytes8, bytes32, bytes64, bytes1024
    /// Encoded to right padded [0u8; ((N + 31) / 32) * 32].
    FixedBytes(ManagedByteArray<M, 32>),
    /// Vector of bytes of unknown size.
    ///
    /// solidity name: bytes
    /// Encoded in two parts.
    /// Init part: offset of 'closing part`.
    /// Closing part: encoded length followed by encoded right padded bytes.
    Bytes(ManagedBuffer<M>),
    // Signed integer.
    //
    // solidity name: int
    // Int(BigUint<M>),
    // Unsigned integer.
    //
    // solidity name: uint
    Uint(BigUint<M>),
    // Boolean value.
    //
    // solidity name: bool
    // Encoded as left padded [0u8; 32], where last bit represents boolean value.
    // Bool(bool),
    // String.
    //
    // solidity name: string
    // Encoded in the same way as bytes. Must be utf8 compliant.
    // String(ManagedBuffer<M>),
    // Array with known size.
    //
    // solidity name eg.: int[3], bool[3], address[][8]
    // Encoding of array is equal to encoding of consecutive elements of array.
    // FixedArray(ManagedVec<M, Token<M>>),
    // Array of params with unknown size.
    //
    // solidity name eg. int[], bool[], address[5][]
    // Array(ManagedVec<M, Token<M>>),
    // Tuple of params of variable types.
    //
    // solidity name: tuple
    // Tuple(ManagedVec<M, Token<M>>),
}

#[derive(Debug)]
enum Mediate<'a, M: ManagedTypeApi> {
    // head
    Raw(u32, &'a Token<M>),
    // RawArray(ManagedVec<M, Mediate<'a, M>>),

    // head + tail
    Prefixed(u32, &'a Token<M>),
    // PrefixedArray(ManagedVec<M, Mediate<'a, M>>),
    // PrefixedArrayWithLength(ManagedVec<M, Mediate<'a, M>>),
}

impl<M: ManagedTypeApi> Mediate<'_, M> {
    fn head_len(&self) -> u32 {
        match self {
            Mediate::Raw(len, _) => 32 * len,
            // Mediate::RawArray(ref mediates) => mediates.iter().map(|mediate| mediate.head_len()).sum(),
            // Mediate::Prefixed(_, _) | Mediate::PrefixedArray(_) | Mediate::PrefixedArrayWithLength(_) => 32,
            Mediate::Prefixed(_, _) => 32,
        }
    }

    fn tail_len(&self) -> u32 {
        match self {
            // Mediate::Raw(_, _) | Mediate::RawArray(_) => 0,
            Mediate::Raw(_, _) => 0,
            Mediate::Prefixed(len, _) => 32 * len,
            // Mediate::PrefixedArray(ref mediates) => mediates.iter().fold(0, |acc, m| acc + m.head_len() + m.tail_len()),
            // Mediate::PrefixedArrayWithLength(ref mediates) => {
            //     mediates.iter().fold(32, |acc, m| acc + m.head_len() + m.tail_len())
            // }
        }
    }

    fn head_append(&self, acc: &mut ManagedBuffer<M>, suffix_offset: u32) {
        match *self {
            Mediate::Raw(_, raw) => encode_token_append(acc, raw),
            // Mediate::RawArray(ref raw) => raw.iter().for_each(|mediate| mediate.head_append(acc, 0)),
            // Mediate::Prefixed(_, _) | Mediate::PrefixedArray(_) | Mediate::PrefixedArrayWithLength(_) => {
            Mediate::Prefixed(_, _) => {
                acc.append_bytes(&pad_u32(suffix_offset))
            }
        }
    }

    fn tail_append(&self, acc: &mut ManagedBuffer<M>) {
        match *self {
            // Mediate::Raw(_, _) | Mediate::RawArray(_) => {}
            Mediate::Prefixed(_, raw) => encode_token_append(acc, raw),
            // Mediate::PrefixedArray(ref mediates) => encode_head_tail_append(acc, mediates),
            // Mediate::PrefixedArrayWithLength(ref mediates) => {
            //     // + 32 added to offset represents len of the array prepended to tail
            //     acc.push(pad_u32(mediates.len() as u32));
            //     encode_head_tail_append(acc, mediates);
            // }
            _ => {}
        };
    }
}

fn mediate_token<M: ManagedTypeApi>(token: &Token<M>) -> Mediate<M> {
    match token {
        // Token::Address(_) => Mediate::Raw(1, token),
        Token::Bytes(bytes) => Mediate::Prefixed(pad_bytes_len(bytes), token),
        // Token::String(s) => Mediate::Prefixed(pad_bytes_len(s), token),
        // Token::FixedBytes(bytes) => Mediate::Raw(fixed_bytes_len(bytes), token),
        Token::FixedBytes(bytes) => Mediate::Raw(1, token),
        // Token::Int(_) | Token::Uint(_) | Token::Bool(_) => Mediate::Raw(1, token),
        Token::Uint(_) => Mediate::Raw(1, token),
        // Token::Array(ref tokens) => {
        //     let mediates = tokens.iter().map(mediate_token).collect();
        //
        //     Mediate::PrefixedArrayWithLength(mediates)
        // }
        // Token::FixedArray(ref tokens) | Token::Tuple(ref tokens) => {
        //     let mediates = tokens.iter().map(mediate_token).collect();
        //
        //     if token.is_dynamic() {
        //         Mediate::PrefixedArray(mediates)
        //     } else {
        //         Mediate::RawArray(mediates)
        //     }
        // }
    }
}

fn encode_token_append<M: ManagedTypeApi>(data: &mut ManagedBuffer<M>, token: &Token<M>) {
    match token {
        // Token::Address(ref address) => {
        //     let mut padded = [0u8; 32];
        //     padded[12..].copy_from_slice(address.as_ref());
        //     data.push(padded);
        // }
        Token::Bytes(bytes) => pad_bytes_append(data, bytes),
        // Token::String(ref s) => pad_bytes_append(data, s.as_bytes()),
        Token::FixedBytes(bytes) => fixed_bytes_append(data, bytes),
        // Token::Int(int) => data.push(int.into()),
        // Token::Uint(uint) => data.push(uint.into()), TODO
        Token::Uint(_) => {}
        // Token::Bool(b) => {
        //     let mut value = [0u8; 32];
        //     if b {
        //         value[31] = 1;
        //     }
        //     data.push(value);
        // }
        // _ => panic!("Unhandled nested token: {:?}", token),
    };
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

fn fixed_bytes_append<M: ManagedTypeApi>(result: &mut ManagedBuffer<M>, bytes: &ManagedByteArray<M, 32>) {
    // let len = (bytes.len() + 31) / 32;
    // for i in 0..len {
    //     let mut padded = [0u8; 32];
    //
    //     let to_copy = match i == len - 1 {
    //         false => 32,
    //         true => match bytes.len() % 32 {
    //             0 => 32,
    //             x => x,
    //         },
    //     };
    //
    //     let offset = 32 * i;
    //     padded[..to_copy].copy_from_slice(&bytes[offset..offset + to_copy]);
    //     result.append_bytes(&padded);
    // }
    result.append(bytes.as_managed_buffer());
}



/// Encodes vector of tokens into ABI compliant vector of bytes.
pub fn encode<M: ManagedTypeApi>(tokens: &[Token<M>]) -> ManagedBuffer<M> {
    let mediates = &tokens.iter().map(mediate_token::<M>).collect::<Vec<_>>();

    encode_head_tail(mediates)
}

fn encode_head_tail<M: ManagedTypeApi>(mediates: &[Mediate<M>]) -> ManagedBuffer<M> {
    let (heads_len, tails_len) =
        mediates.iter().fold((0, 0), |(head_acc, tail_acc), m| (head_acc + m.head_len(), tail_acc + m.tail_len()));

    let mut result = ManagedBuffer::new_random((heads_len + tails_len) as usize);
    encode_head_tail_append(&mut result, mediates);

    result
}

fn encode_head_tail_append<M: ManagedTypeApi>(acc: &mut ManagedBuffer<M>, mediates: &[Mediate<M>]) {
    let heads_len = mediates.iter().fold(0, |head_acc, m| head_acc + m.head_len());

    let mut offset = heads_len;
    for mediate in mediates {
        mediate.head_append(acc, offset);
        offset += mediate.tail_len();
    }

    // mediates.iter().for_each(|m| m.tail_append(acc));
}
