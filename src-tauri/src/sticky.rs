//! Catatan melayang: jendela kecil transparan yang selalu di atas (seperti Stickies di Mac).
//!
//! Isinya adalah halaman dokumen biasa, jadi tersimpan di app dan bisa dibuka, dicari, dan disunting
//! seperti halaman lain. Catatan baru ditaruh di halaman induk "Catatan melayang". Rust hanya mengurus
//! jendela dan daftar yang sedang terbuka (`settings["stickies"]`, supaya terbuka lagi saat app dijalankan);
//! warna, posisi, dan ukuran disimpan jendelanya sendiri di `settings["sticky.<id>"]`.

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::store::pages::{self, NewPage};
use crate::store::{settings, Store};
use crate::tray;

const INDEX_KEY: &str = "stickies";
const FOLDER_KEY: &str = "sticky.folder";
const FOLDER_TITLE: &str = "Catatan melayang";
/// Dikirim ke semua jendela saat catatan melayang membuat, mengubah, atau membuang halaman: jendela utama memuat ulang daftar halamannya.
pub const PAGES_CHANGED: &str = "pages-changed";

/// Pintasan global bawaan; dipakai dari aplikasi mana pun.
pub const SHORTCUT: &str = "CommandOrControl+Alt+N";

/// Ukuran jendela (piksel logis) termasuk ruang di sekeliling kartu (40 di sisi, 30 atas, 60 bawah untuk bayangan)
/// supaya kartu bisa berayun tanpa terpotong tepi jendela.
const DEFAULT_SIZE: (f64, f64) = (360.0, 420.0);
const MIN_SIZE: (f64, f64) = (300.0, 300.0);
/// Paling banyak jendela catatan terbuka bersamaan; yang ke-9 menutup yang tertua (halamannya tetap ada di app).
pub const MAX_OPEN: usize = 8;

type Res<T> = Result<T, String>;

/// Kunci pengaturan catatan: hanya huruf, angka, `_`, dan `.` yang diizinkan, jadi tanda hubung di id diganti.
fn record_key(id: &str) -> String {
    format!("sticky.{}", id.replace('-', "_"))
}

fn label(id: &str) -> String {
    format!("sticky-{id}")
}

/// Hanya karakter yang dipakai id halaman; menolak yang lain karena id masuk ke nama jendela dan URL.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[derive(Deserialize, Default)]
struct Geometry {
    x: Option<f64>,
    y: Option<f64>,
    w: Option<f64>,
    h: Option<f64>,
    pin: Option<bool>,
}

fn store(app: &AppHandle) -> tauri::State<'_, Store> {
    app.state::<Store>()
}

fn read_index(app: &AppHandle) -> Vec<String> {
    store(app)
        .with(|c| settings::get(c, INDEX_KEY))
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_index(app: &AppHandle, ids: &[String]) {
    if let Ok(json) = serde_json::to_string(ids) {
        let _ = store(app).with(|c| settings::set(c, INDEX_KEY, &json));
    }
}

/// Halaman induk "Catatan melayang": dipakai ulang selama masih ada dan tidak di sampah.
fn folder_id(app: &AppHandle) -> Res<String> {
    folder_in(&store(app))
}

/// Sama dengan `folder_id`, tapi langsung dari penyimpanan (dipakai juga oleh jembatan ekstensi).
pub fn folder_in(st: &Store) -> Res<String> {
    let existing = st.with(|c| settings::get(c, FOLDER_KEY)).map_err(|e| e.to_string())?;
    if let Some(id) = existing {
        if st.with(|c| pages::get(c, &id)).map(|p| p.trashed_at.is_none()).unwrap_or(false) {
            return Ok(id);
        }
    }
    let page = st
        .with(|c| pages::create(c, NewPage { parent_id: None, kind: "folder".into(), title: Some(FOLDER_TITLE.into()), content: None, plain_text: None }))
        .map_err(|e| e.to_string())?;
    let id = page.node.id;
    st.with(|c| settings::set(c, FOLDER_KEY, &id)).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Buka (atau munculkan) jendela catatan untuk halaman `id`.
pub fn open(app: &AppHandle, id: &str) -> Res<()> {
    if !valid_id(id) {
        return Err("Id halaman tidak sah.".into());
    }
    let name = label(id);
    if let Some(window) = app.get_webview_window(&name) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let geo: Geometry = store(app)
        .with(|c| settings::get(c, &record_key(id)))
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let open_now: Vec<String> = read_index(app).into_iter().filter(|i| app.get_webview_window(&label(i)).is_some()).collect();
    if open_now.len() >= MAX_OPEN {
        // Yang tertua ditutup (bukan dibuang): halamannya tetap di "Catatan melayang" dan bisa dibuka lagi dari sidebar.
        for old in &open_now[..=open_now.len() - MAX_OPEN] {
            close(app, old);
        }
    }
    let count = (open_now.len().min(MAX_OPEN - 1)) as f64;

    let mut builder = WebviewWindowBuilder::new(app, &name, WebviewUrl::App(format!("sticky/{id}").into()))
        .title("Catatan melayang")
        .inner_size(geo.w.unwrap_or(DEFAULT_SIZE.0).max(MIN_SIZE.0), geo.h.unwrap_or(DEFAULT_SIZE.1).max(MIN_SIZE.1))
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(geo.pin.unwrap_or(true))
        .focused(true);
    builder = match (geo.x, geo.y) {
        (Some(x), Some(y)) => builder.position(x, y),
        // Catatan baru bertumpuk menyerong supaya tidak menutupi yang sebelumnya.
        _ => builder.position(160.0 + count * 34.0, 120.0 + count * 34.0),
    };
    builder.build().map_err(|e| e.to_string())?;

    let mut ids = read_index(app);
    if !ids.iter().any(|i| i == id) {
        ids.push(id.to_string());
        write_index(app, &ids);
    }
    Ok(())
}

/// Tutup jendela catatan; halamannya tetap ada di app.
pub fn close(app: &AppHandle, id: &str) {
    let ids: Vec<String> = read_index(app).into_iter().filter(|i| i != id).collect();
    write_index(app, &ids);
    if let Some(window) = app.get_webview_window(&label(id)) {
        let _ = window.destroy();
    }
}

/// Catatan baru: halaman dokumen kosong di bawah "Catatan melayang", langsung terbuka sebagai jendela.
pub fn new_note(app: &AppHandle) -> Res<String> {
    let parent = folder_id(app)?;
    // Masih ada catatan kosong yang belum dipakai: munculkan itu, jangan menumpuk catatan kosong baru.
    let blank: Option<String> = store(app)
        .with(|c| {
            use rusqlite::OptionalExtension;
            Ok(c.query_row(
                "SELECT id FROM pages WHERE parent_id = ?1 AND trashed_at IS NULL AND title = '' AND plain_text = '' ORDER BY created_at DESC LIMIT 1",
                [&parent],
                |r| r.get::<_, String>(0),
            )
            .optional()?)
        })
        .ok()
        .flatten();
    if let Some(id) = blank {
        open(app, &id)?;
        return Ok(id);
    }
    let page = store(app)
        .with(|c| pages::create(c, NewPage { parent_id: Some(parent), kind: "doc".into(), title: None, content: None, plain_text: None }))
        .map_err(|e| e.to_string())?;
    let id = page.node.id;
    let _ = app.emit(PAGES_CHANGED, ());
    open(app, &id)?;
    Ok(id)
}

/// Buka lagi catatan yang terbuka saat app terakhir ditutup (yang halamannya sudah dibuang dilewati).
pub fn restore(app: &AppHandle) {
    let ids = read_index(app);
    let alive: Vec<String> = ids
        .into_iter()
        .filter(|id| store(app).with(|c| pages::get(c, id)).map(|p| p.trashed_at.is_none()).unwrap_or(false))
        .collect();
    write_index(app, &alive);
    for id in &alive {
        if let Err(e) = open(app, id) {
            log::warn!("Catatan melayang {id} tidak bisa dibuka: {e}");
        }
    }
}

/// Pasang atau lepas pintasan global.
pub fn set_shortcut(app: &AppHandle, enabled: bool) {
    let keys = app.global_shortcut();
    if enabled {
        if !keys.is_registered(SHORTCUT) {
            if let Err(e) = keys.register(SHORTCUT) {
                log::warn!("Pintasan {SHORTCUT} tidak bisa dipasang: {e}");
            }
        }
    } else {
        let _ = keys.unregister(SHORTCUT);
    }
}

/// Pintasan aktif kecuali pengguna mematikannya di Pengaturan (`prefs.stickyShortcut === false`).
pub fn shortcut_enabled_in_prefs(app: &AppHandle) -> bool {
    store(app)
        .with(|c| settings::get(c, "prefs"))
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("stickyShortcut").and_then(|b| b.as_bool()))
        .unwrap_or(true)
}

#[tauri::command]
pub fn sticky_new(app: AppHandle) -> Res<String> {
    new_note(&app)
}

#[tauri::command]
pub fn sticky_open(app: AppHandle, id: String) -> Res<()> {
    open(&app, &id)
}

#[tauri::command]
pub fn sticky_close(app: AppHandle, id: String) {
    close(&app, &id);
}

#[tauri::command]
pub fn sticky_pin(app: AppHandle, id: String, pinned: bool) {
    if let Some(window) = app.get_webview_window(&label(&id)) {
        let _ = window.set_always_on_top(pinned);
    }
}

/// Buka halaman catatan di jendela utama.
#[tauri::command]
pub fn sticky_open_in_main(app: AppHandle, id: String) {
    if !valid_id(&id) {
        return;
    }
    tray::show_main(&app);
    let _ = app.emit(tray::NAVIGATE_EVENT, format!("/p/{id}"));
}

#[tauri::command]
pub fn sticky_shortcut(app: AppHandle, enabled: bool) {
    set_shortcut(&app, enabled);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_must_be_plain_page_ids() {
        assert!(valid_id("a1b2-c3d4"));
        assert!(!valid_id(""));
        assert!(!valid_id("../etc"));
        assert!(!valid_id("a b"));
        assert!(!valid_id(&"x".repeat(65)));
    }

    #[test]
    fn record_keys_pass_the_settings_key_rules() {
        let key = record_key("0f8e2c1a-4b6d-4e8a-9c3b-1a2b3c4d5e6f");
        assert_eq!(key, "sticky.0f8e2c1a_4b6d_4e8a_9c3b_1a2b3c4d5e6f");
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);").unwrap();
        settings::set(&conn, &key, "{}").unwrap();
        settings::set(&conn, FOLDER_KEY, "x").unwrap();
        settings::set(&conn, INDEX_KEY, "[]").unwrap();
    }

    #[test]
    fn labels_are_prefixed_so_windows_can_be_recognised() {
        assert_eq!(label("abc"), "sticky-abc");
    }
}
