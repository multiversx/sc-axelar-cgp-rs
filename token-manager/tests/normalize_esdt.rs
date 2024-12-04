use multiversx_sc::types::ManagedBuffer;
use multiversx_sc_scenario::api::StaticApi;
use token_manager::constants::ManagedBufferAscii;

#[test]
fn normalize_token_name() {
    let name: ManagedBuffer<StaticApi> = ManagedBuffer::from("Name With Spaces 1");
    let expected = ManagedBuffer::from("NameWithSpaces1");

    assert_eq!(name.to_normalized_token_name(), expected);

    let name: ManagedBuffer<StaticApi> = ManagedBuffer::from("Name With Spaces Too Long");
    let expected = ManagedBuffer::from("NameWithSpacesTooLon");

    assert_eq!(name.to_normalized_token_name(), expected);

    // Name too short
    let name: ManagedBuffer<StaticApi> = ManagedBuffer::from("S");
    let expected = ManagedBuffer::from("S00");

    assert_eq!(name.to_normalized_token_name(), expected);

    let name: ManagedBuffer<StaticApi> = ManagedBuffer::from("Sh");
    let expected = ManagedBuffer::from("Sh0");

    assert_eq!(name.to_normalized_token_name(), expected);
}

#[test]
fn normalize_token_ticker() {
    let name: ManagedBuffer<StaticApi> = ManagedBuffer::from("Ticker With Other 1");
    let expected = ManagedBuffer::from("TICKERWITH");

    assert_eq!(name.to_normalized_token_ticker(), expected);

    let name: ManagedBuffer<StaticApi> = ManagedBuffer::from("TICKER TOO LONG");
    let expected = ManagedBuffer::from("TICKERTOOL");

    assert_eq!(name.to_normalized_token_ticker(), expected);

    // Ticker too short
    let name: ManagedBuffer<StaticApi> = ManagedBuffer::from("S");
    let expected = ManagedBuffer::from("S00");

    assert_eq!(name.to_normalized_token_ticker(), expected);

    let name: ManagedBuffer<StaticApi> = ManagedBuffer::from("Sh");
    let expected = ManagedBuffer::from("SH0");

    assert_eq!(name.to_normalized_token_ticker(), expected);
}
