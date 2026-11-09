//! Perintah dari Notch ke Cognify lewat folder `inbox/` di folder bersama (lihat docs/notch/protokol-tautan.md).
//!
//! Notch menulis satu berkas JSON per perintah (`inbox/<id>.json`). Cognify membacanya selagi terhubung,
//! menjalankannya, lalu menghapusnya. Hasil pencarian ditulis ke `results/<id>.json`. Hanya jenis perintah
//! yang dikenal yang dijalankan; sisanya dibuang tanpa efek.

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use serde::Deserialize;

pub const INBOX: &str = "inbox";
pub const RESULTS: &str = "results";
const MAX_COMMAND_BYTES: u64 = 64 * 1024;
const MAX_PER_PASS: usize = 20;
const MAX_HITS: usize = 8;
const RESULT_TTL: Duration = Duration::from_secs(120);

#[derive(Deserialize, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    /// Tampilkan Cognify di halaman itu (harus diawali "/").
    Open { path: String },
    /// Dokumen baru, langsung terbuka.
    NewDoc { title: Option<String>, text: Option<String> },
    /// Catatan melayang baru.
    NewSticky,
    /// Catatan cepat dari Notch dijadikan dokumen (judul dari baris pertama bila tidak diberi).
    NoteToDoc { text: String, title: Option<String> },
    /// Buka satu Alat (`/tools/<id>`).
    Tool { id: String },
    /// Cari dokumen; hasilnya ke `results/<id>.json`.
    Search { id: String, q: String },
}

/// Id dari Notch dipakai sebagai nama berkas, jadi dibatasi huruf, angka, `-`, dan `_`.
pub fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn parse(bytes: &[u8]) -> Option<Command> {
    let cmd: Command = serde_json::from_slice(bytes).ok()?;
    match &cmd {
        Command::Open { path } if !path.starts_with('/') || path.starts_with("//") || path.len() > 200 => None,
        Command::Tool { id } | Command::Search { id, .. } if !safe_id(id) => None,
        Command::Search { q, .. } if q.trim().is_empty() || q.len() > 200 => None,
        Command::NoteToDoc { text, .. } if text.trim().is_empty() || text.len() > 20_000 => None,
        _ => Some(cmd),
    }
}

/// Isi dokumen Tiptap dari teks polos: satu paragraf per baris.
pub fn doc_json(text: &str) -> String {
    let content: Vec<serde_json::Value> = text
        .lines()
        .map(|l| if l.is_empty() { serde_json::json!({"type": "paragraph"}) } else { serde_json::json!({"type": "paragraph", "content": [{"type": "text", "text": l}]}) })
        .collect();
    serde_json::json!({"type": "doc", "content": content}).to_string()
}

/// Judul dari baris pertama yang tidak kosong, dipotong 80 karakter.
pub fn title_of(text: &str) -> String {
    let first = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    first.chars().take(80).collect()
}

/// Baca dan hapus semua perintah yang menunggu (paling banyak `MAX_PER_PASS`). Berkas rusak atau terlalu besar dihapus.
pub fn take(dir: &Path) -> Vec<Command> {
    let Ok(entries) = fs::read_dir(dir.join(INBOX)) else { return Vec::new() };
    let mut files: Vec<_> = entries.filter_map(Result::ok).filter(|e| e.path().extension().is_some_and(|x| x == "json")).collect();
    files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH));
    let mut out = Vec::new();
    for entry in files.into_iter().take(MAX_PER_PASS) {
        let path = entry.path();
        let ok = entry.metadata().map(|m| m.len() <= MAX_COMMAND_BYTES).unwrap_or(false);
        if ok {
            if let Some(cmd) = fs::read(&path).ok().and_then(|b| parse(&b)) {
                out.push(cmd);
            }
        }
        let _ = fs::remove_file(&path);
    }
    out
}

/// Tulis hasil pencarian untuk Notch.
pub fn write_results(dir: &Path, id: &str, q: &str, hits: &[serde_json::Value]) -> Result<(), String> {
    if !safe_id(id) {
        return Err("Id tidak sah.".into());
    }
    let folder = dir.join(RESULTS);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let body = serde_json::json!({"schema": 1, "id": id, "q": q, "hits": hits.iter().take(MAX_HITS).collect::<Vec<_>>()});
    let tmp = folder.join(format!("{id}.json.tmp"));
    fs::write(&tmp, body.to_string()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, folder.join(format!("{id}.json"))).map_err(|e| e.to_string())
}

/// Buang hasil yang sudah lama tidak diambil.
pub fn sweep_results(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir.join(RESULTS)) else { return };
    for e in entries.filter_map(Result::ok) {
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|d| d > RESULT_TTL);
        if old {
            let _ = fs::remove_file(e.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_commands_parse_and_bad_ones_are_dropped() {
        assert_eq!(parse(br#"{"type":"open","path":"/calendar"}"#), Some(Command::Open { path: "/calendar".into() }));
        assert_eq!(parse(br#"{"type":"new_sticky"}"#), Some(Command::NewSticky));
        assert!(parse(br#"{"type":"open","path":"https://x.com"}"#).is_none());
        assert!(parse(br#"{"type":"open","path":"//evil.com"}"#).is_none());
        assert!(parse(br#"{"type":"tool","id":"../x"}"#).is_none());
        assert!(parse(br#"{"type":"search","id":"a1","q":"  "}"#).is_none());
        assert!(parse(br#"{"type":"note_to_doc","text":""}"#).is_none());
        assert!(parse(br#"{"type":"rm_rf"}"#).is_none());
        assert!(parse(b"rusak").is_none());
    }

    #[test]
    fn take_reads_deletes_and_skips_garbage() {
        let d = std::env::temp_dir().join(format!("cognify-inbox-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(d.join(INBOX)).unwrap();
        fs::write(d.join(INBOX).join("a.json"), r#"{"type":"new_doc","title":"Hai"}"#).unwrap();
        fs::write(d.join(INBOX).join("b.json"), "rusak").unwrap();
        let cmds = take(&d);
        assert_eq!(cmds, vec![Command::NewDoc { title: Some("Hai".into()), text: None }]);
        assert_eq!(fs::read_dir(d.join(INBOX)).unwrap().count(), 0);
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn results_use_safe_names_and_are_capped() {
        let d = std::env::temp_dir().join(format!("cognify-results-{}", uuid::Uuid::new_v4()));
        assert!(write_results(&d, "../x", "q", &[]).is_err());
        let hits: Vec<_> = (0..20).map(|i| serde_json::json!({"id": i})).collect();
        write_results(&d, "s1", "kata", &hits).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&fs::read(d.join(RESULTS).join("s1.json")).unwrap()).unwrap();
        assert_eq!(v["hits"].as_array().unwrap().len(), MAX_HITS);
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn doc_text_becomes_paragraphs_and_a_title() {
        let j: serde_json::Value = serde_json::from_str(&doc_json("satu\n\ndua")).unwrap();
        assert_eq!(j["content"].as_array().unwrap().len(), 3);
        assert_eq!(title_of("\n  Judul saya \nisi"), "Judul saya");
    }
}
