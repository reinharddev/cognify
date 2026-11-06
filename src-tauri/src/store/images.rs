//! Gambar di dokumen: disalin ke `<data app>/images/` dan dibaca lewat protokol asset. Dokumen hanya menyimpan nama berkas.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::AppHandle;

use super::data_dir;

const EXTS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];
const MAX_BYTES: usize = 25 * 1024 * 1024;

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = data_dir(app)?.join("images");
    std::fs::create_dir_all(&d).map_err(|e| format!("Folder gambar tidak bisa dibuat: {e}"))?;
    Ok(d)
}

fn clean_ext(ext: &str) -> Result<String, String> {
    let e = ext.trim_start_matches('.').to_lowercase();
    if EXTS.contains(&e.as_str()) { Ok(e) } else { Err("Jenis gambar tidak didukung. Pakai PNG, JPG, WebP, atau GIF.".into()) }
}

fn write(app: &AppHandle, bytes: &[u8], ext: &str) -> Result<String, String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("Gambar kosong atau lebih besar dari 25 MB.".into());
    }
    let name = format!("{}.{}", uuid::Uuid::new_v4().simple(), clean_ext(ext)?);
    std::fs::write(dir(app)?.join(&name), bytes).map_err(|e| format!("Gambar tidak bisa disimpan: {e}"))?;
    Ok(name)
}

/// Folder gambar (mutlak), untuk membentuk alamat asset di tampilan.
#[tauri::command]
pub fn image_dir(app: AppHandle) -> Result<String, String> {
    Ok(dir(&app)?.to_string_lossy().into_owned())
}

/// Simpan gambar dari tempelan (data base64). Mengembalikan nama berkas.
#[tauri::command]
pub fn image_save(app: AppHandle, data: String, ext: String) -> Result<String, String> {
    let bytes = STANDARD.decode(data.trim()).map_err(|_| "Data gambar rusak.".to_string())?;
    write(&app, &bytes, &ext)
}

/// Salin gambar dari berkas (seret dari Finder). Mengembalikan nama berkas.
#[tauri::command]
pub fn image_import(app: AppHandle, path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).ok_or("Berkas ini bukan gambar.")?;
    let ext = clean_ext(ext)?;
    let bytes = std::fs::read(p).map_err(|e| format!("Gambar tidak bisa dibaca: {e}"))?;
    write(&app, &bytes, &ext)
}
