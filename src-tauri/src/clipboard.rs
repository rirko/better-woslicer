//! BMSE bytes and plain text are published in one native clipboard transaction.
use clipboard_rs::{Clipboard, ClipboardContent, ClipboardContext};
use std::sync::Mutex;
use tauri::State;

const BMSE_FORMAT: &str = "BMSE ClipBoard Object Data Format";
const MAX_CLIPBOARD_BYTES: usize = 16 * 1024 * 1024;

#[derive(Default)]
pub(crate) struct NativeClipboard(Mutex<Option<ClipboardContext>>);
impl std::fmt::Debug for NativeClipboard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeClipboard").finish_non_exhaustive()
    }
}
impl NativeClipboard {
    fn with_context<T>(
        &self,
        action: impl FnOnce(&ClipboardContext) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut context = self.0.lock().expect("clipboard lock poisoned");
        if context.is_none() {
            *context = Some(ClipboardContext::new().map_err(|error| error.to_string())?);
        }
        action(context.as_ref().ok_or("clipboard unavailable")?)
    }
}
fn contents(text: &str) -> Vec<ClipboardContent> {
    vec![
        ClipboardContent::Text(text.into()),
        ClipboardContent::Other(BMSE_FORMAT.into(), text.as_bytes().to_vec()),
    ]
}
#[tauri::command]
pub(crate) fn write_clipboard(
    text: String,
    state: State<'_, NativeClipboard>,
) -> Result<(), String> {
    if text.len() > MAX_CLIPBOARD_BYTES {
        return Err("clipboard payload exceeds 16 MiB".into());
    }
    state.with_context(|clipboard| {
        clipboard
            .set(contents(&text))
            .map_err(|error| error.to_string())?;
        // The upstream multi-format setter can silently skip a failed format.
        if clipboard
            .get_buffer(BMSE_FORMAT)
            .map_err(|error| error.to_string())?
            != text.as_bytes()
            || clipboard
                .get_text()
                .map_err(|error| error.to_string())?
                .trim_end_matches('\0')
                != text.trim_end_matches('\0')
        {
            return Err("native clipboard did not retain both BMSE bytes and plain text".into());
        }
        Ok(())
    })
}
#[tauri::command]
pub(crate) fn read_clipboard(state: State<'_, NativeClipboard>) -> Result<String, String> {
    state.with_context(|clipboard| {
        if let Ok(bytes) = clipboard.get_buffer(BMSE_FORMAT) {
            if bytes.len() > MAX_CLIPBOARD_BYTES {
                return Err("clipboard payload exceeds 16 MiB".into());
            }
            return Ok(String::from_utf8_lossy(&bytes).into_owned());
        }
        let text = clipboard.get_text().map_err(|error| error.to_string())?;
        if text.len() > MAX_CLIPBOARD_BYTES {
            return Err("clipboard payload exceeds 16 MiB".into());
        }
        Ok(text)
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn publishes_exact_bmse_bytes_and_plain_text() {
        let text = "BMSE ClipBoard Object Data Format\r\n101000000001\r\n\0";
        let values = contents(text);
        assert!(matches!(&values[0], ClipboardContent::Text(value) if value == text));
        assert!(
            matches!(&values[1], ClipboardContent::Other(format, bytes) if format == BMSE_FORMAT && bytes == text.as_bytes())
        );
    }
}
