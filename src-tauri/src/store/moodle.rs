//! Tugas dan tenggat dari Moodle: tabel `moodle_items` (salinan lokal) dan pembacaan jawaban Moodle.
//! Jaringan dan keychain ada di `crate::moodle`; di sini hanya data dan penguraian, supaya mudah diuji.

use rusqlite::{Connection, params};
use serde::Serialize;
use serde_json::Value;

use super::{Error, time::{format_millis, utc_now}};

const MAX_ITEMS: usize = 500;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub course: String,
    pub title: String,
    /// Tenggat, UTC ISO-8601.
    pub due: String,
    pub submitted: bool,
    /// todo (belum), draft (konsep disimpan, sedang dikerjakan), submitted (sudah dikumpulkan atau dinilai)
    pub state: String,
    pub url: Option<String>,
}

/// Tugas (assign) yang belum dicek status pengumpulannya.
#[derive(Debug, PartialEq)]
pub struct Assign {
    pub id: i64,
    pub course: String,
    pub title: String,
    pub due_secs: i64,
    pub cmid: i64,
}

pub fn list(conn: &Connection) -> Result<Vec<Item>, Error> {
    let mut stmt = conn.prepare("SELECT id, course, title, due, submitted, url, state FROM moodle_items ORDER BY due, title")?;
    let rows = stmt.query_map([], |r| {
        Ok(Item { id: r.get(0)?, course: r.get(1)?, title: r.get(2)?, due: r.get(3)?, submitted: r.get::<_, i64>(4)? != 0, url: r.get(5)?, state: r.get(6)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Ganti seluruh isi dengan hasil sinkron terbaru (satu transaksi).
pub fn replace_all(conn: &Connection, items: &[Item]) -> Result<(), Error> {
    let now = utc_now();
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM moodle_items", [])?;
    for it in items.iter().take(MAX_ITEMS) {
        tx.execute(
            "INSERT OR REPLACE INTO moodle_items (id, course, title, due, submitted, url, fetched_at, state) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![it.id, it.course, it.title, it.due, it.submitted as i64, it.url, now, it.state],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn now() -> String {
    utc_now()
}

pub fn clear(conn: &Connection) -> Result<(), Error> {
    conn.execute("DELETE FROM moodle_items", [])?;
    Ok(())
}

pub fn count(conn: &Connection) -> Result<i64, Error> {
    Ok(conn.query_row("SELECT COUNT(*) FROM moodle_items", [], |r| r.get(0))?)
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

fn int(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}

/// Id mata pelajaran dari `core_enrol_get_users_courses`.
pub fn parse_course_ids(v: &Value) -> Vec<i64> {
    v.as_array().map(|a| a.iter().map(|c| int(c, "id")).filter(|id| *id > 0).collect()).unwrap_or_default()
}

/// Tugas bertenggat dari `mod_assign_get_assignments`. Tenggat lebih lama dari `since_secs` dilewati.
pub fn parse_assignments(v: &Value, since_secs: i64) -> Vec<Assign> {
    let mut out = Vec::new();
    for course in v.get("courses").and_then(Value::as_array).into_iter().flatten() {
        let name = text(course, "fullname");
        for a in course.get("assignments").and_then(Value::as_array).into_iter().flatten() {
            let due = int(a, "duedate");
            let id = int(a, "id");
            let title = text(a, "name");
            if due <= 0 || due < since_secs || id <= 0 || title.is_empty() {
                continue;
            }
            out.push(Assign { id, course: name.clone(), title, due_secs: due, cmid: int(a, "cmid") });
        }
    }
    out
}

/// Sudah dikumpulkan? Konsep draf belum dihitung; tugas yang sudah dinilai dihitung selesai.
pub fn parse_submitted(v: &Value) -> bool {
    let last = v.get("lastattempt");
    let status = last.and_then(|l| l.get("submission")).map(|s| text(s, "status")).unwrap_or_default();
    status == "submitted" || last.and_then(|l| l.get("graded")).and_then(Value::as_bool).unwrap_or(false)
}

/// Status tiga tingkat: "submitted" (sudah dikumpulkan atau dinilai), "draft" (konsep disimpan, sedang dikerjakan), selain itu "todo".
pub fn parse_state(v: &Value) -> &'static str {
    if parse_submitted(v) {
        return "submitted";
    }
    let status = v.get("lastattempt").and_then(|l| l.get("submission")).map(|s| text(s, "status")).unwrap_or_default();
    if status == "draft" { "draft" } else { "todo" }
}

/// Tenggat modul lain (kuis, pelajaran, dan lainnya) dari `core_calendar_get_action_events_by_timesort`.
/// Tugas (assign) dilewati karena sudah diambil lengkap dengan status pengumpulannya.
pub fn parse_action_events(v: &Value, base: &str) -> Vec<Item> {
    let mut out = Vec::new();
    for e in v.get("events").and_then(Value::as_array).into_iter().flatten() {
        if text(e, "modulename") == "assign" {
            continue;
        }
        let secs = int(e, "timesort");
        let id = int(e, "id");
        let title = {
            let t = text(e, "activityname");
            if t.is_empty() { text(e, "name") } else { t }
        };
        if secs <= 0 || id <= 0 || title.is_empty() {
            continue;
        }
        let url = text(e, "url");
        out.push(Item {
            id: format!("event:{id}"),
            course: e.get("course").map(|c| text(c, "fullname")).unwrap_or_default(),
            title,
            due: format_millis(secs * 1000),
            submitted: false,
            state: "todo".into(),
            url: if url.starts_with(base) { Some(url) } else { None },
        });
    }
    out
}

pub fn assign_item(a: &Assign, state: &str, base: &str) -> Item {
    Item {
        id: format!("assign:{}", a.id),
        course: a.course.clone(),
        title: a.title.clone(),
        due: format_millis(a.due_secs * 1000),
        submitted: state == "submitted",
        state: state.to_string(),
        url: (a.cmid > 0).then(|| format!("{base}/mod/assign/view.php?id={}", a.cmid)),
    }
}

// ── Mata pelajaran dan materi (berkas) ───────────────────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: i64,
    pub name: String,
    pub files: i64,
    pub saved: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub id: String,
    pub course_id: i64,
    pub section: String,
    pub module: String,
    pub filename: String,
    pub filepath: String,
    pub size: i64,
    pub mime: String,
    pub modified: i64,
    /// remote, queued, downloading, done, error
    pub state: String,
    pub local_path: Option<String>,
    pub bytes_done: i64,
    pub error: Option<String>,
}

/// Berkas dari Moodle yang belum punya status lokal.
#[derive(Debug, PartialEq, Clone)]
pub struct FileMeta {
    pub id: String,
    pub section: String,
    pub module: String,
    pub filename: String,
    pub filepath: String,
    pub size: i64,
    pub mime: String,
    pub url: String,
    pub modified: i64,
}

pub fn parse_courses(v: &Value) -> Vec<(i64, String)> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    let id = int(c, "id");
                    let name = text(c, "fullname");
                    (id > 0 && !name.is_empty()).then_some((id, name))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Hasil membaca isi satu mata pelajaran: berkas yang bisa diunduh, ringkasan isi yang bukan berkas
/// (halaman, kuis, tautan, dan lainnya), dan jumlah berkas di server lain yang dilewati.
#[derive(Debug, Default)]
pub struct Parsed {
    pub files: Vec<FileMeta>,
    pub other: Vec<(String, usize)>,
    pub foreign: usize,
}

/// Berkas materi dari `core_course_get_contents`. Hanya modul berkas (resource) dan folder, hanya yang terlihat
/// pengguna, dan hanya alamat di server Moodle sendiri (`allowed`: alamat yang diketik dan alamat situs yang dilaporkan
/// Moodle). Alamat lain dilewati supaya token tidak terkirim ke tempat lain, tapi dihitung agar bisa dijelaskan.
pub fn parse_contents(v: &Value, course_id: i64, allowed: &[String]) -> Parsed {
    let mut out = Parsed::default();
    let mut other: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for section in v.as_array().into_iter().flatten() {
        let section_name = text(section, "name");
        for module in section.get("modules").and_then(Value::as_array).into_iter().flatten() {
            let kind = text(module, "modname");
            if module.get("uservisible").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            if kind != "resource" && kind != "folder" {
                // Teks pengantar (label) tidak berarti bagi murid; sisanya dihitung per jenis.
                if !kind.is_empty() && kind != "label" {
                    *other.entry(kind).or_insert(0) += 1;
                }
                continue;
            }
            let module_id = int(module, "id");
            let module_name = text(module, "name");
            for c in module.get("contents").and_then(Value::as_array).into_iter().flatten() {
                let filename = text(c, "filename");
                let url = text(c, "fileurl");
                if text(c, "type") != "file" || filename.is_empty() {
                    continue;
                }
                if !allowed.iter().any(|b| url.starts_with(&format!("{b}/"))) {
                    out.foreign += 1;
                    continue;
                }
                let filepath = {
                    let p = text(c, "filepath");
                    if p.is_empty() { "/".to_string() } else { p }
                };
                out.files.push(FileMeta {
                    id: format!("{course_id}:{module_id}:{filepath}{filename}"),
                    section: section_name.clone(),
                    module: module_name.clone(),
                    filename,
                    filepath,
                    size: int(c, "filesize"),
                    mime: text(c, "mimetype"),
                    url,
                    modified: int(c, "timemodified"),
                });
            }
        }
    }
    out.other = other.into_iter().collect();
    out
}

/// Nama berkas aman untuk disimpan di disk: tanpa pemisah jalur, tanpa karakter kendali, dan tidak terlalu panjang.
pub fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '.' | '-' | '_' | '(' | ')') { c } else { '_' })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c == ' ');
    let base = if trimmed.is_empty() { "berkas" } else { trimmed };
    base.chars().take(120).collect()
}

/// Hash pendek yang stabil (FNV-1a) agar dua berkas ber-nama sama tidak bertabrakan di disk.
pub fn short_hash(text: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")[..10].to_string()
}

pub fn courses_replace(conn: &Connection, courses: &[(i64, String)]) -> Result<(), Error> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM moodle_courses", [])?;
    for (id, name) in courses {
        tx.execute("INSERT OR REPLACE INTO moodle_courses (id, name) VALUES (?1, ?2)", params![id, name])?;
    }
    tx.commit()?;
    Ok(())
}

pub fn courses_list(conn: &Connection) -> Result<Vec<Course>, Error> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, COUNT(f.id), COALESCE(SUM(f.state = 'done'), 0)
         FROM moodle_courses c LEFT JOIN moodle_files f ON f.course_id = c.id GROUP BY c.id ORDER BY c.name",
    )?;
    let rows = stmt.query_map([], |r| Ok(Course { id: r.get(0)?, name: r.get(1)?, files: r.get(2)?, saved: r.get(3)? }))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn file_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<File> {
    Ok(File {
        id: r.get(0)?, course_id: r.get(1)?, section: r.get(2)?, module: r.get(3)?, filename: r.get(4)?, filepath: r.get(5)?,
        size: r.get(6)?, mime: r.get(7)?, modified: r.get(8)?, state: r.get(9)?, local_path: r.get(10)?, bytes_done: r.get(11)?, error: r.get(12)?,
    })
}

const FILE_COLS: &str = "id, course_id, section, module, filename, filepath, size, mime, modified, state, local_path, bytes_done, error";

pub fn files_list(conn: &Connection, course_id: i64) -> Result<Vec<File>, Error> {
    let mut stmt = conn.prepare(&format!("SELECT {FILE_COLS} FROM moodle_files WHERE course_id = ?1 ORDER BY position"))?;
    let rows = stmt.query_map([course_id], file_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn file_get(conn: &Connection, id: &str) -> Result<Option<File>, Error> {
    use rusqlite::OptionalExtension;
    Ok(conn.query_row(&format!("SELECT {FILE_COLS} FROM moodle_files WHERE id = ?1"), [id], file_row).optional()?)
}

/// Perbarui daftar berkas satu mata pelajaran dari Moodle. Status lokal berkas yang sama dipertahankan; berkas yang
/// diganti guru (waktu ubah berbeda) kembali ke "remote". Mengembalikan jalur salinan lokal yang harus dihapus dari disk.
pub fn files_upsert(conn: &Connection, course_id: i64, metas: &[FileMeta]) -> Result<Vec<String>, Error> {
    let now = utc_now();
    let mut stale = Vec::new();
    let tx = conn.unchecked_transaction()?;
    for (i, m) in metas.iter().enumerate() {
        let existing: Option<(i64, Option<String>)> = {
            use rusqlite::OptionalExtension;
            tx.query_row("SELECT modified, local_path FROM moodle_files WHERE id = ?1", [&m.id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?
        };
        match existing {
            None => {
                tx.execute(
                    "INSERT INTO moodle_files (id, course_id, section, module, filename, filepath, size, mime, url, modified, position, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![m.id, course_id, m.section, m.module, m.filename, m.filepath, m.size, m.mime, m.url, m.modified, i as i64, now],
                )?;
            }
            Some((modified, local)) => {
                let changed = modified != m.modified && m.modified > 0;
                if changed {
                    if let Some(p) = local {
                        stale.push(p);
                    }
                    tx.execute(
                        "UPDATE moodle_files SET state = 'remote', local_path = NULL, bytes_done = 0, error = NULL WHERE id = ?1 AND state != 'downloading'",
                        [&m.id],
                    )?;
                }
                tx.execute(
                    "UPDATE moodle_files SET section = ?2, module = ?3, filename = ?4, filepath = ?5, size = ?6, mime = ?7, url = ?8, modified = ?9, position = ?10, updated_at = ?11 WHERE id = ?1",
                    params![m.id, m.section, m.module, m.filename, m.filepath, m.size, m.mime, m.url, m.modified, i as i64, now],
                )?;
            }
        }
    }
    // Berkas yang sudah tidak ada di Moodle dibuang, kecuali yang sudah tersimpan (salinannya tetap milik murid).
    let keep: std::collections::HashSet<&str> = metas.iter().map(|m| m.id.as_str()).collect();
    let current: Vec<(String, String)> = {
        let mut stmt = tx.prepare("SELECT id, state FROM moodle_files WHERE course_id = ?1")?;
        let rows = stmt.query_map([course_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    for (id, state) in current {
        if !keep.contains(id.as_str()) && state != "done" && state != "downloading" {
            tx.execute("DELETE FROM moodle_files WHERE id = ?1", [&id])?;
        }
    }
    tx.commit()?;
    Ok(stale)
}

/// Antrekan unduhan (hanya yang belum tersimpan atau gagal).
pub fn enqueue(conn: &Connection, ids: &[String]) -> Result<(), Error> {
    let now = utc_now();
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute(
            "UPDATE moodle_files SET state = 'queued', error = NULL, bytes_done = 0, updated_at = ?2 WHERE id = ?1 AND state IN ('remote', 'error')",
            params![id, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Ambil satu berkas dari antrean untuk diunduh (urut waktu antre).
pub fn claim_next(conn: &Connection) -> Result<Option<(String, i64, String)>, Error> {
    use rusqlite::OptionalExtension;
    let tx = conn.unchecked_transaction()?;
    let row: Option<(String, i64, String)> = tx
        .query_row("SELECT id, course_id, url FROM moodle_files WHERE state = 'queued' ORDER BY updated_at, position LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?;
    if let Some((id, _, _)) = &row {
        tx.execute("UPDATE moodle_files SET state = 'downloading', bytes_done = 0, error = NULL WHERE id = ?1", [id])?;
    }
    tx.commit()?;
    Ok(row)
}

pub fn has_queued(conn: &Connection) -> Result<bool, Error> {
    Ok(conn.query_row("SELECT EXISTS (SELECT 1 FROM moodle_files WHERE state = 'queued')", [], |r| r.get::<_, i64>(0))? != 0)
}

pub fn is_downloading(conn: &Connection, id: &str) -> Result<bool, Error> {
    Ok(conn.query_row("SELECT EXISTS (SELECT 1 FROM moodle_files WHERE id = ?1 AND state = 'downloading')", [id], |r| r.get::<_, i64>(0))? != 0)
}

pub fn set_progress(conn: &Connection, id: &str, bytes: i64) -> Result<(), Error> {
    conn.execute("UPDATE moodle_files SET bytes_done = ?2 WHERE id = ?1 AND state = 'downloading'", params![id, bytes])?;
    Ok(())
}

pub fn finish(conn: &Connection, id: &str, local_path: &str, size: i64) -> Result<(), Error> {
    conn.execute(
        "UPDATE moodle_files SET state = 'done', local_path = ?2, bytes_done = ?3, size = CASE WHEN size = 0 THEN ?3 ELSE size END, error = NULL, updated_at = ?4 WHERE id = ?1",
        params![id, local_path, size, utc_now()],
    )?;
    Ok(())
}

pub fn fail(conn: &Connection, id: &str, message: &str) -> Result<(), Error> {
    conn.execute("UPDATE moodle_files SET state = 'error', error = ?2, updated_at = ?3 WHERE id = ?1 AND state = 'downloading'", params![id, message, utc_now()])?;
    Ok(())
}

/// Batalkan antrean (yang sedang berjalan berhenti sendiri saat melihat statusnya berubah).
pub fn cancel(conn: &Connection, ids: &[String]) -> Result<(), Error> {
    for id in ids {
        conn.execute("UPDATE moodle_files SET state = 'remote', bytes_done = 0 WHERE id = ?1 AND state IN ('queued', 'downloading')", [id])?;
    }
    Ok(())
}

/// Lepas salinan lokal; mengembalikan jalur yang harus dihapus dari disk.
pub fn forget_local(conn: &Connection, ids: &[String]) -> Result<Vec<String>, Error> {
    let mut paths = Vec::new();
    for id in ids {
        if let Some(p) = conn.query_row("SELECT local_path FROM moodle_files WHERE id = ?1 AND state = 'done'", [id], |r| r.get::<_, Option<String>>(0)).ok().flatten() {
            paths.push(p);
        }
        conn.execute("UPDATE moodle_files SET state = 'remote', local_path = NULL, bytes_done = 0 WHERE id = ?1 AND state = 'done'", [id])?;
    }
    Ok(paths)
}

/// Saat app dibuka: unduhan yang terputus kembali ke antrean.
pub fn resume_interrupted(conn: &Connection) -> Result<(), Error> {
    conn.execute("UPDATE moodle_files SET state = 'queued', bytes_done = 0 WHERE state = 'downloading'", [])?;
    Ok(())
}

pub fn clear_materials(conn: &Connection) -> Result<(), Error> {
    conn.execute("DELETE FROM moodle_files", [])?;
    conn.execute("DELETE FROM moodle_links", [])?;
    conn.execute("DELETE FROM moodle_modules", [])?;
    conn.execute("DELETE FROM moodle_courses", [])?;
    Ok(())
}

// ── Halaman, tautan, dan embed ───────────────────────────────────────────────────

const MAX_BODY: usize = 20_000;
const MAX_LINKS_PER_PAGE: usize = 12;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub id: String,
    pub course_id: i64,
    pub section: String,
    pub module: String,
    /// page (teks halaman), embed (iframe di halaman), link (tautan biasa)
    pub kind: String,
    pub title: String,
    pub url: String,
    pub provider: String,
    /// Alamat yang bisa dimuat di dalam Cognify (saat ini hanya Canva); kosong bila tidak bisa.
    pub embed_url: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkMeta {
    pub id: String,
    pub section: String,
    pub module: String,
    pub kind: String,
    pub title: String,
    pub url: String,
    pub body: String,
}

/// Modul halaman (page) yang isinya (`index.html`) perlu diambil.
#[derive(Debug, Clone, PartialEq)]
pub struct PageRef {
    pub module_id: i64,
    pub title: String,
    pub section: String,
    pub index_url: String,
}

fn provider_of(url: &str) -> &'static str {
    let host = reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_ascii_lowercase)).unwrap_or_default();
    let has = |d: &str| host == d || host.ends_with(&format!(".{d}"));
    if has("canva.com") || has("canva.link") {
        "canva"
    } else if has("youtube.com") || has("youtu.be") || has("youtube-nocookie.com") {
        "youtube"
    } else if host == "docs.google.com" || has("drive.google.com") {
        "google"
    } else if has("vimeo.com") {
        "vimeo"
    } else if has("figma.com") {
        "figma"
    } else if has("padlet.com") {
        "padlet"
    } else if has("genial.ly") || has("genially.com") {
        "genially"
    } else {
        "link"
    }
}

/// Alamat embed resmi Canva (`.../view?embed`) dari tautan desain; None bila bukan tautan desain Canva.
pub fn canva_embed(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    let host = u.host_str()?.to_ascii_lowercase();
    if u.scheme() != "https" || !(host == "www.canva.com" || host == "canva.com") {
        return None;
    }
    let seg: Vec<&str> = u.path_segments()?.filter(|s| !s.is_empty()).collect();
    if seg.first() != Some(&"design") || seg.len() < 2 {
        return None;
    }
    let valid = |s: &str| !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let id = seg[1];
    if !valid(id) {
        return None;
    }
    // Segmen ketiga adalah kunci berbagi, kecuali kata aksi (view, edit, watch).
    let token = seg.get(2).filter(|t| !matches!(**t, "view" | "edit" | "watch" | "present") && valid(t));
    Some(match token {
        Some(t) => format!("https://www.canva.com/design/{id}/{t}/view?embed"),
        None => format!("https://www.canva.com/design/{id}/view?embed"),
    })
}

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&")
}

/// Nilai atribut dari satu tag HTML (kutip ganda, kutip tunggal, atau tanpa kutip).
fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find(name) {
        let start = from + i;
        let before_ok = start == 0 || lower.as_bytes()[start - 1].is_ascii_whitespace();
        let rest = tag[start + name.len()..].trim_start();
        if before_ok && rest.starts_with('=') {
            let v = rest[1..].trim_start();
            let value = match v.chars().next()? {
                q @ ('"' | '\'') => v[1..].split(q).next().unwrap_or("").to_string(),
                _ => v.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or("").to_string(),
            };
            return Some(decode_entities(value.trim()));
        }
        from = start + name.len();
    }
    None
}

/// Alamat https yang lengkap, atau None (alamat relatif, javascript:, data:, dan sejenisnya dibuang).
fn external_https(raw: &str) -> Option<String> {
    let r = raw.trim();
    let full = if let Some(rest) = r.strip_prefix("//") { format!("https://{rest}") } else { r.to_string() };
    if !full.starts_with("https://") || full.len() > 1000 || full.chars().any(char::is_whitespace) {
        return None;
    }
    reqwest::Url::parse(&full).ok().map(|u| u.to_string())
}

/// Tautan dari HTML halaman: (apakah iframe, alamat). Alamat di server Moodle sendiri (`own`) dilewati.
pub fn extract_links(html: &str, own: &[String]) -> Vec<(bool, String)> {
    let lower = html.to_ascii_lowercase();
    let mut out: Vec<(bool, String)> = Vec::new();
    for (tag_start, is_frame) in [("<iframe", true), ("<a", false)] {
        let mut from = 0;
        while let Some(i) = lower[from..].find(tag_start) {
            let start = from + i;
            from = start + tag_start.len();
            // "<a" harus diikuti spasi, bukan "<article" atau "<abbr".
            if !is_frame && !lower[from..].starts_with(|c: char| c.is_ascii_whitespace()) {
                continue;
            }
            let end = lower[start..].find('>').map(|e| start + e).unwrap_or(lower.len());
            let tag = &html[start..end];
            let value = attr(tag, if is_frame { "src" } else { "href" });
            if let Some(url) = value.as_deref().and_then(external_https) {
                if own.iter().any(|o| url.starts_with(&format!("{o}/"))) || out.iter().any(|(_, u)| *u == url) {
                    continue;
                }
                out.push((is_frame, url));
            }
        }
    }
    out
}

/// Teks polos dari HTML halaman, dengan baris baru di batas blok.
pub fn html_text(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut cleaned = String::with_capacity(html.len());
    let mut i = 0;
    let bytes = html.as_bytes();
    while i < html.len() {
        if bytes[i] == b'<' {
            // Lewati isi script dan style sepenuhnya.
            let skip = ["script", "style"].iter().find(|t| lower[i + 1..].starts_with(*t));
            if let Some(t) = skip {
                let close = format!("</{t}");
                i = lower[i..].find(&close).and_then(|c| lower[i + c..].find('>').map(|g| i + c + g + 1)).unwrap_or(html.len());
                continue;
            }
            let end = lower[i..].find('>').map(|e| i + e + 1).unwrap_or(html.len());
            let name: String = lower[i + 1..end].trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
            if matches!(name.as_str(), "br" | "p" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "ul" | "ol" | "table") {
                cleaned.push('\n');
            }
            i = end;
        } else {
            let ch = html[i..].chars().next().unwrap_or(' ');
            cleaned.push(ch);
            i += ch.len_utf8();
        }
    }
    let text = decode_entities(&cleaned);
    let lines: Vec<String> = text.lines().map(|l| l.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|l| !l.is_empty()).collect();
    let joined = lines.join("\n");
    joined.chars().take(MAX_BODY).collect()
}

/// Modul tautan (url) langsung menjadi item; modul halaman (page) dikembalikan untuk diambil isinya.
pub fn parse_link_modules(v: &Value, course_id: i64, allowed: &[String]) -> (Vec<LinkMeta>, Vec<PageRef>) {
    let mut links = Vec::new();
    let mut pages = Vec::new();
    for section in v.as_array().into_iter().flatten() {
        let section_name = text(section, "name");
        for module in section.get("modules").and_then(Value::as_array).into_iter().flatten() {
            if module.get("uservisible").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let kind = text(module, "modname");
            let module_id = int(module, "id");
            let title = text(module, "name");
            let contents = module.get("contents").and_then(Value::as_array);
            if kind == "url" {
                let target = contents.and_then(|c| c.first()).map(|c| text(c, "fileurl")).unwrap_or_default();
                if let Some(url) = external_https(&target) {
                    links.push(LinkMeta { id: format!("link:{course_id}:{module_id}"), section: section_name.clone(), module: title.clone(), kind: "link".into(), title, url, body: String::new() });
                }
            } else if kind == "page" {
                let index = contents
                    .into_iter()
                    .flatten()
                    .find(|c| text(c, "filename") == "index.html")
                    .map(|c| text(c, "fileurl"))
                    .unwrap_or_default();
                if allowed.iter().any(|b| index.starts_with(&format!("{b}/"))) {
                    pages.push(PageRef { module_id, title, section: section_name.clone(), index_url: index });
                }
            }
        }
    }
    (links, pages)
}

/// Item dari isi satu halaman: teksnya, lalu embed (iframe), lalu tautan biasa.
pub fn page_items(page: &PageRef, course_id: i64, html: &str, own: &[String]) -> Vec<LinkMeta> {
    let mut out = Vec::new();
    let body = html_text(html);
    if body.chars().count() >= 20 {
        out.push(LinkMeta { id: format!("page:{course_id}:{}", page.module_id), section: page.section.clone(), module: page.title.clone(), kind: "page".into(), title: page.title.clone(), url: String::new(), body });
    }
    for (n, (frame, url)) in extract_links(html, own).into_iter().take(MAX_LINKS_PER_PAGE).enumerate() {
        out.push(LinkMeta {
            id: format!("{}:{course_id}:{}:{n}", if frame { "embed" } else { "link" }, page.module_id),
            section: page.section.clone(),
            module: page.title.clone(),
            kind: if frame { "embed" } else { "link" }.into(),
            title: page.title.clone(),
            url,
            body: String::new(),
        });
    }
    out
}

pub fn links_replace(conn: &Connection, course_id: i64, metas: &[LinkMeta]) -> Result<(), Error> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM moodle_links WHERE course_id = ?1", [course_id])?;
    for (i, m) in metas.iter().enumerate() {
        tx.execute(
            "INSERT OR REPLACE INTO moodle_links (id, course_id, section, module, kind, title, url, provider, body, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![m.id, course_id, m.section, m.module, m.kind, m.title, m.url, if m.url.is_empty() { "link" } else { provider_of(&m.url) }, m.body, i as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn links_list(conn: &Connection, course_id: i64) -> Result<Vec<Link>, Error> {
    let mut stmt = conn.prepare("SELECT id, course_id, section, module, kind, title, url, provider, body FROM moodle_links WHERE course_id = ?1 ORDER BY position")?;
    let rows = stmt.query_map([course_id], |r| {
        let url: String = r.get(6)?;
        let provider: String = r.get(7)?;
        let embed_url = if provider == "canva" { canva_embed(&url) } else { None };
        Ok(Link { id: r.get(0)?, course_id: r.get(1)?, section: r.get(2)?, module: r.get(3)?, kind: r.get(4)?, title: r.get(5)?, url, provider, embed_url, body: r.get(8)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}


// ── Struktur lengkap mata pelajaran ──────────────────────────────────────────────

const MAX_DESC: usize = 4_000;

/// Satu baris struktur mata pelajaran: ringkasan sebuah bagian (`section`) atau satu modul (jenisnya = `modname` Moodle).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Module {
    /// `{course}:{module}` untuk modul, `section:{course}:{nomor}` untuk bagian.
    pub id: String,
    pub course_id: i64,
    pub section_pos: i64,
    pub section: String,
    /// section, atau jenis modul: resource, folder, page, url, label, quiz, forum, assign, dan lainnya.
    pub kind: String,
    pub name: String,
    /// Teks isi (label, pengantar kuis atau forum, ringkasan bagian), HTML sudah dibuang.
    pub description: String,
    /// Alamat modul di situs Moodle sendiri (kosong bila bukan server sendiri).
    pub url: String,
    /// Jumlah berkas pada modul berkas atau folder.
    pub files: i64,
}

/// Seluruh isi `core_course_get_contents` sebagai daftar berurutan: bagian lalu modul-modulnya, termasuk yang tidak
/// bisa diunduh. Modul yang tidak terlihat murid dilewati. Alamat modul hanya dipakai bila di server Moodle sendiri.
pub fn parse_structure(v: &Value, course_id: i64, allowed: &[String]) -> Vec<Module> {
    let mut out = Vec::new();
    for (si, section) in v.as_array().into_iter().flatten().enumerate() {
        let section_name = text(section, "name");
        let section_pos = si as i64;
        let summary: String = html_text(&text(section, "summary")).chars().take(MAX_DESC).collect();
        let modules: Vec<&Value> = section
            .get("modules")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|m| m.get("uservisible").and_then(Value::as_bool) != Some(false))
            .collect();
        if modules.is_empty() && summary.is_empty() {
            continue;
        }
        out.push(Module {
            id: format!("section:{course_id}:{si}"),
            course_id,
            section_pos,
            section: section_name.clone(),
            kind: "section".into(),
            name: section_name.clone(),
            description: summary,
            url: String::new(),
            files: 0,
        });
        for module in modules {
            let kind = text(module, "modname");
            if kind.is_empty() {
                continue;
            }
            let module_id = int(module, "id");
            // Label menyimpan isinya di `description`; namanya hanya potongan HTML-nya.
            let name: String = html_text(&text(module, "name")).replace('\n', " ").chars().take(120).collect();
            let description: String = html_text(&text(module, "description")).chars().take(MAX_DESC).collect();
            let url = text(module, "url");
            let url = if allowed.iter().any(|b| url.starts_with(&format!("{b}/"))) { url } else { String::new() };
            let files = module
                .get("contents")
                .and_then(Value::as_array)
                .map(|c| c.iter().filter(|f| text(f, "type") == "file").count() as i64)
                .unwrap_or(0);
            out.push(Module { id: format!("{course_id}:{module_id}"), course_id, section_pos, section: section_name.clone(), kind, name, description, url, files });
        }
    }
    out
}

pub fn structure_replace(conn: &Connection, course_id: i64, modules: &[Module]) -> Result<(), Error> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM moodle_modules WHERE course_id = ?1", [course_id])?;
    for (i, m) in modules.iter().enumerate() {
        tx.execute(
            "INSERT OR REPLACE INTO moodle_modules (id, course_id, section_pos, section, kind, name, description, url, files, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![m.id, course_id, m.section_pos, m.section, m.kind, m.name, m.description, m.url, m.files, i as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn structure_list(conn: &Connection, course_id: i64) -> Result<Vec<Module>, Error> {
    let mut stmt = conn.prepare("SELECT id, course_id, section_pos, section, kind, name, description, url, files FROM moodle_modules WHERE course_id = ?1 ORDER BY position")?;
    let rows = stmt.query_map([course_id], |r| {
        Ok(Module { id: r.get(0)?, course_id: r.get(1)?, section_pos: r.get(2)?, section: r.get(3)?, kind: r.get(4)?, name: r.get(5)?, description: r.get(6)?, url: r.get(7)?, files: r.get(8)? })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        super::super::schema::migrate(&c).unwrap();
        c
    }

    #[test]
    fn course_ids_skip_invalid() {
        assert_eq!(parse_course_ids(&json!([{"id": 4}, {"id": 0}, {"x": 1}, {"id": 9}])), vec![4, 9]);
        assert!(parse_course_ids(&json!({"exception": "x"})).is_empty());
    }

    #[test]
    fn assignments_need_due_date_and_recent() {
        let v = json!({"courses": [{"fullname": "Fisika", "assignments": [
            {"id": 1, "cmid": 11, "name": "Laporan", "duedate": 2000},
            {"id": 2, "cmid": 12, "name": "Tanpa tenggat", "duedate": 0},
            {"id": 3, "cmid": 13, "name": "Lama", "duedate": 10},
            {"id": 4, "name": "", "duedate": 3000}
        ]}]});
        let a = parse_assignments(&v, 1000);
        assert_eq!(a.len(), 1);
        assert_eq!((a[0].id, a[0].cmid, a[0].course.as_str(), a[0].due_secs), (1, 11, "Fisika", 2000));
    }

    #[test]
    fn submitted_only_when_really_submitted_or_graded() {
        assert!(parse_submitted(&json!({"lastattempt": {"submission": {"status": "submitted"}}})));
        assert!(!parse_submitted(&json!({"lastattempt": {"submission": {"status": "draft"}}})));
        assert!(!parse_submitted(&json!({"lastattempt": {"submission": {"status": "new"}}})));
        assert!(parse_submitted(&json!({"lastattempt": {"graded": true, "submission": {"status": "new"}}})));
        assert!(!parse_submitted(&json!({})));
    }

    #[test]
    fn action_events_skip_assign_and_foreign_links() {
        let v = json!({"events": [
            {"id": 1, "modulename": "assign", "name": "Tugas", "timesort": 2000},
            {"id": 2, "modulename": "quiz", "name": "Kuis 1 closes", "activityname": "Kuis 1", "timesort": 3000, "url": "https://lms.example/mod/quiz/view.php?id=5", "course": {"fullname": "Kimia"}},
            {"id": 3, "modulename": "quiz", "name": "Kuis 2", "timesort": 3000, "url": "https://evil.example/x"}
        ]});
        let items = parse_action_events(&v, "https://lms.example");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Kuis 1");
        assert_eq!(items[0].course, "Kimia");
        assert!(items[0].url.is_some());
        assert!(items[1].url.is_none());
    }

    #[test]
    fn replace_all_roundtrip_and_clear() {
        let c = db();
        let it = |id: &str, due: &str, sub: bool| Item { id: id.into(), course: "K".into(), title: id.into(), due: due.into(), submitted: sub, state: if sub { "submitted" } else { "todo" }.into(), url: None };
        replace_all(&c, &[it("b", "2026-11-06T00:00:00.000Z", false), it("a", "2026-11-05T00:00:00.000Z", true)]).unwrap();
        let got = list(&c).unwrap();
        assert_eq!(got.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert!(got[0].submitted);
        replace_all(&c, &[it("c", "2026-11-07T00:00:00.000Z", false)]).unwrap();
        assert_eq!(count(&c).unwrap(), 1);
        clear(&c).unwrap();
        assert_eq!(count(&c).unwrap(), 0);
    }

    #[test]
    fn contents_keep_only_own_server_files_in_visible_modules() {
        let v = json!([{"name": "Bab 1", "modules": [
            {"id": 10, "modname": "resource", "name": "Slide", "contents": [
                {"type": "file", "filename": "slide.pdf", "filepath": "/", "filesize": 1000, "mimetype": "application/pdf", "timemodified": 5, "fileurl": "https://lms.example/webservice/pluginfile.php/1/a.pdf"},
                {"type": "file", "filename": "asing.pdf", "fileurl": "https://evil.example/a.pdf"},
                {"type": "url", "filename": "tautan", "fileurl": "https://lms.example/x"}
            ]},
            {"id": 11, "modname": "forum", "name": "Forum", "contents": []},
            {"id": 12, "modname": "folder", "name": "Latihan", "uservisible": false, "contents": [
                {"type": "file", "filename": "x.pdf", "fileurl": "https://lms.example/y.pdf"}]},
            {"id": 13, "modname": "folder", "name": "Folder", "contents": [
                {"type": "file", "filename": "a.docx", "filepath": "/sub/", "fileurl": "https://lms.example/z.docx"}]}
        ]}]);
        let parsed = parse_contents(&v, 7, &["https://lms.example".to_string()]);
        let f = parsed.files;
        assert_eq!(parsed.foreign, 1); // asing.pdf di server lain
        assert_eq!(parsed.other, vec![("forum".to_string(), 1)]);
        assert_eq!(f.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["7:10:/slide.pdf", "7:13:/sub/a.docx"]);
        assert_eq!((f[0].size, f[0].modified, f[0].section.as_str()), (1000, 5, "Bab 1"));
    }

    #[test]
    fn safe_names_have_no_path_separators() {
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name("Bab 1: Vektor (final).pdf"), "Bab 1_ Vektor (final).pdf");
        assert_eq!(safe_name("..."), "berkas");
        assert!(safe_name(&"a".repeat(500)).len() <= 120);
        assert_eq!(short_hash("x"), short_hash("x"));
        assert_ne!(short_hash("x"), short_hash("y"));
    }

    fn meta(id: &str, modified: i64) -> FileMeta {
        FileMeta { id: id.into(), section: "S".into(), module: "M".into(), filename: id.into(), filepath: "/".into(), size: 10, mime: "".into(), url: "https://lms.example/f".into(), modified }
    }

    #[test]
    fn download_queue_lifecycle() {
        let c = db();
        courses_replace(&c, &[(1, "Fisika".into())]).unwrap();
        files_upsert(&c, 1, &[meta("a", 1), meta("b", 1)]).unwrap();
        enqueue(&c, &["a".into(), "b".into()]).unwrap();
        let (id, course, _) = claim_next(&c).unwrap().unwrap();
        assert_eq!((id.as_str(), course), ("a", 1));
        assert!(is_downloading(&c, "a").unwrap());
        set_progress(&c, "a", 5).unwrap();
        finish(&c, "a", "/tmp/a", 10).unwrap();
        assert_eq!(file_get(&c, "a").unwrap().unwrap().state, "done");
        let (id, _, _) = claim_next(&c).unwrap().unwrap();
        assert_eq!(id, "b");
        fail(&c, "b", "gagal").unwrap();
        assert_eq!(file_get(&c, "b").unwrap().unwrap().error.as_deref(), Some("gagal"));
        assert!(!has_queued(&c).unwrap());
        enqueue(&c, &["b".into()]).unwrap(); // yang gagal bisa diulang
        assert!(has_queued(&c).unwrap());
        assert_eq!(courses_list(&c).unwrap()[0].saved, 1);
    }

    #[test]
    fn changed_file_resets_and_returns_old_path_and_missing_files_are_dropped() {
        let c = db();
        files_upsert(&c, 1, &[meta("a", 1), meta("b", 1)]).unwrap();
        enqueue(&c, &["a".into()]).unwrap();
        claim_next(&c).unwrap();
        finish(&c, "a", "/tmp/a", 10).unwrap();
        // guru mengganti a dan menghapus b
        let stale = files_upsert(&c, 1, &[meta("a", 2)]).unwrap();
        assert_eq!(stale, vec!["/tmp/a".to_string()]);
        let a = file_get(&c, "a").unwrap().unwrap();
        assert_eq!((a.state.as_str(), a.local_path), ("remote", None));
        assert!(file_get(&c, "b").unwrap().is_none());
        // salinan yang sudah tersimpan tidak hilang walau berkas dihapus guru
        enqueue(&c, &["a".into()]).unwrap();
        claim_next(&c).unwrap();
        finish(&c, "a", "/tmp/a2", 10).unwrap();
        files_upsert(&c, 1, &[]).unwrap();
        assert!(file_get(&c, "a").unwrap().is_some());
        assert_eq!(forget_local(&c, &["a".into()]).unwrap(), vec!["/tmp/a2".to_string()]);
    }

    #[test]
    fn interrupted_downloads_resume_and_cancel_works() {
        let c = db();
        files_upsert(&c, 1, &[meta("a", 1), meta("b", 1)]).unwrap();
        enqueue(&c, &["a".into(), "b".into()]).unwrap();
        claim_next(&c).unwrap();
        resume_interrupted(&c).unwrap();
        assert_eq!(files_list(&c, 1).unwrap().iter().filter(|f| f.state == "queued").count(), 2);
        cancel(&c, &["a".into()]).unwrap();
        assert_eq!(file_get(&c, "a").unwrap().unwrap().state, "remote");
    }

    #[test]
    fn contents_accept_site_url_and_count_other_modules() {
        let v = json!([{"name": "A", "modules": [
            {"id": 1, "modname": "resource", "name": "R", "contents": [{"type": "file", "filename": "a.pdf", "fileurl": "https://www.lms.example/pluginfile.php/a.pdf"}]},
            {"id": 2, "modname": "page", "name": "P"}, {"id": 3, "modname": "page", "name": "P2"},
            {"id": 4, "modname": "quiz", "name": "Q"}, {"id": 5, "modname": "label", "name": "L"},
            {"id": 6, "modname": "url", "name": "U", "uservisible": false}
        ]}]);
        let only_typed = parse_contents(&v, 1, &["https://lms.example".to_string()]);
        assert!(only_typed.files.is_empty());
        assert_eq!(only_typed.foreign, 1);
        let both = parse_contents(&v, 1, &["https://lms.example".to_string(), "https://www.lms.example".to_string()]);
        assert_eq!(both.files.len(), 1);
        assert_eq!(both.other, vec![("page".to_string(), 2), ("quiz".to_string(), 1)]);
    }

    #[test]
    fn canva_links_become_official_embed_urls() {
        assert_eq!(canva_embed("https://www.canva.com/design/DAF123/AbCd_9/view?utm_content=x#1").as_deref(), Some("https://www.canva.com/design/DAF123/AbCd_9/view?embed"));
        assert_eq!(canva_embed("https://www.canva.com/design/DAF123/AbCd_9/edit").as_deref(), Some("https://www.canva.com/design/DAF123/AbCd_9/view?embed"));
        assert_eq!(canva_embed("https://www.canva.com/design/DAF123/view").as_deref(), Some("https://www.canva.com/design/DAF123/view?embed"));
        assert_eq!(canva_embed("https://www.canva.com/design/DAF123/AbCd_9/view?embed").as_deref(), Some("https://www.canva.com/design/DAF123/AbCd_9/view?embed"));
        assert!(canva_embed("https://evil.example/design/DAF123/x/view").is_none());
        assert!(canva_embed("http://www.canva.com/design/DAF123/x/view").is_none());
        assert!(canva_embed("https://www.canva.com.evil.example/design/DAF123/x/view").is_none());
        assert!(canva_embed("https://www.canva.com/templates/abc").is_none());
        assert!(canva_embed("https://www.canva.com/design/<script>/x").is_none());
    }

    #[test]
    fn links_are_found_in_html_and_own_server_and_unsafe_schemes_are_dropped() {
        let html = r#"<p>Materi</p><IFRAME style="x" src="https://www.canva.com/design/D1/T1/view?embed" allowfullscreen></iframe>
            <a href='https://youtu.be/abc'>video</a> <a class=x href=https://forms.gle/z>form</a>
            <a href="/mod/page/view.php?id=3">dalam</a> <a href="javascript:alert(1)">x</a> <a href="https://lms.example/file.php/1">sendiri</a>
            <a href="https://youtu.be/abc">duplikat</a> <article>teks</article> <a href="//cdn.example/x">proto</a>"#;
        let got = extract_links(html, &["https://lms.example".to_string()]);
        assert_eq!(
            got,
            vec![
                (true, "https://www.canva.com/design/D1/T1/view?embed".to_string()),
                (false, "https://youtu.be/abc".to_string()),
                (false, "https://forms.gle/z".to_string()),
                (false, "https://cdn.example/x".to_string()),
            ]
        );
    }

    #[test]
    fn html_text_drops_scripts_and_keeps_blocks() {
        let t = html_text("<style>p{}</style><h3>Judul &amp; isi</h3><p>Baris   satu<br>baris dua</p><script>alert('x')</script><ul><li>a</li><li>b</li></ul>");
        assert_eq!(t, "Judul & isi\nBaris satu\nbaris dua\na\nb");
    }

    #[test]
    fn link_modules_and_page_items() {
        let allowed = vec!["https://lms.example".to_string()];
        let v = json!([{"name": "Bab 1", "modules": [
            {"id": 1, "modname": "url", "name": "Referensi", "contents": [{"type": "url", "fileurl": "https://example.org/ref"}]},
            {"id": 2, "modname": "url", "name": "Buruk", "contents": [{"type": "url", "fileurl": "javascript:x"}]},
            {"id": 3, "modname": "page", "name": "Materi EDA", "contents": [{"type": "file", "filename": "index.html", "fileurl": "https://lms.example/webservice/pluginfile.php/9/index.html"}]},
            {"id": 4, "modname": "page", "name": "Asing", "contents": [{"type": "file", "filename": "index.html", "fileurl": "https://evil.example/index.html"}]}
        ]}]);
        let (links, pages) = parse_link_modules(&v, 5, &allowed);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.org/ref");
        assert_eq!(pages.len(), 1);
        let items = page_items(&pages[0], 5, "<p>Materi eksplorasi data yang cukup panjang.</p><iframe src=\"https://www.canva.com/design/D/T/view?embed\"></iframe>", &allowed);
        assert_eq!(items.iter().map(|i| i.kind.as_str()).collect::<Vec<_>>(), vec!["page", "embed"]);
        let c = db();
        let mut all = links;
        all.extend(items);
        links_replace(&c, 5, &all).unwrap();
        let listed = links_list(&c, 5).unwrap();
        assert_eq!(listed.len(), 3);
        let embed = listed.iter().find(|l| l.kind == "embed").unwrap();
        assert_eq!(embed.provider, "canva");
        assert_eq!(embed.embed_url.as_deref(), Some("https://www.canva.com/design/D/T/view?embed"));
        assert!(listed.iter().find(|l| l.kind == "link").unwrap().embed_url.is_none());
        links_replace(&c, 5, &[]).unwrap();
        assert!(links_list(&c, 5).unwrap().is_empty());
    }

    #[test]
    fn state_has_three_levels() {
        assert_eq!(parse_state(&json!({"lastattempt": {"submission": {"status": "submitted"}}})), "submitted");
        assert_eq!(parse_state(&json!({"lastattempt": {"graded": true, "submission": {"status": "new"}}})), "submitted");
        assert_eq!(parse_state(&json!({"lastattempt": {"submission": {"status": "draft"}}})), "draft");
        assert_eq!(parse_state(&json!({"lastattempt": {"submission": {"status": "new"}}})), "todo");
        assert_eq!(parse_state(&json!({})), "todo");
        let a = Assign { id: 1, course: "K".into(), title: "T".into(), due_secs: 100, cmid: 5 };
        assert!(assign_item(&a, "submitted", "https://x").submitted);
        let d = assign_item(&a, "draft", "https://x");
        assert!(!d.submitted);
        assert_eq!(d.state, "draft");
    }

    #[test]
    fn state_survives_the_database() {
        let c = db();
        let mk = |id: &str, st: &str| Item { id: id.into(), course: "K".into(), title: id.into(), due: "2026-11-06T00:00:00.000Z".into(), submitted: st == "submitted", state: st.into(), url: None };
        replace_all(&c, &[mk("a", "todo"), mk("b", "draft"), mk("c", "submitted")]).unwrap();
        let got = list(&c).unwrap();
        assert_eq!(got.iter().map(|i| (i.id.as_str(), i.state.as_str(), i.submitted)).collect::<Vec<_>>(), vec![("a", "todo", false), ("b", "draft", false), ("c", "submitted", true)]);
    }

    #[test]
    fn structure_keeps_every_visible_module_in_order() {
        let allowed = vec!["https://lms.test".to_string()];
        let v = json!([
            {"name": "Minggu 1", "summary": "<p>Pengantar <b>bab</b> satu</p>", "modules": [
                {"id": 11, "modname": "label", "name": "<p>Selamat datang</p>", "description": "<p>Baca dulu <a href='x'>panduan</a></p>"},
                {"id": 12, "modname": "resource", "name": "Slide", "url": "https://lms.test/mod/resource/view.php?id=12", "contents": [{"type": "file", "filename": "a.pdf"}]},
                {"id": 13, "modname": "quiz", "name": "Kuis 1", "url": "https://evil.test/quiz", "description": ""},
                {"id": 14, "modname": "forum", "name": "Rahasia", "uservisible": false}
            ]},
            {"name": "Kosong", "summary": "", "modules": []},
            {"name": "", "summary": "", "modules": [{"id": 20, "modname": "assign", "name": "Tugas 1", "url": "https://lms.test/mod/assign/view.php?id=20"}]}
        ]);
        let s = parse_structure(&v, 5, &allowed);
        let kinds: Vec<_> = s.iter().map(|m| m.kind.as_str()).collect();
        assert_eq!(kinds, vec!["section", "label", "resource", "quiz", "section", "assign"], "bagian kosong dan modul tersembunyi dilewati");
        assert_eq!(s[0].description, "Pengantar bab satu");
        assert_eq!(s[1].description, "Baca dulu panduan");
        assert_eq!(s[2].files, 1);
        assert_eq!(s[2].url, "https://lms.test/mod/resource/view.php?id=12");
        assert!(s[3].url.is_empty(), "alamat server lain tidak dipakai");
        assert_eq!(s[3].id, "5:13");
        let c = db();
        structure_replace(&c, 5, &s).unwrap();
        assert_eq!(structure_list(&c, 5).unwrap(), s);
        structure_replace(&c, 5, &s[..2]).unwrap();
        assert_eq!(structure_list(&c, 5).unwrap().len(), 2, "mengganti, bukan menambah");
        assert!(structure_list(&c, 6).unwrap().is_empty());
        clear_materials(&c).unwrap();
        assert!(structure_list(&c, 5).unwrap().is_empty());
    }
}
