//! Skema database dan migrasinya. `PRAGMA user_version` menyimpan versi terakhir yang diterapkan.
//! Skema berubah: tambahkan entri baru di `MIGRATIONS`, jangan ubah yang lama.

use rusqlite::Connection;

use super::Error;

const MIGRATIONS: &[&str] = &[
    // 1: pohon halaman, tag, pencarian teks, dan pengaturan.
    r#"
    CREATE TABLE pages (
        id          TEXT PRIMARY KEY,
        parent_id   TEXT REFERENCES pages(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('doc', 'board', 'table')),
        title       TEXT NOT NULL DEFAULT '',
        icon        TEXT,
        content     TEXT NOT NULL DEFAULT '',
        plain_text  TEXT NOT NULL DEFAULT '',
        position    REAL NOT NULL DEFAULT 0,
        favorite    INTEGER NOT NULL DEFAULT 0,
        trashed_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    CREATE INDEX pages_parent ON pages (parent_id, position);
    CREATE INDEX pages_trashed ON pages (trashed_at);

    CREATE TABLE page_tags (
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        tag     TEXT NOT NULL,
        PRIMARY KEY (page_id, tag)
    );
    CREATE INDEX page_tags_tag ON page_tags (tag);

    CREATE VIRTUAL TABLE pages_fts USING fts5(
        title, plain_text,
        content = 'pages', content_rowid = 'rowid',
        tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
    );
    CREATE TRIGGER pages_fts_insert AFTER INSERT ON pages BEGIN
        INSERT INTO pages_fts (rowid, title, plain_text) VALUES (new.rowid, new.title, new.plain_text);
    END;
    CREATE TRIGGER pages_fts_delete AFTER DELETE ON pages BEGIN
        INSERT INTO pages_fts (pages_fts, rowid, title, plain_text) VALUES ('delete', old.rowid, old.title, old.plain_text);
    END;
    CREATE TRIGGER pages_fts_update AFTER UPDATE OF title, plain_text ON pages BEGIN
        INSERT INTO pages_fts (pages_fts, rowid, title, plain_text) VALUES ('delete', old.rowid, old.title, old.plain_text);
        INSERT INTO pages_fts (rowid, title, plain_text) VALUES (new.rowid, new.title, new.plain_text);
    END;

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    // 2: kalender. Acara buatan pengguna dan langganan ICS (teks mentahnya disimpan, diuraikan klien).
    r#"
    CREATE TABLE events (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        notes        TEXT NOT NULL DEFAULT '',
        -- Acara berjam: UTC ISO-8601 ("2026-10-22T08:00:00.000Z"). Acara sehari penuh: tanggal lokal ("2026-10-22").
        start        TEXT NOT NULL,
        end          TEXT,
        all_day      INTEGER NOT NULL DEFAULT 0,
        repeat       TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
        repeat_until TEXT,
        remind_min   INTEGER,
        color        TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
    );
    CREATE INDEX events_start ON events (start);

    CREATE TABLE calendar_sources (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        kind       TEXT NOT NULL CHECK (kind IN ('url', 'file')),
        url        TEXT,
        color      TEXT,
        ics        TEXT NOT NULL DEFAULT '',
        fetched_at TEXT,
        error      TEXT,
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
    );
    "#,
    // 3: usulan dari klien MCP (AI). Tidak ada yang tertulis ke halaman sebelum pengguna menyetujui.
    r#"
    CREATE TABLE proposals (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL CHECK (kind IN ('page')),
        title      TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        parent_id  TEXT,
        source     TEXT NOT NULL DEFAULT '',
        status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        page_id    TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
    );
    CREATE INDEX proposals_status ON proposals (status, created_at);
    "#,
    // 4: data sumber halaman web hasil simpan dari ekstensi (CSL-JSON) dan penunjuk tiap sorotan, bahan sitasi.
    r#"
    CREATE TABLE page_sources (
        page_id    TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    "#,
    // 5: jenis halaman baru "folder" (wadah tanpa isi sendiri). CHECK pada `kind` tidak bisa diubah di tempat, jadi tabel
    // dibangun ulang dengan prosedur resmi SQLite (kunci asing dimatikan selama migrasi, lihat `migrate`); rowid dijaga
    // supaya indeks pencarian (FTS5, memakai rowid) tetap cocok. Induk buatan app (Kliping web, Catatan melayang) diubah jadi folder.
    r#"
    CREATE TABLE pages_new (
        id          TEXT PRIMARY KEY,
        parent_id   TEXT REFERENCES pages(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('doc', 'board', 'table', 'folder')),
        title       TEXT NOT NULL DEFAULT '',
        icon        TEXT,
        content     TEXT NOT NULL DEFAULT '',
        plain_text  TEXT NOT NULL DEFAULT '',
        position    REAL NOT NULL DEFAULT 0,
        favorite    INTEGER NOT NULL DEFAULT 0,
        trashed_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    INSERT INTO pages_new (rowid, id, parent_id, kind, title, icon, content, plain_text, position, favorite, trashed_at, created_at, updated_at)
        SELECT rowid, id, parent_id, kind, title, icon, content, plain_text, position, favorite, trashed_at, created_at, updated_at FROM pages;
    DROP TABLE pages;
    ALTER TABLE pages_new RENAME TO pages;
    CREATE INDEX pages_parent ON pages (parent_id, position);
    CREATE INDEX pages_trashed ON pages (trashed_at);
    CREATE TRIGGER pages_fts_insert AFTER INSERT ON pages BEGIN
        INSERT INTO pages_fts (rowid, title, plain_text) VALUES (new.rowid, new.title, new.plain_text);
    END;
    CREATE TRIGGER pages_fts_delete AFTER DELETE ON pages BEGIN
        INSERT INTO pages_fts (pages_fts, rowid, title, plain_text) VALUES ('delete', old.rowid, old.title, old.plain_text);
    END;
    CREATE TRIGGER pages_fts_update AFTER UPDATE OF title, plain_text ON pages BEGIN
        INSERT INTO pages_fts (pages_fts, rowid, title, plain_text) VALUES ('delete', old.rowid, old.title, old.plain_text);
        INSERT INTO pages_fts (rowid, title, plain_text) VALUES (new.rowid, new.title, new.plain_text);
    END;
    UPDATE pages SET kind = 'folder', content = '', plain_text = ''
        WHERE id IN (SELECT value FROM settings WHERE key IN ('sticky.folder', 'ext.folder'));
    "#,
];

pub const LATEST: u32 = MIGRATIONS.len() as u32;

pub fn migrate(conn: &Connection) -> Result<(), Error> {
    let current: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current > LATEST {
        return Err(Error::Invalid(format!(
            "Database berasal dari Cognify yang lebih baru (versi {current}, app ini memahami sampai {LATEST})."
        )));
    }
    // Kunci asing dimatikan selama migrasi (tidak berlaku di dalam transaksi, jadi sebelum dan sesudahnya): membangun ulang
    // tabel induk dengan DROP akan menghapus anak-anaknya lewat ON DELETE CASCADE bila tidak. Setelahnya diperiksa utuh.
    let foreign_keys: bool = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    if foreign_keys {
        conn.pragma_update(None, "foreign_keys", "OFF")?;
    }
    let violations = |conn: &Connection| -> Result<i64, Error> { Ok(conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?) };
    let before = violations(conn)?;
    let result = (|| -> Result<(), Error> {
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
            tx.commit()?;
        }
        // Hanya kerusakan yang ditimbulkan migrasi yang menghentikan app; rujukan yatim lama (dari penghapusan di luar
        // app) tidak boleh membuat database tidak bisa dibuka.
        if violations(conn)? > before {
            return Err(Error::Invalid("Migrasi database meninggalkan rujukan yang rusak.".into()));
        }
        Ok(())
    })();
    if foreign_keys {
        conn.pragma_update(None, "foreign_keys", "ON")?;
    }
    result
}

pub fn version(conn: &Connection) -> Result<u32, Error> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_orphan_rows_do_not_block_migration() {
        let conn = Connection::open_in_memory().unwrap();
        for (i, sql) in MIGRATIONS.iter().enumerate().take(4) {
            conn.execute_batch(sql).unwrap();
            conn.execute_batch(&format!("PRAGMA user_version = {}", i + 1)).unwrap();
        }
        // Tag yatim: halamannya sudah dihapus lewat jalur yang melewati kunci asing.
        conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
        conn.execute("INSERT INTO page_tags (page_id, tag) VALUES ('hilang', 'x')", []).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();
        assert_eq!(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0)).unwrap(), LATEST);
    }

    /// Database versi 4 berisi halaman, tag, sumber, pengaturan, dan indeks pencarian, lalu dimigrasikan ke versi terbaru:
    /// semua data harus utuh (tanpa anak yang terhapus berantai), pencarian tetap jalan, dan induk buatan app menjadi folder.
    #[test]
    fn migrating_to_folders_keeps_children_tags_sources_and_search() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for (i, sql) in MIGRATIONS.iter().enumerate().take(4) {
            conn.execute_batch(sql).unwrap();
            conn.execute_batch(&format!("PRAGMA user_version = {}", i + 1)).unwrap();
        }
        conn.execute_batch(
            "INSERT INTO pages (id, parent_id, kind, title, plain_text, position, created_at, updated_at) VALUES
               ('f', NULL, 'doc', 'Kliping web', '', 1, 't', 't'),
               ('a', 'f', 'doc', 'Artikel jeruk', 'jeruk manis dan segar', 1, 't', 't'),
               ('b', NULL, 'board', 'Papan', '', 2, 't', 't');
             INSERT INTO page_tags (page_id, tag) VALUES ('a', 'buah');
             INSERT INTO page_sources (page_id, data, updated_at) VALUES ('a', '{}', 't');
             INSERT INTO settings (key, value) VALUES ('ext.folder', 'f');",
        )
        .unwrap();

        migrate(&conn).unwrap();

        assert_eq!(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0)).unwrap(), LATEST);
        let kinds: Vec<(String, String)> = conn
            .prepare("SELECT id, kind FROM pages ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(kinds, vec![("a".into(), "doc".into()), ("b".into(), "board".into()), ("f".into(), "folder".into())]);
        let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM page_tags WHERE page_id = 'a'"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM page_sources WHERE page_id = 'a'"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM pages WHERE id = 'a' AND parent_id = 'f'"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM pages_fts WHERE pages_fts MATCH 'jeruk'"), 1);
        // Pemicu pencarian hidup lagi, dan jenis folder sekarang sah.
        conn.execute("INSERT INTO pages (id, kind, title, plain_text, created_at, updated_at) VALUES ('n', 'folder', 'Baru', 'pepaya', 't', 't')", []).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM pages_fts WHERE pages_fts MATCH 'pepaya'"), 1);
        assert!(conn.execute("INSERT INTO pages (id, kind, created_at, updated_at) VALUES ('x', 'lain', 't', 't')", []).is_err());
        // Kunci asing kembali menyala dan berjalan: menghapus induk menghapus anaknya.
        assert!(conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, bool>(0)).unwrap());
        conn.execute("DELETE FROM pages WHERE id = 'f'", []).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM pages WHERE id = 'a'"), 0);
    }
}
