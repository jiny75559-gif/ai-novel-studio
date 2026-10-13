use novel_studio_lib::updates::*;
#[test]
fn signed_manifest_and_package_validate_but_tampering_is_rejected() {
    let bytes = include_bytes!("fixtures/update/manifest.json");
    let sig = include_str!("fixtures/update/manifest.json.sig");
    let key = include_str!("../src/update-public-key.txt");
    let m = verify_manifest(bytes, sig, key).unwrap();
    verify_package(&m, include_bytes!("fixtures/update/fixture.bin")).unwrap();
    let tampered = String::from_utf8(bytes.to_vec())
        .unwrap()
        .replace("0.0.0", "99.0.0");
    assert_eq!(
        verify_manifest(tampered.as_bytes(), sig, key)
            .err()
            .unwrap()
            .code,
        "UPDATE_SIGNATURE"
    );
    assert_eq!(
        verify_package(&m, b"MZbad").err().unwrap().code,
        "UPDATE_CHECKSUM"
    );
    assert!(verify_manifest(bytes, "bad-signature", key).is_err());
}
#[test]
fn repository_names_are_normalized_and_reject_unrelated_endpoints() {
    assert_eq!(
        repository(" https://github.com/jiny75559-gif/ai-novel-studio.git ").unwrap(),
        DEFAULT_REPOSITORY
    );
    for value in [
        "../../repo",
        "https://evil.invalid/a/b",
        "owner/repo?token=secret",
        "owner",
        "owner/repo/extra",
    ] {
        assert!(repository(value).is_err());
    }
}
