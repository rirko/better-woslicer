//! Local JSON persistence. Session contents never grant filesystem access.
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

const MAX_SESSION_BYTES: u64 = 16 * 1024 * 1024;

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("missing data directory")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}
fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("session-v2.json"))
}
fn read_json(path: &Path) -> Result<Value, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    if !file
        .metadata()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("expected a regular JSON file".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_SESSION_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_SESSION_BYTES {
        return Err("session exceeds 16 MiB".into());
    }
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) fn read_session(app: AppHandle) -> Result<Value, String> {
    let path = session_path(&app)?;
    if !path.try_exists().map_err(|error| error.to_string())? {
        return Ok(Value::Null);
    }
    read_json(&path)
}
#[tauri::command]
pub(crate) fn write_session(snapshot: Value, app: AppHandle) -> Result<(), String> {
    let bytes = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_SESSION_BYTES {
        return Err("session exceeds 16 MiB".into());
    }
    atomic_write(&session_path(&app)?, &bytes)
}
#[tauri::command]
pub(crate) fn clear_session(app: AppHandle) -> Result<(), String> {
    match fs::remove_file(session_path(&app)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
#[tauri::command]
pub(crate) async fn import_legacy_session() -> Result<Option<Value>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("Legacy session", &["json"])
        .set_file_name("legacy-session-v1.json")
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    // The workspace validates the envelope and data. No embedded path is opened here.
    read_json(file.path()).map(Some)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_json_is_data_only_and_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("legacy-session-v1.json");
        let envelope = serde_json::json!({"version":1,"session":{"path":"C:/private.wav"},"preferences":{"theme":null,"language":"ja"}});
        atomic_write(&path, &serde_json::to_vec(&envelope)?)?;
        assert_eq!(read_json(&path)?, envelope);
        assert_eq!(fs::read_dir(directory.path())?.count(), 1);
        atomic_write(&path, b"broken json")?;
        assert!(read_json(&path).is_err());
        Ok(())
    }
}
