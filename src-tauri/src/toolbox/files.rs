//! Small file helpers for tools that read or save text and images chosen
//! through the native dialogs.

use std::{fs, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine as _};

/// Biggest text file we read into the UI. A formatter on a 1 GB file would
/// freeze the window, so refuse early with a clear message.
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

fn read_text(path: &Path, max: u64) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Tidak bisa membuka file: {e}"))?;
    if !meta.is_file() {
        return Err("Ini bukan file".into());
    }
    if meta.len() > max {
        return Err(format!("File terlalu besar ({} MB, maksimal {} MB)", meta.len() / 1048576, max / 1048576));
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "File ini bukan teks UTF-8".to_string())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    read_text(Path::new(&path), MAX_TEXT_BYTES)
}

/// Largest image we pull into the UI as base64 (e.g. to look for a QR code).
const MAX_IMAGE_BYTES: u64 = 40 * 1024 * 1024;

fn read_base64(path: &Path, max: u64) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Tidak bisa membuka file: {e}"))?;
    if !meta.is_file() {
        return Err("Ini bukan file".into());
    }
    if meta.len() > max {
        return Err(format!("File terlalu besar ({} MB, maksimal {} MB)", meta.len() / 1048576, max / 1048576));
    }
    Ok(STANDARD.encode(fs::read(path).map_err(|e| e.to_string())?))
}

#[tauri::command]
pub fn read_base64_file(path: String) -> Result<String, String> {
    read_base64(Path::new(&path), MAX_IMAGE_BYTES)
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Gagal menyimpan: {e}"))
}

#[tauri::command]
pub fn write_base64_file(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data.trim()).map_err(|_| "Data gambar tidak valid".to_string())?;
    fs::write(&path, bytes).map_err(|e| format!("Gagal menyimpan: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workdir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("toolbox-files-test-{}-{tag}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn text_round_trips_including_unicode() {
        let path = workdir("text").join("a.json");
        write_text_file(path.to_string_lossy().into(), "{\"k\": \"é 日本\"}\n".into()).unwrap();
        assert_eq!(read_text_file(path.to_string_lossy().into()).unwrap(), "{\"k\": \"é 日本\"}\n");
    }

    #[test]
    fn refuses_big_non_text_and_missing_files() {
        let dir = workdir("limits");
        let big = dir.join("big.txt");
        fs::write(&big, vec![b'a'; 2048]).unwrap();
        assert!(read_text(&big, 1024).unwrap_err().contains("terlalu besar"));

        let bin = dir.join("bin.dat");
        fs::write(&bin, [0xff, 0xfe, 0x00, 0x80]).unwrap();
        assert!(read_text(&bin, 1024).unwrap_err().contains("UTF-8"));

        assert!(read_text_file("/definitely/not/here.txt".into()).is_err());
        assert!(read_text(&dir, 1024).unwrap_err().contains("bukan file"));
    }

    #[test]
    fn reads_files_as_base64_within_the_size_limit() {
        let dir = workdir("read64");
        let f = dir.join("x.bin");
        fs::write(&f, b"hello").unwrap();
        assert_eq!(read_base64(&f, 1024).unwrap(), "aGVsbG8=");
        assert!(read_base64(&f, 3).unwrap_err().contains("terlalu besar"));
        assert!(read_base64(&dir, 1024).unwrap_err().contains("bukan file"));
        assert!(read_base64_file("/definitely/not/here.png".into()).is_err());
    }

    #[test]
    fn base64_files_are_decoded_and_bad_data_is_rejected() {
        let path = workdir("b64").join("x.bin");
        write_base64_file(path.to_string_lossy().into(), "aGVsbG8=".into()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
        assert!(write_base64_file(path.to_string_lossy().into(), "!!not base64!!".into()).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"hello", "a bad write must not clobber the file");
    }
}
