//! Pohon halaman: dokumen, papan, dan tabel yang bersarang tanpa batas, dengan urutan antar-saudara,
//! favorit, tag, sampah (beserta turunannya), dan pencarian teks.
//!
//! `content` adalah JSON buram milik editor (blok dokumen, adegan papan, definisi tabel); penyimpanan
//! hanya memastikan JSON-nya sah. `plain_text` adalah teks polos untuk pencarian, dikirim editor.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use super::{Error, time::utc_now};

const KINDS: [&str; 4] = ["doc", "board", "table", "folder"];
const MAX_TITLE: usize = 300;
const MAX_CONTENT: usize = 20 * 1024 * 1024;
const MAX_TAGS: usize = 20;
const MAX_TAG_LEN: usize = 40;
/// Jarak antar posisi yang lebih kecil dari ini memicu penomoran ulang saudara.
const MIN_GAP: f64 = 1e-6;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub icon: Option<String>,
    pub position: f64,
    pub favorite: bool,
    pub updated_at: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    #[serde(flatten)]
    pub node: PageNode,
    pub content: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub trashed_at: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    #[serde(flatten)]
    pub node: PageNode,
    pub trashed_at: String,
    /// Jumlah halaman yang ikut terbuang bersamanya (turunan), tidak termasuk dirinya.
    pub descendants: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub icon: Option<String>,
    pub snippet: String,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewPage {
    pub parent_id: Option<String>,
    pub kind: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub plain_text: Option<String>,
}

/// Semua bidang opsional: yang tidak dikirim tidak berubah. `icon` kosong ("") menghapus ikon.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PageUpdate {
    pub title: Option<String>,
    pub icon: Option<String>,
    pub content: Option<String>,
    pub plain_text: Option<String>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
}

fn node_from(r: &Row) -> rusqlite::Result<PageNode> {
    Ok(PageNode {
        id: r.get("id")?,
        parent_id: r.get("parent_id")?,
        kind: r.get("kind")?,
        title: r.get("title")?,
        icon: r.get("icon")?,
        position: r.get("position")?,
        favorite: r.get::<_, i64>("favorite")? != 0,
        updated_at: r.get("updated_at")?,
    })
}

const NODE_COLS: &str = "id, parent_id, kind, title, icon, position, favorite, updated_at";

fn invalid(msg: &str) -> Error {
    Error::Invalid(msg.to_string())
}

fn not_found(id: &str) -> Error {
    Error::NotFound(format!("Halaman tidak ditemukan: {id}"))
}

fn clean_title(title: &str) -> Result<String, Error> {
    let t = title.trim();
    if t.chars().count() > MAX_TITLE {
        return Err(Error::Invalid(format!("Judul terlalu panjang (maksimal {MAX_TITLE} karakter).")));
    }
    Ok(t.to_string())
}

fn check_content(content: &str) -> Result<(), Error> {
    if content.len() > MAX_CONTENT {
        return Err(invalid("Isi halaman terlalu besar."));
    }
    if !content.is_empty() && serde_json::from_str::<serde_json::Value>(content).is_err() {
        return Err(invalid("Isi halaman bukan JSON yang sah."));
    }
    Ok(())
}

fn clean_tags(tags: &[String]) -> Result<Vec<String>, Error> {
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let t = t.trim();
        if t.is_empty() {
            continue;
        }
        if t.chars().count() > MAX_TAG_LEN {
            return Err(Error::Invalid(format!("Tag terlalu panjang (maksimal {MAX_TAG_LEN} karakter).")));
        }
        if !out.iter().any(|x| x.eq_ignore_ascii_case(t)) {
            out.push(t.to_string());
        }
    }
    if out.len() > MAX_TAGS {
        return Err(Error::Invalid(format!("Terlalu banyak tag (maksimal {MAX_TAGS}).")));
    }
    Ok(out)
}

/// Halaman aktif (tidak di sampah) atau galat.
fn active(conn: &Connection, id: &str) -> Result<(), Error> {
    let trashed: Option<Option<String>> =
        conn.query_row("SELECT trashed_at FROM pages WHERE id = ?1", [id], |r| r.get(0)).optional()?;
    match trashed {
        None => Err(not_found(id)),
        Some(Some(_)) => Err(invalid("Halaman ini ada di sampah.")),
        Some(None) => Ok(()),
    }
}

fn next_position(conn: &Connection, parent: Option<&str>) -> Result<f64, Error> {
    let max: Option<f64> = conn.query_row(
        "SELECT MAX(position) FROM pages WHERE parent_id IS ?1 AND trashed_at IS NULL",
        [parent],
        |r| r.get(0),
    )?;
    Ok(max.map_or(1.0, |m| m + 1.0))
}

pub fn create(conn: &Connection, new: NewPage) -> Result<Page, Error> {
    if !KINDS.contains(&new.kind.as_str()) {
        return Err(invalid("Jenis halaman harus doc, board, table, atau folder."));
    }
    let title = clean_title(new.title.as_deref().unwrap_or(""))?;
    let content = new.content.unwrap_or_default();
    check_content(&content)?;
    if let Some(p) = new.parent_id.as_deref() {
        active(conn, p)?;
    }
    let tx = conn.unchecked_transaction()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = utc_now();
    let position = next_position(&tx, new.parent_id.as_deref())?;
    tx.execute(
        "INSERT INTO pages (id, parent_id, kind, title, content, plain_text, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, new.parent_id, new.kind, title, content, new.plain_text.unwrap_or_default(), position, now],
    )?;
    tx.commit()?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<Page, Error> {
    let row = conn
        .query_row(
            &format!("SELECT {NODE_COLS}, content, created_at, trashed_at FROM pages WHERE id = ?1"),
            [id],
            |r| Ok((node_from(r)?, r.get::<_, String>("content")?, r.get::<_, String>("created_at")?, r.get("trashed_at")?)),
        )
        .optional()?
        .ok_or_else(|| not_found(id))?;
    let mut stmt = conn.prepare("SELECT tag FROM page_tags WHERE page_id = ?1 ORDER BY tag COLLATE NOCASE")?;
    let tags = stmt.query_map([id], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
    Ok(Page { node: row.0, content: row.1, tags, created_at: row.2, trashed_at: row.3 })
}

/// Seluruh halaman aktif tanpa isi, berurutan per induk lalu posisi; klien menyusunnya jadi pohon.
pub fn tree(conn: &Connection) -> Result<Vec<PageNode>, Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {NODE_COLS} FROM pages WHERE trashed_at IS NULL ORDER BY COALESCE(parent_id, ''), position, created_at"
    ))?;
    Ok(stmt.query_map([], node_from)?.collect::<Result<_, _>>()?)
}

pub fn update(conn: &Connection, id: &str, upd: PageUpdate) -> Result<Page, Error> {
    active(conn, id)?;
    let title = upd.title.as_deref().map(clean_title).transpose()?;
    if let Some(c) = upd.content.as_deref() {
        check_content(c)?;
    }
    let tags = upd.tags.as_deref().map(clean_tags).transpose()?;
    let tx = conn.unchecked_transaction()?;
    if let Some(t) = title {
        tx.execute("UPDATE pages SET title = ?2 WHERE id = ?1", params![id, t])?;
    }
    if let Some(i) = upd.icon {
        let icon = (!i.trim().is_empty()).then(|| i.trim().to_string());
        tx.execute("UPDATE pages SET icon = ?2 WHERE id = ?1", params![id, icon])?;
    }
    if let Some(c) = upd.content {
        tx.execute("UPDATE pages SET content = ?2 WHERE id = ?1", params![id, c])?;
    }
    if let Some(p) = upd.plain_text {
        tx.execute("UPDATE pages SET plain_text = ?2 WHERE id = ?1", params![id, p])?;
    }
    if let Some(f) = upd.favorite {
        tx.execute("UPDATE pages SET favorite = ?2 WHERE id = ?1", params![id, f as i64])?;
    }
    if let Some(tags) = tags {
        tx.execute("DELETE FROM page_tags WHERE page_id = ?1", [id])?;
        for t in tags {
            tx.execute("INSERT INTO page_tags (page_id, tag) VALUES (?1, ?2)", params![id, t])?;
        }
    }
    tx.execute("UPDATE pages SET updated_at = ?2 WHERE id = ?1", params![id, utc_now()])?;
    tx.commit()?;
    get(conn, id)
}

const DESCENDANTS: &str = "WITH RECURSIVE d(id) AS (
        SELECT id FROM pages WHERE id = ?1
        UNION ALL SELECT p.id FROM pages p JOIN d ON p.parent_id = d.id
    )";

fn is_descendant_or_self(conn: &Connection, root: &str, candidate: &str) -> Result<bool, Error> {
    Ok(conn
        .query_row(&format!("{DESCENDANTS} SELECT 1 FROM d WHERE id = ?2"), params![root, candidate], |_| Ok(()))
        .optional()?
        .is_some())
}

/// Pindahkan `id` ke `new_parent` (None = tingkat teratas), tepat sebelum `before` bila diberikan,
/// atau di paling akhir bila tidak.
pub fn move_page(conn: &Connection, id: &str, new_parent: Option<&str>, before: Option<&str>) -> Result<(), Error> {
    active(conn, id)?;
    if let Some(p) = new_parent {
        active(conn, p)?;
        if is_descendant_or_self(conn, id, p)? {
            return Err(invalid("Halaman tidak bisa dipindahkan ke dalam dirinya sendiri."));
        }
    }
    let tx = conn.unchecked_transaction()?;
    let mut siblings: Vec<(String, f64)> = {
        let mut stmt = tx.prepare(
            "SELECT id, position FROM pages WHERE parent_id IS ?1 AND trashed_at IS NULL AND id != ?2 ORDER BY position, created_at",
        )?;
        stmt.query_map(params![new_parent, id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?
    };
    let at = match before {
        None => siblings.len(),
        Some(b) => siblings
            .iter()
            .position(|(sid, _)| sid == b)
            .ok_or_else(|| invalid("Halaman acuan bukan saudara di tujuan."))?,
    };
    let position = match (at.checked_sub(1).map(|i| siblings[i].1), siblings.get(at).map(|s| s.1)) {
        (None, None) => 1.0,
        (None, Some(next)) => next - 1.0,
        (Some(prev), None) => prev + 1.0,
        (Some(prev), Some(next)) => (prev + next) / 2.0,
    };
    // Celah terlalu sempit: nomori ulang semua saudara dan sisipkan di tempatnya.
    let crowded = at > 0 && siblings.get(at).is_some_and(|n| n.1 - siblings[at - 1].1 < MIN_GAP * 2.0);
    if crowded {
        siblings.insert(at, (id.to_string(), 0.0));
        for (n, (sid, _)) in siblings.iter().enumerate() {
            tx.execute("UPDATE pages SET position = ?2 WHERE id = ?1", params![sid, (n + 1) as f64])?;
        }
        tx.execute("UPDATE pages SET parent_id = ?2, updated_at = ?3 WHERE id = ?1", params![id, new_parent, utc_now()])?;
    } else {
        tx.execute(
            "UPDATE pages SET parent_id = ?2, position = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, new_parent, position, utc_now()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Buang halaman beserta turunannya ke sampah. Halaman yang sudah lebih dulu di sampah tidak
/// berubah, jadi memulihkan induknya nanti tidak ikut menghidupkannya.
pub fn trash(conn: &Connection, id: &str) -> Result<i64, Error> {
    active(conn, id)?;
    let n = conn.execute(
        &format!("{DESCENDANTS} UPDATE pages SET trashed_at = ?2 WHERE trashed_at IS NULL AND id IN (SELECT id FROM d)"),
        params![id, utc_now()],
    )?;
    Ok(n as i64)
}

/// Pulihkan halaman dan turunan yang dibuang bersamanya. Bila induknya masih di sampah, halaman
/// kembali di tingkat teratas.
pub fn restore(conn: &Connection, id: &str) -> Result<i64, Error> {
    let (parent, ts): (Option<String>, Option<String>) = conn
        .query_row("SELECT parent_id, trashed_at FROM pages WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| not_found(id))?;
    let ts = ts.ok_or_else(|| invalid("Halaman ini tidak ada di sampah."))?;
    let tx = conn.unchecked_transaction()?;
    let parent_gone = match parent.as_deref() {
        None => false,
        Some(p) => tx.query_row("SELECT trashed_at IS NOT NULL FROM pages WHERE id = ?1", [p], |r| r.get::<_, i64>(0))? != 0,
    };
    if parent_gone {
        let pos = next_position(&tx, None)?;
        tx.execute("UPDATE pages SET parent_id = NULL, position = ?2 WHERE id = ?1", params![id, pos])?;
    }
    let n = tx.execute(
        &format!("{DESCENDANTS} UPDATE pages SET trashed_at = NULL WHERE trashed_at = ?2 AND id IN (SELECT id FROM d)"),
        params![id, ts],
    )?;
    tx.commit()?;
    Ok(n as i64)
}

/// Halaman teratas di sampah (turunan yang ikut terbuang tidak didaftar sendiri).
pub fn trash_list(conn: &Connection) -> Result<Vec<TrashItem>, Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {NODE_COLS}, trashed_at,
            (SELECT COUNT(*) FROM pages c WHERE c.trashed_at = pages.trashed_at AND c.id != pages.id
                AND c.id IN (WITH RECURSIVE d(id) AS (SELECT pages.id UNION ALL SELECT p.id FROM pages p JOIN d ON p.parent_id = d.id) SELECT id FROM d)) AS n
         FROM pages
         WHERE trashed_at IS NOT NULL
           AND (parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM pages q WHERE q.id = pages.parent_id AND q.trashed_at = pages.trashed_at))
         ORDER BY trashed_at DESC"
    ))?;
    Ok(stmt
        .query_map([], |r| Ok(TrashItem { node: node_from(r)?, trashed_at: r.get("trashed_at")?, descendants: r.get("n")? }))?
        .collect::<Result<_, _>>()?)
}

/// Hapus permanen. Hanya halaman yang sudah di sampah; turunannya ikut terhapus (CASCADE).
pub fn delete_forever(conn: &Connection, id: &str) -> Result<(), Error> {
    let trashed: Option<Option<String>> =
        conn.query_row("SELECT trashed_at FROM pages WHERE id = ?1", [id], |r| r.get(0)).optional()?;
    match trashed {
        None => Err(not_found(id)),
        Some(None) => Err(invalid("Buang halaman ke sampah dulu sebelum menghapusnya permanen.")),
        Some(Some(_)) => {
            conn.execute("DELETE FROM pages WHERE id = ?1", [id])?;
            Ok(())
        }
    }
}

pub fn empty_trash(conn: &Connection) -> Result<i64, Error> {
    // Hapus akar sampah; anaknya ikut lewat CASCADE.
    let n = conn.execute(
        "DELETE FROM pages WHERE trashed_at IS NOT NULL
           AND (parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM pages q WHERE q.id = pages.parent_id AND q.trashed_at IS NOT NULL))",
        [],
    )?;
    Ok(n as i64)
}

/// Tag beserta jumlah halaman aktif yang memakainya.
pub fn tag_counts(conn: &Connection) -> Result<Vec<(String, i64)>, Error> {
    let mut stmt = conn.prepare(
        "SELECT t.tag, COUNT(*) FROM page_tags t JOIN pages p ON p.id = t.page_id
         WHERE p.trashed_at IS NULL GROUP BY t.tag COLLATE NOCASE ORDER BY t.tag COLLATE NOCASE",
    )?;
    Ok(stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?)
}

/// Halaman aktif yang memiliki `tag` (tanpa membedakan huruf besar-kecil), yang terbaru diubah lebih dulu.
pub fn by_tag(conn: &Connection, tag: &str) -> Result<Vec<PageNode>, Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {NODE_COLS} FROM pages WHERE trashed_at IS NULL
         AND id IN (SELECT page_id FROM page_tags WHERE tag = ?1 COLLATE NOCASE)
         ORDER BY updated_at DESC, title"
    ))?;
    Ok(stmt.query_map([tag.trim()], node_from)?.collect::<Result<_, _>>()?)
}

/// Ubah ketikan pengguna menjadi kueri FTS5 yang aman: kata-kata (huruf dan angka) berawalan,
/// semuanya harus cocok. Tanda kutip dan operator FTS tidak pernah sampai ke SQLite.
fn fts_query(text: &str) -> Option<String> {
    let terms: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(8)
        .map(|w| format!("\"{w}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

pub fn search(conn: &Connection, text: &str, limit: usize) -> Result<Vec<SearchHit>, Error> {
    let Some(q) = fts_query(text) else { return Ok(vec![]) };
    let mut stmt = conn.prepare(
        "SELECT p.id, p.kind, p.title, p.icon, snippet(pages_fts, 1, '', '', '…', 12)
         FROM pages_fts JOIN pages p ON p.rowid = pages_fts.rowid
         WHERE pages_fts MATCH ?1 AND p.trashed_at IS NULL
         ORDER BY bm25(pages_fts, 5.0, 1.0) LIMIT ?2",
    )?;
    Ok(stmt
        .query_map(params![q, limit.clamp(1, 100) as i64], |r| {
            Ok(SearchHit { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, icon: r.get(3)?, snippet: r.get(4)? })
        })?
        .collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn store() -> Store {
        Store::open_in_memory().unwrap()
    }

    fn mk(c: &Connection, parent: Option<&str>, kind: &str, title: &str) -> String {
        create(c, NewPage { parent_id: parent.map(String::from), kind: kind.into(), title: Some(title.into()), ..Default::default() })
            .unwrap()
            .node
            .id
    }

    fn titles(c: &Connection, parent: Option<&str>) -> Vec<String> {
        tree(c).unwrap().into_iter().filter(|n| n.parent_id.as_deref() == parent).map(|n| n.title).collect()
    }

    #[test]
    fn new_pages_append_in_order_and_nest() {
        store().with(|c| {
            let a = mk(c, None, "doc", "A");
            mk(c, None, "board", "B");
            mk(c, Some(&a), "doc", "A1");
            mk(c, Some(&a), "table", "A2");
            assert_eq!(titles(c, None), ["A", "B"]);
            assert_eq!(titles(c, Some(&a)), ["A1", "A2"]);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn create_validates_kind_title_content_and_parent() {
        store().with(|c| {
            let bad = |n: NewPage| create(c, n).unwrap_err().to_string();
            assert!(bad(NewPage { kind: "video".into(), ..Default::default() }).contains("doc, board, table, atau folder"));
            assert!(bad(NewPage { kind: "doc".into(), title: Some("x".repeat(301)), ..Default::default() }).contains("terlalu panjang"));
            assert!(bad(NewPage { kind: "doc".into(), content: Some("{rusak".into()), ..Default::default() }).contains("JSON"));
            assert!(matches!(
                create(c, NewPage { kind: "doc".into(), parent_id: Some("tidak-ada".into()), ..Default::default() }),
                Err(Error::NotFound(_))
            ));
            let ok = create(c, NewPage { kind: "board".into(), content: Some(r#"{"elements":[]}"#.into()), ..Default::default() }).unwrap();
            assert_eq!(ok.content, r#"{"elements":[]}"#);
            assert_eq!(ok.node.title, "");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn update_changes_only_what_was_sent() {
        store().with(|c| {
            let id = mk(c, None, "doc", "Awal");
            let p = update(c, &id, PageUpdate { title: Some("  Baru  ".into()), icon: Some("book".into()), favorite: Some(true), ..Default::default() }).unwrap();
            assert_eq!((p.node.title.as_str(), p.node.icon.as_deref(), p.node.favorite), ("Baru", Some("book"), true));
            let p = update(c, &id, PageUpdate { content: Some("[]".into()), ..Default::default() }).unwrap();
            assert_eq!((p.node.title.as_str(), p.content.as_str(), p.node.favorite), ("Baru", "[]", true));
            let p = update(c, &id, PageUpdate { icon: Some("".into()), ..Default::default() }).unwrap();
            assert_eq!(p.node.icon, None);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn tags_are_trimmed_deduplicated_and_limited() {
        store().with(|c| {
            let id = mk(c, None, "doc", "T");
            let p = update(c, &id, PageUpdate { tags: Some(vec![" IPA ".into(), "ipa".into(), "".into(), "Ujian".into()]), ..Default::default() }).unwrap();
            assert_eq!(p.tags, ["IPA", "Ujian"]);
            let many: Vec<String> = (0..21).map(|i| format!("t{i}")).collect();
            assert!(update(c, &id, PageUpdate { tags: Some(many), ..Default::default() }).is_err());
            assert_eq!(get(c, &id).unwrap().tags.len(), 2, "gagal tidak mengubah apa pun");
            update(c, &id, PageUpdate { tags: Some(vec![]), ..Default::default() }).unwrap();
            assert!(get(c, &id).unwrap().tags.is_empty());
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn move_reorders_reparents_and_rejects_cycles() {
        store().with(|c| {
            let a = mk(c, None, "doc", "A");
            let b = mk(c, None, "doc", "B");
            let cc = mk(c, None, "doc", "C");
            move_page(c, &cc, None, Some(&a)).unwrap(); // C sebelum A
            assert_eq!(titles(c, None), ["C", "A", "B"]);
            move_page(c, &a, None, Some(&b)).unwrap(); // A sebelum B (sudah di sana)
            assert_eq!(titles(c, None), ["C", "A", "B"]);
            move_page(c, &cc, None, None).unwrap(); // C ke paling akhir
            assert_eq!(titles(c, None), ["A", "B", "C"]);
            move_page(c, &b, Some(&a), None).unwrap(); // B jadi anak A
            assert_eq!(titles(c, Some(&a)), ["B"]);
            assert_eq!(titles(c, None), ["A", "C"]);
            // siklus: A ke dalam B (anaknya) dan ke dalam dirinya sendiri
            assert!(move_page(c, &a, Some(&b), None).unwrap_err().to_string().contains("dirinya sendiri"));
            assert!(move_page(c, &a, Some(&a), None).is_err());
            // acuan yang bukan saudara
            assert!(move_page(c, &cc, Some(&a), Some(&cc)).is_err());
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn repeated_insertions_between_two_pages_keep_a_stable_order() {
        store().with(|c| {
            let first = mk(c, None, "doc", "satu");
            let last = mk(c, None, "doc", "akhir");
            // Sisipkan berkali-kali tepat sebelum "akhir": celah posisi terus menyempit sampai penomoran ulang.
            for i in 0..60 {
                let id = mk(c, None, "doc", &format!("s{i}"));
                move_page(c, &id, None, Some(&last)).unwrap();
            }
            let order = titles(c, None);
            assert_eq!(order.len(), 62);
            assert_eq!(order.first().unwrap(), "satu");
            assert_eq!(order.last().unwrap(), "akhir");
            let mid: Vec<&String> = order[1..61].iter().collect();
            let expect: Vec<String> = (0..60).map(|i| format!("s{i}")).collect();
            assert_eq!(mid, expect.iter().collect::<Vec<_>>(), "urutan sisipan terjaga");
            let _ = first;
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn trash_takes_the_subtree_and_restore_brings_it_back() {
        store().with(|c| {
            let a = mk(c, None, "doc", "A");
            let a1 = mk(c, Some(&a), "doc", "A1");
            let a11 = mk(c, Some(&a1), "doc", "A11");
            mk(c, None, "doc", "B");
            assert_eq!(trash(c, &a).unwrap(), 3);
            assert_eq!(titles(c, None), ["B"]);
            let t = trash_list(c).unwrap();
            assert_eq!(t.len(), 1, "hanya akar sampah yang didaftar");
            assert_eq!((t[0].node.title.as_str(), t[0].descendants), ("A", 2));
            assert!(update(c, &a11, PageUpdate::default()).is_err(), "halaman di sampah tidak bisa diubah");
            assert_eq!(restore(c, &a).unwrap(), 3);
            assert_eq!(titles(c, None), ["A", "B"]);
            assert_eq!(titles(c, Some(&a1)), ["A11"]);
            assert!(trash_list(c).unwrap().is_empty());
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn a_child_trashed_earlier_stays_trashed_when_the_parent_returns() {
        store().with(|c| {
            let a = mk(c, None, "doc", "A");
            let a1 = mk(c, Some(&a), "doc", "A1");
            mk(c, Some(&a), "doc", "A2");
            trash(c, &a1).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(3));
            trash(c, &a).unwrap();
            assert_eq!(trash_list(c).unwrap().len(), 2, "A1 dan A terdaftar terpisah");
            restore(c, &a).unwrap();
            assert_eq!(titles(c, Some(&a)), ["A2"]);
            assert_eq!(trash_list(c).unwrap()[0].node.title, "A1");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn restoring_a_child_under_a_trashed_parent_lands_at_the_top() {
        store().with(|c| {
            let a = mk(c, None, "doc", "A");
            let a1 = mk(c, Some(&a), "doc", "A1");
            trash(c, &a1).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(3));
            trash(c, &a).unwrap();
            restore(c, &a1).unwrap();
            let node = tree(c).unwrap().into_iter().find(|n| n.id == a1).unwrap();
            assert_eq!(node.parent_id, None);
            assert!(trash_list(c).unwrap().iter().any(|t| t.node.id == a));
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn permanent_delete_needs_the_trash_and_cascades() {
        store().with(|c| {
            let a = mk(c, None, "doc", "A");
            let a1 = mk(c, Some(&a), "doc", "A1");
            update(c, &a1, PageUpdate { tags: Some(vec!["x".into()]), ..Default::default() }).unwrap();
            assert!(delete_forever(c, &a).unwrap_err().to_string().contains("sampah"));
            trash(c, &a).unwrap();
            delete_forever(c, &a).unwrap();
            assert!(matches!(get(c, &a1), Err(Error::NotFound(_))), "anak ikut terhapus");
            let tags: i64 = c.query_row("SELECT COUNT(*) FROM page_tags", [], |r| r.get(0)).unwrap();
            assert_eq!(tags, 0);
            let b = mk(c, None, "doc", "B");
            trash(c, &b).unwrap();
            assert_eq!(empty_trash(c).unwrap(), 1);
            assert!(trash_list(c).unwrap().is_empty());
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn search_matches_title_and_text_by_prefix_and_ignores_the_trash_and_accents() {
        store().with(|c| {
            let a = mk(c, None, "doc", "Turunan fungsi");
            update(c, &a, PageUpdate { plain_text: Some("Aturan rantai dipakai untuk fungsi komposisi".into()), ..Default::default() }).unwrap();
            let b = mk(c, None, "doc", "Fotosintesis");
            update(c, &b, PageUpdate { plain_text: Some("Klorofil menyerap cahaya. Café".into()), ..Default::default() }).unwrap();
            let hits = |q: &str| search(c, q, 10).unwrap();
            assert_eq!(hits("turun")[0].title, "Turunan fungsi", "awalan judul");
            assert_eq!(hits("rantai")[0].id, a, "isi");
            assert_eq!(hits("fungsi rantai").len(), 1, "semua kata harus cocok");
            assert!(hits("rantai")[0].snippet.contains("rantai"));
            assert_eq!(hits("cafe")[0].id, b, "tanpa aksen");
            assert!(hits("").is_empty() && hits("   ").is_empty());
            assert!(hits("\"* OR NEAR(").is_empty(), "operator FTS tidak lolos");
            update(c, &a, PageUpdate { plain_text: Some("sudah diganti".into()), ..Default::default() }).unwrap();
            assert!(hits("rantai").is_empty(), "indeks ikut berubah");
            trash(c, &b).unwrap();
            assert!(hits("klorofil").is_empty(), "sampah tidak dicari");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn pages_by_tag_ignore_case_the_trash_and_other_tags() {
        store().with(|c| {
            let a = mk(c, None, "doc", "A");
            let b = mk(c, None, "doc", "B");
            let other = mk(c, None, "board", "C");
            update(c, &a, PageUpdate { tags: Some(vec!["IPA".into(), "ujian".into()]), ..Default::default() }).unwrap();
            update(c, &b, PageUpdate { tags: Some(vec!["ipa".into()]), ..Default::default() }).unwrap();
            update(c, &other, PageUpdate { tags: Some(vec!["seni".into()]), ..Default::default() }).unwrap();
            let titles = |tag: &str| by_tag(c, tag).unwrap().into_iter().map(|n| n.title).collect::<Vec<_>>();
            let mut found = titles(" Ipa ");
            found.sort();
            assert_eq!(found, ["A", "B"]);
            assert_eq!(titles("seni"), ["C"]);
            assert!(titles("tidak-ada").is_empty());
            assert!(titles("").is_empty());
            trash(c, &a).unwrap();
            assert_eq!(titles("IPA"), ["B"]);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn tag_counts_count_active_pages_only() {
        store().with(|c| {
            let a = mk(c, None, "doc", "A");
            let b = mk(c, None, "doc", "B");
            for id in [&a, &b] {
                update(c, id, PageUpdate { tags: Some(vec!["IPA".into()]), ..Default::default() }).unwrap();
            }
            assert_eq!(tag_counts(c).unwrap(), [("IPA".to_string(), 2)]);
            trash(c, &b).unwrap();
            assert_eq!(tag_counts(c).unwrap(), [("IPA".to_string(), 1)]);
            Ok(())
        })
        .unwrap();
    }
}
