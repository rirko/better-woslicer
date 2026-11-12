//! Dialog-granted file references and bounded, atomic binary transfers.
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    State,
    ipc::{InvokeBody, Request, Response},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub(crate) const CHUNK_BYTES: usize = 1024 * 1024;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_PROJECT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_REFERENCES: usize = 1024;
const MAX_OPEN_READERS: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum FileKind {
    Audio,
    Wos,
    Wosdx,
    Midi,
    Bmh,
    Wav,
}
impl FileKind {
    fn extensions(&self) -> &[&str] {
        match self {
            Self::Audio => &["wav", "ogg"],
            Self::Wos => &["wos"],
            Self::Wosdx => &["wosdx"],
            Self::Midi => &["mid", "midi"],
            Self::Bmh => &["bmh"],
            Self::Wav => &["wav"],
        }
    }
    fn accepts(&self, path: &Path) -> bool {
        path.extension()
            .and_then(|v| v.to_str())
            .is_some_and(|extension| {
                self.extensions()
                    .iter()
                    .any(|candidate| extension.eq_ignore_ascii_case(candidate))
            })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenedFile {
    name: String,
    reference: String,
    size: u64,
}
#[derive(Debug)]
struct PendingWrite {
    temporary: NamedTempFile,
    destination: PathBuf,
    expected: u64,
    written: u64,
}
#[derive(Debug)]
struct Export {
    id: String,
    directory: PathBuf,
    names: HashSet<String>,
}
#[derive(Debug, Default)]
struct Files {
    references: HashMap<String, PathBuf>,
    readers: HashMap<String, File>,
    writes: HashMap<String, PendingWrite>,
    export: Option<Export>,
}
#[derive(Debug)]
pub(crate) struct HostFiles {
    inner: Mutex<Files>,
    grants_path: PathBuf,
}

impl HostFiles {
    pub(crate) fn load(directory: &Path) -> std::io::Result<Self> {
        let grants_path = directory.join("file-grants.json");
        let references = match File::open(&grants_path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(CHUNK_BYTES as u64 + 1).read_to_end(&mut bytes)?;
                if bytes.len() <= CHUNK_BYTES {
                    serde_json::from_slice::<HashMap<String, PathBuf>>(&bytes)
                        .ok()
                        .filter(|grants| grants.len() <= MAX_REFERENCES)
                        .unwrap_or_default()
                } else {
                    HashMap::new()
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => return Err(error),
        };
        Ok(Self {
            inner: Mutex::new(Files {
                references,
                ..Files::default()
            }),
            grants_path,
        })
    }
    fn grant(&self, path: &Path) -> Result<OpenedFile, String> {
        let path = path.canonicalize().map_err(message)?;
        let file = File::open(&path).map_err(message)?;
        let mut files = self.inner.lock().expect("file state lock poisoned");
        let reference = files
            .references
            .iter()
            .find(|(_, old)| **old == path)
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if files.references.len() >= MAX_REFERENCES && !files.references.contains_key(&reference) {
            return Err("too many saved file grants".into());
        }
        let descriptor = descriptor(&path, &reference, &file)?;
        files.references.insert(reference.clone(), path);
        let json = serde_json::to_vec(&files.references).map_err(message)?;
        super::session::atomic_write(&self.grants_path, &json)?;
        Ok(descriptor)
    }
    fn reopen(&self, reference: &str) -> Result<OpenedFile, String> {
        let files = self.inner.lock().expect("file state lock poisoned");
        let path = files
            .references
            .get(reference)
            .ok_or("unknown file reference; select the file again")?;
        if path.canonicalize().map_err(message)? != *path {
            return Err("the selected file was redirected; select it again".into());
        }
        descriptor(path, reference, &File::open(path).map_err(message)?)
    }
    /// Opens one independent transfer reader per call; concurrent transfers of
    /// the same reference keep their own handles and seek positions.
    fn begin_read(&self, reference: &str) -> Result<String, String> {
        let mut files = self.inner.lock().expect("file state lock poisoned");
        let path = files
            .references
            .get(reference)
            .ok_or("unknown file reference; select the file again")?;
        let file = File::open(path).map_err(message)?;
        if files.readers.len() >= MAX_OPEN_READERS {
            return Err(
                "too many concurrent file readers; finish or cancel the open transfers".into(),
            );
        }
        let transfer = Uuid::new_v4().to_string();
        files.readers.insert(transfer.clone(), file);
        Ok(transfer)
    }
    fn start_write(&self, destination: PathBuf, size: u64) -> Result<String, String> {
        let mut files = self.inner.lock().expect("file state lock poisoned");
        if files.export.is_some() {
            return Err("an export is active".into());
        }
        start_write(&mut files, destination, size)
    }
    pub(crate) fn reset_transfers(&self) {
        let mut files = self.inner.lock().expect("file state lock poisoned");
        files.writes.clear();
        files.readers.clear();
        files.export = None;
    }
}
fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn descriptor(path: &Path, reference: &str, file: &File) -> Result<OpenedFile, String> {
    let metadata = file.metadata().map_err(message)?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("file is not a regular file or exceeds 2 GiB".into());
    }
    if FileKind::Wosdx.accepts(path) && metadata.len() > MAX_PROJECT_BYTES {
        return Err("project exceeds 16 MiB".into());
    }
    let name = path
        .file_name()
        .ok_or("missing file name")?
        .to_string_lossy()
        .into_owned();
    Ok(OpenedFile {
        name,
        reference: reference.into(),
        size: metadata.len(),
    })
}
fn start_write(files: &mut Files, destination: PathBuf, size: u64) -> Result<String, String> {
    if FileKind::Wosdx.accepts(&destination) && size > MAX_PROJECT_BYTES {
        return Err("project exceeds 16 MiB".into());
    }
    if size > MAX_FILE_BYTES {
        return Err("output exceeds 2 GiB".into());
    }
    if !files.writes.is_empty() {
        return Err("another output is still being written".into());
    }
    let parent = destination.parent().ok_or("missing output directory")?;
    let temporary = NamedTempFile::new_in(parent).map_err(message)?;
    let id = Uuid::new_v4().to_string();
    files.writes.insert(
        id.clone(),
        PendingWrite {
            temporary,
            destination,
            expected: size,
            written: 0,
        },
    );
    Ok(id)
}

pub(crate) fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 240
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err("output must have a plain, portable file name".into());
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
        })
    {
        return Err("reserved output file name".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_file(
    kind: FileKind,
    state: State<'_, HostFiles>,
) -> Result<Option<OpenedFile>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("Supported files", kind.extensions())
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    if !kind.accepts(file.path()) {
        return Err("unsupported file extension".into());
    }
    state.grant(file.path()).map(Some)
}
#[tauri::command]
pub(crate) fn reopen_file(
    reference: String,
    state: State<'_, HostFiles>,
) -> Result<OpenedFile, String> {
    state.reopen(&reference)
}
/// Opens one bounded transfer reader for an existing grant reference.
#[tauri::command]
pub(crate) fn begin_read(reference: String, state: State<'_, HostFiles>) -> Result<String, String> {
    state.begin_read(&reference)
}
/// Releases one transfer's reader; other transfers, including concurrent
/// transfers of the same reference, are unaffected.
#[tauri::command]
pub(crate) fn close_reader(transfer: String, state: State<'_, HostFiles>) {
    state
        .inner
        .lock()
        .expect("file state lock poisoned")
        .readers
        .remove(&transfer);
}
#[tauri::command]
pub(crate) fn read_file_chunk(
    transfer: String,
    offset: u64,
    length: usize,
    state: State<'_, HostFiles>,
) -> Result<Response, String> {
    if length == 0 || length > CHUNK_BYTES {
        return Err("invalid read chunk size".into());
    }
    let mut files = state.inner.lock().expect("file state lock poisoned");
    let file = files.readers.get_mut(&transfer).ok_or("file is not open")?;
    let size = file.metadata().map_err(message)?.len();
    if offset > size || size > MAX_FILE_BYTES {
        return Err("read outside selected file".into());
    }
    let count = usize::try_from((size - offset).min(length as u64)).map_err(message)?;
    let mut bytes = vec![0; count];
    file.seek(SeekFrom::Start(offset)).map_err(message)?;
    file.read_exact(&mut bytes).map_err(message)?;
    Ok(Response::new(bytes))
}
#[tauri::command]
pub(crate) async fn prepare_save(
    kind: FileKind,
    name: String,
    size: u64,
    state: State<'_, HostFiles>,
) -> Result<Option<String>, String> {
    validate_name(&name)?;
    if matches!(kind, FileKind::Audio) {
        return Err("audio sources cannot be overwritten".into());
    }
    if matches!(kind, FileKind::Wosdx) && size > MAX_PROJECT_BYTES {
        return Err("project exceeds 16 MiB".into());
    }
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("Output", kind.extensions())
        .set_file_name(&name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    if !kind.accepts(file.path()) {
        return Err("unsupported output extension".into());
    }
    state.start_write(file.path().to_path_buf(), size).map(Some)
}
#[tauri::command]
pub(crate) async fn begin_export(state: State<'_, HostFiles>) -> Result<Option<String>, String> {
    let Some(directory) = rfd::AsyncFileDialog::new().pick_folder().await else {
        return Ok(None);
    };
    let directory = directory.path().canonicalize().map_err(message)?;
    let mut files = state.inner.lock().expect("file state lock poisoned");
    if files.export.is_some() || !files.writes.is_empty() {
        return Err("another export is active".into());
    }
    let id = Uuid::new_v4().to_string();
    files.export = Some(Export {
        id: id.clone(),
        directory,
        names: HashSet::new(),
    });
    Ok(Some(id))
}
#[tauri::command]
pub(crate) async fn begin_export_file(
    export_id: String,
    name: String,
    size: u64,
    state: State<'_, HostFiles>,
) -> Result<String, String> {
    validate_name(&name)?;
    let destination = {
        let files = state.inner.lock().expect("file state lock poisoned");
        let export = files
            .export
            .as_ref()
            .filter(|export| export.id == export_id)
            .ok_or("unknown export")?;
        if export.names.contains(&name.to_lowercase()) {
            return Err("duplicate export file name".into());
        }
        export.directory.join(&name)
    };
    if destination.exists() {
        let answer = rfd::AsyncMessageDialog::new()
            .set_title("Replace file?")
            .set_description(format!("Replace {name} in the selected folder?"))
            .set_buttons(rfd::MessageButtons::YesNo)
            .show()
            .await;
        if answer != rfd::MessageDialogResult::Yes {
            return Err("export cancelled; existing file was kept".into());
        }
    }
    let mut files = state.inner.lock().expect("file state lock poisoned");
    let export = files
        .export
        .as_mut()
        .filter(|export| export.id == export_id)
        .ok_or("export ended")?;
    if export.directory.canonicalize().map_err(message)? != export.directory {
        return Err("export directory was redirected".into());
    }
    export.names.insert(name.to_lowercase());
    start_write(&mut files, destination, size)
}
#[tauri::command]
pub(crate) fn write_chunk(request: Request<'_>, state: State<'_, HostFiles>) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-write-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing write reference")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw binary bytes".into());
    };
    append_chunk(
        &mut state.inner.lock().expect("file state lock poisoned"),
        id,
        bytes,
    )
}
fn append_chunk(files: &mut Files, id: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > CHUNK_BYTES {
        return Err("invalid write chunk size".into());
    }
    let pending = files.writes.get_mut(id).ok_or("unknown write reference")?;
    let next = pending
        .written
        .checked_add(bytes.len() as u64)
        .filter(|next| *next <= pending.expected)
        .ok_or("write exceeds declared output size")?;
    pending.temporary.write_all(bytes).map_err(message)?;
    pending.written = next;
    Ok(())
}
#[tauri::command]
pub(crate) fn finish_write(id: String, state: State<'_, HostFiles>) -> Result<(), String> {
    finish(
        &mut state.inner.lock().expect("file state lock poisoned"),
        &id,
    )
}
fn finish(files: &mut Files, id: &str) -> Result<(), String> {
    let pending = files.writes.remove(id).ok_or("unknown write reference")?;
    if pending.written != pending.expected {
        return Err("incomplete output; original file was kept".into());
    }
    pending.temporary.as_file().sync_all().map_err(message)?;
    pending
        .temporary
        .persist(pending.destination)
        .map_err(message)?;
    Ok(())
}
#[tauri::command]
pub(crate) fn cancel_write(id: String, state: State<'_, HostFiles>) {
    state
        .inner
        .lock()
        .expect("file state lock poisoned")
        .writes
        .remove(&id);
}
#[tauri::command]
pub(crate) fn end_export(id: String, state: State<'_, HostFiles>) -> Result<(), String> {
    let mut files = state.inner.lock().expect("file state lock poisoned");
    if !files.export.as_ref().is_some_and(|export| export.id == id) {
        return Err("unknown export".into());
    }
    files.writes.clear();
    files.export = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn project_files_are_bounded_before_transfer() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("project.WOSDX");
        assert!(FileKind::Wosdx.accepts(&path));
        let file = File::create(&path)?;
        file.set_len(MAX_PROJECT_BYTES + 1)?;
        assert!(descriptor(&path, "grant", &file).is_err());
        file.set_len(MAX_PROJECT_BYTES)?;
        assert_eq!(descriptor(&path, "grant", &file)?.size, MAX_PROJECT_BYTES);
        let mut files = Files::default();
        assert!(start_write(&mut files, path, MAX_PROJECT_BYTES + 1).is_err());
        assert!(files.writes.is_empty());
        Ok(())
    }

    #[test]
    fn renderer_reload_discards_temporary_writes() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let state = HostFiles::load(directory.path())?;
        let target = directory.path().join("slice.wav");
        fs::write(&target, b"original")?;
        let id = state.start_write(target.clone(), 3)?;
        append_chunk(
            &mut state.inner.lock().expect("test state lock poisoned"),
            &id,
            &[0, 1],
        )?;
        state.reset_transfers();
        assert_eq!(fs::read(&target)?, b"original");
        assert_eq!(fs::read_dir(directory.path())?.count(), 1);
        assert!(state.start_write(target, 0).is_ok());
        Ok(())
    }
    #[test]
    fn rejects_paths_reserved_names_and_streams() {
        for name in [
            "../escape.wav",
            "a/b.wav",
            "a\\b.wav",
            "C:escape.wav",
            "a:stream",
            "NUL.wav",
            "COM1",
            "bad. ",
            "",
            ".",
            "..",
        ] {
            assert!(validate_name(name).is_err(), "{name}");
        }
        for name in ["slice-001.wav", "音声.wav", "COM10.wav"] {
            assert!(validate_name(name).is_ok(), "{name}");
        }
    }
    #[test]
    fn writes_exact_binary_and_preserves_original_on_failure()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let destination = directory.path().join("out.wav");
        fs::write(&destination, b"original")?;
        let mut files = Files::default();
        let id = start_write(&mut files, destination.clone(), 4)?;
        append_chunk(&mut files, &id, &[0, 255])?;
        assert!(finish(&mut files, &id).is_err());
        assert_eq!(fs::read(&destination)?, b"original");
        let id = start_write(&mut files, destination.clone(), 4)?;
        assert!(append_chunk(&mut files, &id, &[1; 5]).is_err());
        append_chunk(&mut files, &id, &[0, 255, 128, 1])?;
        finish(&mut files, &id)?;
        assert_eq!(fs::read(destination)?, [0, 255, 128, 1]);
        assert!(files.writes.is_empty());
        Ok(())
    }
    #[test]
    fn only_dialog_grants_can_reopen_and_survive_restart() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let file = directory.path().join("audio.wav");
        fs::write(&file, [0, 1, 2])?;
        let state = HostFiles::load(directory.path())?;
        assert!(state.reopen(&file.to_string_lossy()).is_err());
        let opened = state.grant(&file)?;
        assert_eq!(opened.size, 3);
        let reloaded = HostFiles::load(directory.path())?;
        assert_eq!(reloaded.reopen(&opened.reference)?.name, "audio.wav");
        assert!(reloaded.reopen("fabricated-reference").is_err());
        Ok(())
    }
    #[test]
    fn concurrent_readers_survive_independent_opens_and_closes()
    -> Result<(), Box<dyn std::error::Error>> {
        fn read_chunk(
            state: &HostFiles,
            transfer: &str,
            offset: u64,
            length: usize,
        ) -> Result<Vec<u8>, String> {
            let mut files = state.inner.lock().expect("test state lock poisoned");
            let file = files.readers.get_mut(transfer).ok_or("file is not open")?;
            let mut bytes = vec![0u8; length];
            file.seek(SeekFrom::Start(offset))
                .map_err(|e| e.to_string())?;
            file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
            Ok(bytes)
        }
        let directory = tempfile::tempdir()?;
        let first = directory.path().join("first.wav");
        let second = directory.path().join("second.wav");
        fs::write(&first, [0, 1, 2])?;
        fs::write(&second, [4, 5, 6])?;
        let state = HostFiles::load(directory.path())?;
        let opened_first = state.grant(&first)?;
        let opened_second = state.grant(&second)?;
        let transfer_first = state.begin_read(&opened_first.reference)?;
        let transfer_second = state.begin_read(&opened_second.reference)?;
        // Reading one transfer must not disturb another transfer's seek position.
        assert_eq!(read_chunk(&state, &transfer_first, 1, 2)?, vec![1, 2]);
        assert_eq!(read_chunk(&state, &transfer_second, 0, 1)?, vec![4]);
        // Closing the second transfer leaves the first readable.
        state
            .inner
            .lock()
            .expect("test state lock poisoned")
            .readers
            .remove(&transfer_second);
        assert_eq!(read_chunk(&state, &transfer_first, 0, 3)?, vec![0, 1, 2]);
        assert!(read_chunk(&state, &transfer_second, 0, 1).is_err());
        Ok(())
    }
    #[test]
    fn same_reference_transfers_keep_independent_handles() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = tempfile::tempdir()?;
        let file = directory.path().join("audio.wav");
        fs::write(&file, [0, 1, 2, 3])?;
        let state = HostFiles::load(directory.path())?;
        let opened = state.grant(&file)?;
        let early = state.begin_read(&opened.reference)?;
        let late = state.begin_read(&opened.reference)?;
        {
            let mut files = state.inner.lock().expect("test state lock poisoned");
            files
                .readers
                .get_mut(&early)
                .ok_or("missing transfer")?
                .seek(SeekFrom::Start(2))
                .map_err(|e| e.to_string())?;
        }
        // The later transfer's seek position is unaffected by the earlier one.
        let mut bytes = [0u8; 1];
        {
            let mut files = state.inner.lock().expect("test state lock poisoned");
            let handle = files.readers.get_mut(&late).ok_or("missing transfer")?;
            handle.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            handle.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        }
        assert_eq!(bytes, [0]);
        // Finishing the earlier transfer must not close the later one's reader.
        state
            .inner
            .lock()
            .expect("test state lock poisoned")
            .readers
            .remove(&early);
        assert!(state.begin_read(&opened.reference).is_ok());
        Ok(())
    }
    #[test]
    fn grants_reuse_references_and_honor_the_persisted_cap()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let state = HostFiles::load(directory.path())?;
        let first = directory.path().join("first.wav");
        fs::write(&first, [0])?;
        let opened = state.grant(&first)?;
        let reused = state.grant(&first)?;
        assert_eq!(reused.reference, opened.reference);
        {
            let files = state.inner.lock().expect("test state lock poisoned");
            assert_eq!(files.references.len(), 1);
        }
        let mut last = None;
        for index in 1..MAX_REFERENCES {
            let path = directory.path().join(format!("audio-{index}.wav"));
            fs::write(&path, [0])?;
            last = Some(state.grant(&path)?.reference);
        }
        let extra = directory.path().join("extra.wav");
        fs::write(&extra, [0])?;
        assert!(state.grant(&extra).is_err());
        {
            let files = state.inner.lock().expect("test state lock poisoned");
            assert_eq!(files.references.len(), MAX_REFERENCES);
        }
        // Existing grants stay reopenable at the cap.
        assert_eq!(
            state.reopen(&last.expect("granted reference"))?.name,
            format!("audio-{}.wav", MAX_REFERENCES - 1)
        );
        Ok(())
    }
    #[test]
    fn bounds_chunks_and_concurrent_writes() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let mut files = Files::default();
        let destination = directory.path().join("out.wav");
        assert!(start_write(&mut files, destination.clone(), MAX_FILE_BYTES + 1).is_err());
        let id = start_write(&mut files, destination.clone(), CHUNK_BYTES as u64 + 1)?;
        assert!(start_write(&mut files, destination, 0).is_err());
        assert!(append_chunk(&mut files, &id, &vec![0; CHUNK_BYTES + 1]).is_err());
        assert!(append_chunk(&mut files, "other", &[1]).is_err());
        files.writes.remove(&id);
        assert_eq!(fs::read_dir(directory.path())?.count(), 0);
        Ok(())
    }
}
