//! Kalender: acara buatan pengguna dan langganan ICS.
//!
//! Waktu acara berjam disimpan sebagai UTC ISO-8601 dan acara sehari penuh sebagai tanggal lokal
//! ("2026-10-22"). Pengulangan hanya dicatat di sini (`repeat`, `repeat_until`); klien yang
//! memperluasnya menjadi kemunculan, di zona waktu lokal, supaya jam acara tidak bergeser saat
//! zona waktu berganti jam musim panas. Langganan ICS menyimpan teks mentahnya dan klien yang
//! menguraikannya.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use super::{Error, time::utc_now};

const MAX_TITLE: usize = 300;
const MAX_NOTES: usize = 10_000;
const MAX_ICS: usize = 5 * 1024 * 1024;
const MAX_EVENTS: usize = 20_000;
const REPEATS: [&str; 5] = ["none", "daily", "weekly", "monthly", "yearly"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub start: String,
    pub end: Option<String>,
    pub all_day: bool,
    pub repeat: String,
    pub repeat_until: Option<String>,
    pub remind_min: Option<i64>,
    pub color: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub title: String,
    pub notes: Option<String>,
    pub start: String,
    pub end: Option<String>,
    pub all_day: bool,
    pub repeat: Option<String>,
    pub repeat_until: Option<String>,
    pub remind_min: Option<i64>,
    pub color: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub url: Option<String>,
    pub color: Option<String>,
    pub ics: String,
    pub fetched_at: Option<String>,
    pub error: Option<String>,
    pub enabled: bool,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceInput {
    pub name: String,
    pub kind: String,
    pub url: Option<String>,
    pub color: Option<String>,
    pub ics: Option<String>,
}

fn invalid(msg: &str) -> Error {
    Error::Invalid(msg.to_string())
}

/// "2026-10-22" (tanggal) atau "2026-10-22T08:00:00.000Z" (UTC); bentuk lain ditolak.
fn valid_when(s: &str, all_day: bool) -> bool {
    let b = s.as_bytes();
    let date_ok = |d: &[u8]| {
        d.len() == 10 && d[4] == b'-' && d[7] == b'-'
            && d.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
            && (1..=12).contains(&s[5..7].parse::<u32>().unwrap_or(0))
            && (1..=31).contains(&s[8..10].parse::<u32>().unwrap_or(0))
    };
    if all_day {
        return date_ok(b);
    }
    b.len() == 24
        && date_ok(&b[..10])
        && b[10] == b'T' && b[13] == b':' && b[16] == b':' && b[19] == b'.' && b[23] == b'Z'
        && [11, 12, 14, 15, 17, 18, 20, 21, 22].iter().all(|&i| b[i].is_ascii_digit())
        && s[11..13].parse::<u32>().unwrap_or(99) < 24
        && s[14..16].parse::<u32>().unwrap_or(99) < 60
        && s[17..19].parse::<u32>().unwrap_or(99) < 60
}

fn valid_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit())
}

struct Clean {
    title: String,
    notes: String,
    repeat: String,
    color: Option<String>,
}

fn clean(input: &EventInput) -> Result<Clean, Error> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(invalid("Beri judul pada acara."));
    }
    if title.chars().count() > MAX_TITLE {
        return Err(Error::Invalid(format!("Judul terlalu panjang (maksimal {MAX_TITLE} karakter).")));
    }
    let notes = input.notes.clone().unwrap_or_default();
    if notes.chars().count() > MAX_NOTES {
        return Err(invalid("Catatan acara terlalu panjang."));
    }
    if !valid_when(&input.start, input.all_day) {
        return Err(invalid("Waktu mulai tidak sah."));
    }
    if let Some(end) = &input.end {
        if !valid_when(end, input.all_day) {
            return Err(invalid("Waktu selesai tidak sah."));
        }
        if end.as_str() < input.start.as_str() {
            return Err(invalid("Acara tidak boleh selesai sebelum mulai."));
        }
    }
    let repeat = input.repeat.clone().unwrap_or_else(|| "none".into());
    if !REPEATS.contains(&repeat.as_str()) {
        return Err(invalid("Pengulangan harus none, daily, weekly, monthly, atau yearly."));
    }
    if let Some(until) = &input.repeat_until {
        if !valid_when(until, true) {
            return Err(invalid("Batas pengulangan harus berupa tanggal."));
        }
    }
    if input.remind_min.is_some_and(|m| !(0..=10_080).contains(&m)) {
        return Err(invalid("Pengingat harus antara 0 menit dan 7 hari sebelum acara."));
    }
    if input.color.as_deref().is_some_and(|c| !valid_color(c)) {
        return Err(invalid("Warna harus berbentuk #rrggbb."));
    }
    Ok(Clean { title: title.to_string(), notes, repeat, color: input.color.clone() })
}

fn event_from(r: &Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: r.get("id")?,
        title: r.get("title")?,
        notes: r.get("notes")?,
        start: r.get("start")?,
        end: r.get("end")?,
        all_day: r.get::<_, i64>("all_day")? != 0,
        repeat: r.get("repeat")?,
        repeat_until: r.get("repeat_until")?,
        remind_min: r.get("remind_min")?,
        color: r.get("color")?,
    })
}

const EVENT_COLS: &str = "id, title, notes, start, end, all_day, repeat, repeat_until, remind_min, color";

pub fn event_create(conn: &Connection, input: EventInput) -> Result<Event, Error> {
    let c = clean(&input)?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))?;
    if count as usize >= MAX_EVENTS {
        return Err(invalid("Terlalu banyak acara."));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = utc_now();
    conn.execute(
        "INSERT INTO events (id, title, notes, start, end, all_day, repeat, repeat_until, remind_min, color, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![id, c.title, c.notes, input.start, input.end, input.all_day as i64, c.repeat, input.repeat_until, input.remind_min, c.color, now],
    )?;
    event_get(conn, &id)
}

pub fn event_get(conn: &Connection, id: &str) -> Result<Event, Error> {
    conn.query_row(&format!("SELECT {EVENT_COLS} FROM events WHERE id = ?1"), [id], event_from)
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("Acara tidak ditemukan: {id}")))
}

pub fn event_update(conn: &Connection, id: &str, input: EventInput) -> Result<Event, Error> {
    event_get(conn, id)?;
    let c = clean(&input)?;
    conn.execute(
        "UPDATE events SET title = ?2, notes = ?3, start = ?4, end = ?5, all_day = ?6, repeat = ?7,
                repeat_until = ?8, remind_min = ?9, color = ?10, updated_at = ?11 WHERE id = ?1",
        params![id, c.title, c.notes, input.start, input.end, input.all_day as i64, c.repeat, input.repeat_until, input.remind_min, c.color, utc_now()],
    )?;
    event_get(conn, id)
}

pub fn event_delete(conn: &Connection, id: &str) -> Result<(), Error> {
    if conn.execute("DELETE FROM events WHERE id = ?1", [id])? == 0 {
        return Err(Error::NotFound(format!("Acara tidak ditemukan: {id}")));
    }
    Ok(())
}

/// Semua acara berurutan menurut waktu mulai; klien memperluas pengulangan dan menyaring rentang.
pub fn event_list(conn: &Connection) -> Result<Vec<Event>, Error> {
    let mut stmt = conn.prepare(&format!("SELECT {EVENT_COLS} FROM events ORDER BY start, created_at"))?;
    Ok(stmt.query_map([], event_from)?.collect::<Result<_, _>>()?)
}

// ── langganan ───────────────────────────────────────────────────────────────

fn source_from(r: &Row) -> rusqlite::Result<Source> {
    Ok(Source {
        id: r.get("id")?,
        name: r.get("name")?,
        kind: r.get("kind")?,
        url: r.get("url")?,
        color: r.get("color")?,
        ics: r.get("ics")?,
        fetched_at: r.get("fetched_at")?,
        error: r.get("error")?,
        enabled: r.get::<_, i64>("enabled")? != 0,
    })
}

const SOURCE_COLS: &str = "id, name, kind, url, color, ics, fetched_at, error, enabled";

/// Tautan langganan: `webcal://` menjadi `https://`; hanya https yang diterima.
pub fn normalize_url(raw: &str) -> Result<String, Error> {
    let t = raw.trim();
    let url = match t.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => t.to_string(),
    };
    if !url.starts_with("https://") || url.len() < 12 || url.len() > 2000 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(invalid("Tautan kalender harus berupa alamat https (atau webcal)."));
    }
    Ok(url)
}

pub fn check_ics(text: &str) -> Result<(), Error> {
    if text.len() > MAX_ICS {
        return Err(invalid("Berkas kalender terlalu besar (maksimal 5 MB)."));
    }
    if !text.trim_start().starts_with("BEGIN:VCALENDAR") {
        return Err(invalid("Isinya bukan kalender iCalendar (.ics)."));
    }
    Ok(())
}

pub fn source_create(conn: &Connection, input: SourceInput) -> Result<Source, Error> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(invalid("Beri nama kalender (maksimal 100 karakter)."));
    }
    if input.color.as_deref().is_some_and(|c| !valid_color(c)) {
        return Err(invalid("Warna harus berbentuk #rrggbb."));
    }
    let (url, ics) = match input.kind.as_str() {
        "url" => (Some(normalize_url(input.url.as_deref().unwrap_or(""))?), String::new()),
        "file" => {
            let ics = input.ics.clone().unwrap_or_default();
            check_ics(&ics)?;
            (None, ics)
        }
        _ => return Err(invalid("Jenis kalender harus url atau file.")),
    };
    let id = uuid::Uuid::new_v4().to_string();
    let now = utc_now();
    let fetched = (input.kind == "file").then(|| now.clone());
    conn.execute(
        "INSERT INTO calendar_sources (id, name, kind, url, color, ics, fetched_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, name, input.kind, url, input.color, ics, fetched, now],
    )?;
    source_get(conn, &id)
}

pub fn source_get(conn: &Connection, id: &str) -> Result<Source, Error> {
    conn.query_row(&format!("SELECT {SOURCE_COLS} FROM calendar_sources WHERE id = ?1"), [id], source_from)
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("Kalender tidak ditemukan: {id}")))
}

pub fn source_list(conn: &Connection) -> Result<Vec<Source>, Error> {
    let mut stmt = conn.prepare(&format!("SELECT {SOURCE_COLS} FROM calendar_sources ORDER BY created_at"))?;
    Ok(stmt.query_map([], source_from)?.collect::<Result<_, _>>()?)
}

/// Simpan hasil pengambilan: teks baru menghapus galat lama; galat tidak menghapus teks terakhir
/// yang berhasil, jadi kalender tetap tampil walau pembaruan gagal.
pub fn source_store_fetch(conn: &Connection, id: &str, result: Result<String, String>) -> Result<Source, Error> {
    source_get(conn, id)?;
    match result {
        Ok(text) => {
            check_ics(&text)?;
            conn.execute("UPDATE calendar_sources SET ics = ?2, fetched_at = ?3, error = NULL WHERE id = ?1", params![id, text, utc_now()])?;
        }
        Err(message) => {
            conn.execute("UPDATE calendar_sources SET error = ?2 WHERE id = ?1", params![id, message])?;
        }
    }
    source_get(conn, id)
}

pub fn source_set_enabled(conn: &Connection, id: &str, enabled: bool) -> Result<Source, Error> {
    source_get(conn, id)?;
    conn.execute("UPDATE calendar_sources SET enabled = ?2 WHERE id = ?1", params![id, enabled as i64])?;
    source_get(conn, id)
}

pub fn source_delete(conn: &Connection, id: &str) -> Result<(), Error> {
    if conn.execute("DELETE FROM calendar_sources WHERE id = ?1", [id])? == 0 {
        return Err(Error::NotFound(format!("Kalender tidak ditemukan: {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn input(title: &str, start: &str) -> EventInput {
        EventInput { title: title.into(), start: start.into(), ..Default::default() }
    }

    fn store() -> Store {
        Store::open_in_memory().unwrap()
    }

    const ICS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261022T080000Z\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn events_roundtrip_and_list_in_start_order() {
        store().with(|c| {
            let late = event_create(c, input("Siang", "2026-10-22T05:00:00.000Z"))?;
            let early = event_create(c, EventInput { notes: Some("bawa buku".into()), ..input("Pagi", "2026-10-22T01:00:00.000Z") })?;
            assert_eq!(event_list(c)?.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), ["Pagi", "Siang"]);
            assert_eq!((early.notes.as_str(), early.repeat.as_str(), early.all_day), ("bawa buku", "none", false));
            assert_eq!(event_get(c, &late.id)?.start, "2026-10-22T05:00:00.000Z");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn all_day_events_use_plain_dates_and_timed_events_need_utc_instants() {
        store().with(|c| {
            let day = EventInput { all_day: true, ..input("Ujian", "2026-10-23") };
            assert!(event_create(c, day).unwrap().all_day);
            assert!(event_create(c, EventInput { all_day: true, ..input("x", "2026-10-23T08:00:00.000Z") }).is_err(), "tanggal saja untuk sehari penuh");
            for bad in ["2026-10-22", "2026-10-22T08:00:00Z", "2026-10-22T25:00:00.000Z", "2026-13-01T08:00:00.000Z", "besok", "2026-10-22T08:00:00.000+07:00"] {
                assert!(event_create(c, input("x", bad)).is_err(), "{bad}");
            }
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn validation_covers_title_end_repeat_reminder_and_color() {
        store().with(|c| {
            let err = |i: EventInput| event_create(c, i).unwrap_err().to_string();
            assert!(err(input("   ", "2026-10-22T08:00:00.000Z")).contains("judul"));
            assert!(err(input(&"x".repeat(301), "2026-10-22T08:00:00.000Z")).contains("terlalu panjang"));
            assert!(err(EventInput { end: Some("2026-10-22T07:00:00.000Z".into()), ..input("x", "2026-10-22T08:00:00.000Z") }).contains("sebelum mulai"));
            assert!(err(EventInput { repeat: Some("hourly".into()), ..input("x", "2026-10-22T08:00:00.000Z") }).contains("Pengulangan"));
            assert!(err(EventInput { remind_min: Some(-1), ..input("x", "2026-10-22T08:00:00.000Z") }).contains("Pengingat"));
            assert!(err(EventInput { remind_min: Some(10_081), ..input("x", "2026-10-22T08:00:00.000Z") }).contains("Pengingat"));
            assert!(err(EventInput { color: Some("merah".into()), ..input("x", "2026-10-22T08:00:00.000Z") }).contains("Warna"));
            assert!(err(EventInput { repeat_until: Some("2026-10-22T08:00:00.000Z".into()), ..input("x", "2026-10-22T08:00:00.000Z") }).contains("tanggal"));
            let ok = event_create(c, EventInput {
                repeat: Some("weekly".into()), repeat_until: Some("2026-12-31".into()), remind_min: Some(15), color: Some("#4f46e5".into()),
                ..input("Les", "2026-10-22T08:00:00.000Z")
            })?;
            assert_eq!((ok.repeat.as_str(), ok.repeat_until.as_deref(), ok.remind_min), ("weekly", Some("2026-12-31"), Some(15)));
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn update_replaces_the_event_and_a_failed_update_changes_nothing() {
        store().with(|c| {
            let e = event_create(c, input("Awal", "2026-10-22T08:00:00.000Z"))?;
            let u = event_update(c, &e.id, EventInput { remind_min: Some(5), ..input("Baru", "2026-10-23T08:00:00.000Z") })?;
            assert_eq!((u.title.as_str(), u.remind_min), ("Baru", Some(5)));
            assert!(event_update(c, &e.id, input("", "2026-10-23T08:00:00.000Z")).is_err());
            assert_eq!(event_get(c, &e.id)?.title, "Baru");
            assert!(matches!(event_update(c, "tidak-ada", input("x", "2026-10-23T08:00:00.000Z")), Err(Error::NotFound(_))));
            event_delete(c, &e.id)?;
            assert!(matches!(event_delete(c, &e.id), Err(Error::NotFound(_))));
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn subscription_urls_are_normalized_and_only_https_is_accepted() {
        assert_eq!(normalize_url(" webcal://calendar.google.com/x.ics ").unwrap(), "https://calendar.google.com/x.ics");
        assert_eq!(normalize_url("https://outlook.live.com/owa/calendar/x/reachcalendar.ics").unwrap(), "https://outlook.live.com/owa/calendar/x/reachcalendar.ics");
        for bad in ["http://a.example/x.ics", "ftp://a.example/x", "file:///etc/passwd", "https://", "https://a b.example/x", "javascript:alert(1)", ""] {
            assert!(normalize_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_file_source_stores_its_text_and_a_url_source_waits_for_a_fetch() {
        store().with(|c| {
            let f = source_create(c, SourceInput { name: "Sekolah".into(), kind: "file".into(), ics: Some(ICS.into()), ..Default::default() })?;
            assert!(f.ics.contains("VEVENT") && f.fetched_at.is_some() && f.enabled);
            assert!(source_create(c, SourceInput { name: "Rusak".into(), kind: "file".into(), ics: Some("bukan ics".into()), ..Default::default() }).is_err());
            let u = source_create(c, SourceInput { name: "Google".into(), kind: "url".into(), url: Some("webcal://x.example/a.ics".into()), ..Default::default() })?;
            assert_eq!((u.url.as_deref(), u.ics.as_str(), u.fetched_at.clone()), (Some("https://x.example/a.ics"), "", None));
            assert!(source_create(c, SourceInput { name: "".into(), kind: "url".into(), url: Some("https://x.example/a.ics".into()), ..Default::default() }).is_err());
            assert!(source_create(c, SourceInput { name: "x".into(), kind: "ftp".into(), ..Default::default() }).is_err());
            assert_eq!(source_list(c)?.len(), 2);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn a_failed_refresh_keeps_the_last_good_text_and_a_good_one_clears_the_error() {
        store().with(|c| {
            let s = source_create(c, SourceInput { name: "Google".into(), kind: "url".into(), url: Some("https://x.example/a.ics".into()), ..Default::default() })?;
            let ok = source_store_fetch(c, &s.id, Ok(ICS.into()))?;
            assert!(ok.ics.contains("VEVENT") && ok.error.is_none() && ok.fetched_at.is_some());
            let bad = source_store_fetch(c, &s.id, Err("Tidak ada koneksi".into()))?;
            assert_eq!(bad.error.as_deref(), Some("Tidak ada koneksi"));
            assert!(bad.ics.contains("VEVENT"), "teks terakhir yang berhasil tetap ada");
            assert!(source_store_fetch(c, &s.id, Ok("<html>login</html>".into())).is_err(), "halaman login bukan kalender");
            assert!(source_get(c, &s.id)?.ics.contains("VEVENT"));
            let again = source_store_fetch(c, &s.id, Ok(ICS.into()))?;
            assert!(again.error.is_none());
            let off = source_set_enabled(c, &s.id, false)?;
            assert!(!off.enabled);
            source_delete(c, &s.id)?;
            assert!(matches!(source_get(c, &s.id), Err(Error::NotFound(_))));
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn oversized_calendar_text_is_refused() {
        let big = format!("BEGIN:VCALENDAR\n{}", "x".repeat(MAX_ICS));
        assert!(check_ics(&big).unwrap_err().to_string().contains("terlalu besar"));
    }
}
