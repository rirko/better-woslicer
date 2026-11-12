use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("cargo manifest directory"))
        .parent()
        .expect("repository parent")
        .to_path_buf();
    let status = Command::new("node")
        .arg(root.join("scripts/tauri-build-info.mjs"))
        .arg("--check")
        .status()
        .expect("Node.js is required to validate the build identity");
    assert!(
        status.success(),
        "run node scripts/tauri-build-info.mjs before Cargo"
    );
    let info = fs::read_to_string(root.join("src-tauri/generated/build-info.json"))
        .expect("generated build identity");
    let parsed: serde_json::Value = serde_json::from_str(&info).expect("valid generated identity");
    let version = parsed["version"].as_str().expect("application version");
    println!("cargo:rustc-env=WOSLICER_VERSION={version}");
    println!("cargo:rerun-if-changed=../package.json");
    println!("cargo:rerun-if-changed=generated/build-info.json");
    println!("cargo:rerun-if-changed=../scripts/tauri-build-info.mjs");
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").expect("cargo output directory"))
            .join("build-info.json"),
        info,
    )
    .expect("bundle build identity");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_file",
            "reopen_file",
            "begin_read",
            "close_reader",
            "read_file_chunk",
            "prepare_save",
            "begin_export",
            "begin_export_file",
            "write_chunk",
            "finish_write",
            "cancel_write",
            "end_export",
            "read_clipboard",
            "write_clipboard",
            "read_session",
            "write_session",
            "clear_session",
            "import_legacy_session",
            "set_theme",
            "build_identity",
        ]),
    ))
    .expect("Tauri build configuration");
}
