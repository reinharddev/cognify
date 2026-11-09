//! Riwayat versi dokumen. Sebelum sebuah rangkaian pengeditan mengubah isi, isi lamanya disimpan sebagai potret
//! (paling sering sekali per `GAP_SECS`), dan tiap halaman menyimpan sejumlah potret terbaru saja.
//! Memulihkan versi lama juga menyimpan isi saat ini lebih dulu, jadi pemulihan bisa dibatalkan.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use super::{Error, time::utc_now};

/// Jarak minimal antar potret otomatis (detik).
pub const GAP_SECS: i64 = 600;
/// Jumlah potret terbaru yang disimpan per halaman.
pub const KEEP: i64 = 50;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: i64,
    pub title: String,
    pub created_at: String,
    /// Panjang isi (karakter JSON), sekadar petunjuk ukuran.
    pub size: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: i64,
    pub page_id: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
}

/// Simpan potret `content` bila halaman belum punya potret dalam `min_gap_secs` terakhir. Isi kosong tidak disimpan.
/// Mengembalikan true bila potret baru dibuat.
pub fn snapshot_if_due(conn: &Connection, page_id: &str, title: &str, content: &str, min_gap_secs: i64) -> Result<bool, Error> {
    if content.trim().is_empty() {
        return Ok(false);
    }
    let recent: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM page_versions WHERE page_id = ?1 AND (strftime('%s', 'now') - strftime('%s', created_at)) < ?2 LIMIT 1",
            params![page_id, min_gap_secs],
            |r| r.get(0),
        )
        .optional()?;
    if recent.is_some() {
        return Ok(false);
    }
    add(conn, page_id, title, content)?;
    Ok(true)
}

/// Simpan potret sekarang juga (mis. sebelum memulihkan versi lama). Potret yang isinya sama dengan yang terbaru dilewati.
pub fn add(conn: &Connection, page_id: &str, title: &str, content: &str) -> Result<(), Error> {
    if content.trim().is_empty() {
        return Ok(());
    }
    let same: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM page_versions WHERE page_id = ?1 AND id = (SELECT MAX(id) FROM page_versions WHERE page_id = ?1) AND content = ?2",
            params![page_id, content],
            |r| r.get(0),
        )
        .optional()?;
    if same.is_some() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO page_versions (page_id, title, content, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![page_id, title, content, utc_now()],
    )?;
    conn.execute(
        "DELETE FROM page_versions WHERE page_id = ?1 AND id NOT IN (SELECT id FROM page_versions WHERE page_id = ?1 ORDER BY id DESC LIMIT ?2)",
        params![page_id, KEEP],
    )?;
    Ok(())
}

pub fn list(conn: &Connection, page_id: &str) -> Result<Vec<VersionInfo>, Error> {
    let mut stmt = conn.prepare("SELECT id, title, created_at, length(content) FROM page_versions WHERE page_id = ?1 ORDER BY id DESC")?;
    let rows = stmt
        .query_map([page_id], |r| Ok(VersionInfo { id: r.get(0)?, title: r.get(1)?, created_at: r.get(2)?, size: r.get(3)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> Result<Version, Error> {
    conn.query_row("SELECT id, page_id, title, content, created_at FROM page_versions WHERE id = ?1", [id], |r| {
        Ok(Version { id: r.get(0)?, page_id: r.get(1)?, title: r.get(2)?, content: r.get(3)?, created_at: r.get(4)? })
    })
    .optional()?
    .ok_or_else(|| Error::NotFound(format!("versi {id}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{Store, pages::{self, NewPage, PageUpdate}};

    fn page(c: &Connection) -> String {
        pages::create(c, NewPage { kind: "doc".into(), title: Some("T".into()), parent_id: None, content: None, plain_text: None }).unwrap().node.id
    }

    #[test]
    fn snapshots_are_rate_limited_deduplicated_capped_and_skip_empty_content() {
        Store::open_in_memory()
            .unwrap()
            .with(|c| {
                let id = page(c);
                assert!(!snapshot_if_due(c, &id, "T", "  ", 0).unwrap(), "kosong tidak disimpan");
                assert!(snapshot_if_due(c, &id, "T", "{\"a\":1}", GAP_SECS).unwrap());
                assert!(!snapshot_if_due(c, &id, "T", "{\"a\":2}", GAP_SECS).unwrap(), "terlalu dekat dengan potret sebelumnya");
                assert!(snapshot_if_due(c, &id, "T", "{\"a\":2}", 0).unwrap(), "tanpa jarak minimal");
                add(c, &id, "T", "{\"a\":2}").unwrap();
                assert_eq!(list(c, &id).unwrap().len(), 2, "isi yang sama dengan potret terbaru dilewati");
                for i in 0..(KEEP + 5) {
                    add(c, &id, "T", &format!("{{\"n\":{i}}}")).unwrap();
                }
                let all = list(c, &id).unwrap();
                assert_eq!(all.len() as i64, KEEP);
                assert!(all[0].id > all[1].id, "terbaru di atas");
                assert_eq!(get(c, all[0].id).unwrap().content, format!("{{\"n\":{}}}", KEEP + 4));
                assert!(get(c, -1).is_err());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn editing_a_document_snapshots_its_previous_content_and_versions_go_with_the_page() {
        Store::open_in_memory()
            .unwrap()
            .with(|c| {
                let id = page(c);
                let set = |content: &str| pages::update(c, &id, PageUpdate { content: Some(content.into()), ..Default::default() }).unwrap();
                set("{\"v\":1}"); // isi sebelumnya kosong: tidak ada potret
                assert!(list(c, &id).unwrap().is_empty());
                set("{\"v\":2}"); // potret isi lama {"v":1}
                set("{\"v\":3}"); // terlalu dekat: tidak ada potret baru
                let v = list(c, &id).unwrap();
                assert_eq!(v.len(), 1);
                assert_eq!(get(c, v[0].id).unwrap().content, "{\"v\":1}");
                pages::trash(c, &id).unwrap();
                pages::delete_forever(c, &id).unwrap();
                assert!(list(c, &id).unwrap().is_empty(), "ikut terhapus bersama halaman");
                Ok(())
            })
            .unwrap();
    }
}
