//! Desktop entry point. The host itself lives in the library so the same
//! builder can serve other Tauri targets (see lib.rs).
// Prevents an additional console window on Windows in release; do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run()
}
