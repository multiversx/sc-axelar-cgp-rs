multiversx_sc::imports!();
multiversx_sc::derive_imports!();

#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode)]
pub struct Call {

}

#[type_abi]
#[derive(TopEncode, TopDecode)]
pub struct DestinationCalls<M: ManagedTypeApi> {
    calls: ManagedVec<M, Call>,
    refund_recipient: ManagedAddress<M>,
}
