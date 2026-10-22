//! Data sumber sebuah halaman web yang disimpan lewat ekstensi: satu entri sumber (CSL-JSON, bahan sitasi) per halaman
//! dan satu penunjuk per sorotan (alamat bagian, judul bagian, tanggal akses). Disimpan sebagai JSON di tabel
//! `page_sources`; `source` memakai data terbaru dan tidak menimpa kolom yang sudah terisi dengan yang kosong.

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value, json};

use super::{Error, now_iso};

const MAX_SOURCE_BYTES: usize = 16 * 1024;
const MAX_MARKS: usize = 300;

/// Gabungkan `new` ke `old`: kolom baru yang tidak kosong menimpa, kolom kosong tidak menghapus yang lama.
fn merge(old: &Value, new: &Value) -> Value {
    let mut out: Map<String, Value> = old.as_object().cloned().unwrap_or_default();
    if let Some(n) = new.as_object() {
        for (k, v) in n {
            let empty = v.is_null() || v.as_str().is_some_and(|s| s.trim().is_empty()) || v.as_array().is_some_and(|a| a.is_empty());
            if !empty {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    Value::Object(out)
}

pub fn get(conn: &Connection, page_id: &str) -> Result<Option<Value>, Error> {
    let raw: Option<String> = conn.query_row("SELECT data FROM page_sources WHERE page_id = ?1", [page_id], |r| r.get(0)).optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

/// Simpan `source` (objek CSL-JSON, boleh kosong) dan tambahkan `mark` (penunjuk sorotan) bila ada.
pub fn save(conn: &Connection, page_id: &str, source: &Value, mark: Option<Value>) -> Result<(), Error> {
    if !source.is_object() && mark.is_none() {
        return Ok(());
    }
    if source.to_string().len() > MAX_SOURCE_BYTES {
        return Err(Error::Invalid("Data sumber terlalu besar.".into()));
    }
    let current = get(conn, page_id)?.unwrap_or_else(|| json!({ "source": {}, "marks": [] }));
    let merged = merge(&current["source"], source);
    let mut marks: Vec<Value> = current["marks"].as_array().cloned().unwrap_or_default();
    if let Some(m) = mark {
        if !marks.contains(&m) {
            marks.push(m);
        }
    }
    if marks.len() > MAX_MARKS {
        marks.drain(..marks.len() - MAX_MARKS);
    }
    let data = json!({ "source": merged, "marks": marks }).to_string();
    conn.execute(
        "INSERT INTO page_sources (page_id, data, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(page_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        params![page_id, data, now_iso()],
    )?;
    Ok(())
}

/// Ganti seluruh data sumber (hasil suntingan pengguna, termasuk menghapus kolom); penunjuk sorotan tetap.
pub fn replace_source(conn: &Connection, page_id: &str, source: &Value) -> Result<(), Error> {
    if !source.is_object() {
        return Err(Error::Invalid("Data sumber harus berupa objek.".into()));
    }
    if source.to_string().len() > MAX_SOURCE_BYTES {
        return Err(Error::Invalid("Data sumber terlalu besar.".into()));
    }
    let exists: bool = conn.query_row("SELECT 1 FROM pages WHERE id = ?1", [page_id], |_| Ok(())).optional()?.is_some();
    if !exists {
        return Err(Error::NotFound(format!("Halaman tidak ditemukan: {page_id}")));
    }
    let marks = get(conn, page_id)?.and_then(|d| d.get("marks").cloned()).unwrap_or_else(|| json!([]));
    conn.execute(
        "INSERT INTO page_sources (page_id, data, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(page_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        params![page_id, json!({ "source": source, "marks": marks }).to_string(), now_iso()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use crate::store::pages::{self, NewPage};

    fn page(store: &Store) -> String {
        store.with(|c| pages::create(c, NewPage { parent_id: None, kind: "doc".into(), title: Some("T".into()), content: None, plain_text: None })).unwrap().node.id
    }

    #[test]
    fn newer_fields_win_but_empty_ones_do_not_erase() {
        let store = Store::open_in_memory().unwrap();
        let id = page(&store);
        store.with(|c| save(c, &id, &json!({ "title": "A", "author": [{ "literal": "Dewi" }], "issued": { "date-parts": [[2026, 5, 2]] } }), None)).unwrap();
        store.with(|c| save(c, &id, &json!({ "title": "B", "author": [], "issued": null }), Some(json!({ "section": "Sejarah" })))).unwrap();
        let got = store.with(|c| get(c, &id)).unwrap().unwrap();
        assert_eq!(got["source"]["title"], "B");
        assert_eq!(got["source"]["author"][0]["literal"], "Dewi");
        assert_eq!(got["source"]["issued"]["date-parts"][0][0], 2026);
        assert_eq!(got["marks"][0]["section"], "Sejarah");
    }

    #[test]
    fn marks_are_deduplicated_capped_and_removed_with_the_page() {
        let store = Store::open_in_memory().unwrap();
        let id = page(&store);
        for i in 0..(MAX_MARKS + 20) {
            store.with(|c| save(c, &id, &json!({}), Some(json!({ "n": i })))).unwrap();
        }
        store.with(|c| save(c, &id, &json!({}), Some(json!({ "n": MAX_MARKS + 19 })))).unwrap();
        let got = store.with(|c| get(c, &id)).unwrap().unwrap();
        assert_eq!(got["marks"].as_array().unwrap().len(), MAX_MARKS);
        store.with(|c| pages::trash(c, &id)).unwrap();
        store.with(|c| pages::delete_forever(c, &id)).unwrap();
        assert!(store.with(|c| get(c, &id)).unwrap().is_none());
    }

    #[test]
    fn editing_replaces_the_source_but_keeps_the_highlight_marks() {
        let store = Store::open_in_memory().unwrap();
        let id = page(&store);
        store.with(|c| save(c, &id, &json!({ "title": "A", "author": [{ "literal": "Dewi" }] }), Some(json!({ "section": "S" })))).unwrap();
        store.with(|c| replace_source(c, &id, &json!({ "title": "B" }))).unwrap();
        let got = store.with(|c| get(c, &id)).unwrap().unwrap();
        assert_eq!(got["source"], json!({ "title": "B" }));
        assert_eq!(got["marks"][0]["section"], "S");
        assert!(store.with(|c| replace_source(c, "tidak-ada", &json!({}))).is_err());
        assert!(store.with(|c| replace_source(c, &id, &json!("bukan objek"))).is_err());
    }

    #[test]
    fn oversized_source_is_refused() {
        let store = Store::open_in_memory().unwrap();
        let id = page(&store);
        let big = json!({ "title": "x".repeat(MAX_SOURCE_BYTES) });
        assert!(store.with(|c| save(c, &id, &big, None)).is_err());
    }
}
