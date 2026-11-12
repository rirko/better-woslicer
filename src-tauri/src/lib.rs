//! Offline native capabilities; all audio processing remains in the application.

mod clipboard;
mod files;
mod session;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, webview::NewWindowResponse};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum ColorMode {
    Light,
    Dark,
}

#[tauri::command]
fn set_theme(mode: ColorMode, window: tauri::WebviewWindow) -> Result<(), String> {
    let theme = match mode {
        ColorMode::Light => tauri::Theme::Light,
        ColorMode::Dark => tauri::Theme::Dark,
    };
    window
        .set_theme(Some(theme))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn build_identity() -> Result<serde_json::Value, String> {
    serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/build-info.json")))
        .map_err(|error| error.to_string())
}

fn allowed_navigation(url: &tauri::Url) -> bool {
    let local = url.port().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost")));
    let development = cfg!(dev)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(1420);
    (local || development)
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.path(), "/" | "/index.html")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(clipboard::NativeClipboard::default())
        .invoke_handler(tauri::generate_handler![
            files::open_file,
            files::reopen_file,
            files::close_reader,
            files::read_file_chunk,
            files::prepare_save,
            files::begin_export,
            files::begin_export_file,
            files::write_chunk,
            files::finish_write,
            files::cancel_write,
            files::end_export,
            clipboard::read_clipboard,
            clipboard::write_clipboard,
            session::read_session,
            session::write_session,
            session::clear_session,
            session::import_legacy_session,
            set_theme,
            build_identity,
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(files::HostFiles::load(&data_dir)?);
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title(app.package_info().name.clone())
                    .inner_size(1440.0, 900.0)
                    .min_inner_size(960.0, 600.0)
                    .on_navigation(allowed_navigation)
                    .on_new_window(|_, _| NewWindowResponse::Deny)
                    .on_page_load(|window, payload| {
                        if payload.event() == tauri::webview::PageLoadEvent::Started {
                            window.state::<files::HostFiles>().reset_transfers();
                        }
                    })
                    .build()?;
            window.show()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run the offline desktop host");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_is_confined_to_the_editor() -> Result<(), Box<dyn std::error::Error>> {
        for url in ["tauri://localhost/index.html", "http://tauri.localhost/"] {
            assert!(allowed_navigation(&url.parse()?), "{url}");
        }
        for url in [
            "https://example.org",
            "http://127.0.0.1:4444/",
            "http://tauri.localhost:4444/",
            "file:///C:/private.txt",
            "http://tauri.localhost/other.html",
            "tauri://user@localhost/",
        ] {
            assert!(!allowed_navigation(&url.parse()?), "{url}");
        }
        assert_eq!(
            allowed_navigation(&"http://127.0.0.1:1420/".parse()?),
            cfg!(dev)
        );
        Ok(())
    }
}
