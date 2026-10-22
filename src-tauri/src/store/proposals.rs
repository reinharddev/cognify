//! Usulan dari klien MCP (AI). AI hanya bisa menambahkan usulan; halaman baru dibuat setelah
//! pengguna menyetujuinya di Cognify. Tidak ada jalur dari MCP yang langsung menulis ke halaman.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use super::{Error, markdown, pages, time::utc_now};

const MAX_TITLE: usize = 300;
const MAX_BODY: usize = 100_000;
const MAX_SOURCE: usize = 60;
pub const MAX_PENDING: i64 = 50;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub parent_id: Option<String>,
    pub source: String,
    pub status: String,
    pub page_id: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProposalInput {
    pub title: String,
    pub body: String,
    pub parent_id: Option<String>,
    pub source: Option<String>,
}

const COLS: &str = "id, kind, title, body, parent_id, source, status, page_id, created_at";

fn row(r: &Row) -> rusqlite::Result<Proposal> {
    Ok(Proposal {
        id: r.get("id")?,
        kind: r.get("kind")?,
        title: r.get("title")?,
        body: r.get("body")?,
        parent_id: r.get("parent_id")?,
        source: r.get("source")?,
        status: r.get("status")?,
        page_id: r.get("page_id")?,
        created_at: r.get("created_at")?,
    })
}

pub fn count_pending(conn: &Connection) -> Result<i64, Error> {
    Ok(conn.query_row("SELECT COUNT(*) FROM proposals WHERE status = 'pending'", [], |r| r.get(0))?)
}

pub fn propose(conn: &Connection, input: ProposalInput) -> Result<Proposal, Error> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(Error::Invalid("Judul usulan tidak boleh kosong.".into()));
    }
    if title.chars().count() > MAX_TITLE {
        return Err(Error::Invalid(format!("Judul terlalu panjang (maksimal {MAX_TITLE} karakter).")));
    }
    if input.body.chars().count() > MAX_BODY {
        return Err(Error::Invalid(format!("Isi terlalu panjang (maksimal {MAX_BODY} karakter).")));
    }
    if count_pending(conn)? >= MAX_PENDING {
        return Err(Error::Invalid("Sudah ada banyak usulan yang menunggu. Minta pengguna menyetujui atau menolaknya dulu.".into()));
    }
    let source: String = input.source.unwrap_or_default().trim().chars().take(MAX_SOURCE).collect();
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO proposals (id, kind, title, body, parent_id, source, created_at) VALUES (?1, 'page', ?2, ?3, ?4, ?5, ?6)",
        params![id, title, input.body, input.parent_id, source, utc_now()],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<Proposal, Error> {
    conn.query_row(&format!("SELECT {COLS} FROM proposals WHERE id = ?1"), [id], row)
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("Usulan tidak ditemukan: {id}")))
}

pub fn list_pending(conn: &Connection) -> Result<Vec<Proposal>, Error> {
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM proposals WHERE status = 'pending' ORDER BY created_at"))?;
    let rows = stmt.query_map([], row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Setujui usulan: buat halamannya (dokumen) dan tandai disetujui. Induk yang sudah hilang atau di
/// sampah diganti dengan akar; usulan yang sudah diputuskan tidak bisa disetujui lagi.
pub fn approve(conn: &Connection, id: &str) -> Result<pages::Page, Error> {
    let p = get(conn, id)?;
    // Klaim lebih dulu supaya dua jendela atau proses tidak membuat halaman ganda.
    let claimed = conn.execute(
        "UPDATE proposals SET status = 'approved', decided_at = ?2 WHERE id = ?1 AND status = 'pending'",
        params![id, utc_now()],
    )?;
    if claimed == 0 {
        return Err(Error::Invalid("Usulan ini sudah diputuskan.".into()));
    }
    let parent = p.parent_id.clone().filter(|pid| pages::get(conn, pid).map_or(false, |x| x.trashed_at.is_none()));
    let doc = markdown::to_doc(&p.body);
    let created = pages::create(
        conn,
        pages::NewPage {
            parent_id: parent,
            kind: "doc".into(),
            title: Some(p.title),
            content: Some(doc.to_string()),
            plain_text: Some(markdown::plain_text(&doc)),
        },
    );
    match created {
        Ok(page) => {
            conn.execute("UPDATE proposals SET page_id = ?2 WHERE id = ?1", params![id, page.node.id])?;
            Ok(page)
        }
        Err(e) => {
            conn.execute("UPDATE proposals SET status = 'pending', decided_at = NULL WHERE id = ?1", [id])?;
            Err(e)
        }
    }
}

pub fn reject(conn: &Connection, id: &str) -> Result<(), Error> {
    get(conn, id)?;
    let n = conn.execute(
        "UPDATE proposals SET status = 'rejected', decided_at = ?2 WHERE id = ?1 AND status = 'pending'",
        params![id, utc_now()],
    )?;
    if n == 0 {
        return Err(Error::Invalid("Usulan ini sudah diputuskan.".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn input(title: &str, body: &str) -> ProposalInput {
        ProposalInput { title: title.into(), body: body.into(), parent_id: None, source: Some("claude".into()) }
    }

    #[test]
    fn a_proposal_writes_nothing_until_approved() {
        let s = Store::open_in_memory().unwrap();
        s.with(|c| {
            let p = propose(c, input("Ringkasan", "# Isi\n\n- a"))?;
            assert_eq!(p.status, "pending");
            assert_eq!(count_pending(c)?, 1);
            assert!(pages::tree(c)?.is_empty(), "belum ada halaman sebelum disetujui");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn approving_creates_a_searchable_document_once() {
        let s = Store::open_in_memory().unwrap();
        s.with(|c| {
            let p = propose(c, input("Catatan fisika", "# Gaya\n\nF = m a"))?;
            let page = approve(c, &p.id)?;
            assert_eq!(page.node.title, "Catatan fisika");
            assert_eq!(page.node.kind, "doc");
            assert_eq!(pages::search(c, "gaya", 5)?.len(), 1);
            assert_eq!(count_pending(c)?, 0);
            assert_eq!(get(c, &p.id)?.page_id.as_deref(), Some(page.node.id.as_str()));
            let again = approve(c, &p.id).unwrap_err();
            assert!(again.to_string().contains("sudah diputuskan"));
            assert_eq!(pages::tree(c)?.len(), 1, "tidak ada halaman ganda");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn rejecting_keeps_the_workspace_untouched_and_blocks_approval() {
        let s = Store::open_in_memory().unwrap();
        s.with(|c| {
            let p = propose(c, input("Tidak jadi", "x"))?;
            reject(c, &p.id)?;
            assert!(pages::tree(c)?.is_empty());
            assert!(approve(c, &p.id).is_err());
            assert!(reject(c, &p.id).is_err());
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn a_missing_or_trashed_parent_falls_back_to_the_root() {
        let s = Store::open_in_memory().unwrap();
        s.with(|c| {
            let folder = pages::create(c, pages::NewPage { kind: "doc".into(), title: Some("Induk".into()), ..Default::default() })?;
            let mut i = input("Anak", "x");
            i.parent_id = Some(folder.node.id.clone());
            let ok = approve(c, &propose(c, i)?.id)?;
            assert_eq!(ok.node.parent_id.as_deref(), Some(folder.node.id.as_str()));

            pages::trash(c, &folder.node.id)?;
            let mut j = input("Yatim", "x");
            j.parent_id = Some(folder.node.id.clone());
            assert_eq!(approve(c, &propose(c, j)?.id)?.node.parent_id, None);
            let mut k = input("Hilang", "x");
            k.parent_id = Some("tidak-ada".into());
            assert_eq!(approve(c, &propose(c, k)?.id)?.node.parent_id, None);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn input_is_validated_and_the_queue_is_capped() {
        let s = Store::open_in_memory().unwrap();
        s.with(|c| {
            assert!(propose(c, input("   ", "x")).is_err());
            assert!(propose(c, input(&"j".repeat(301), "x")).is_err());
            assert!(propose(c, input("a", &"b".repeat(100_001))).is_err());
            for n in 0..MAX_PENDING {
                propose(c, input(&format!("u{n}"), ""))?;
            }
            let err = propose(c, input("terlalu banyak", "")).unwrap_err();
            assert!(err.to_string().contains("banyak usulan"));
            let long = ProposalInput { title: "s".into(), body: String::new(), parent_id: None, source: Some("x".repeat(500)) };
            assert!(propose(c, long).is_err(), "antrean penuh");
            Ok(())
        })
        .unwrap();
    }
}
