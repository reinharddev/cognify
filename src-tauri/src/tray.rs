//! Ikon menu bar / system tray (PRD #17): akses cepat tanpa membuka jendela dulu.
//!
//! Menu: Buka Cognify, Catatan cepat, Belajar, Pengingat, Pantau clipboard (centang),
//! jumlah pengingat hari ini (diperbarui UI lewat `tray_update`), Keluar.
//! Item navigasi memunculkan jendela lalu mengirim event `tray-navigate` berisi path halaman.
//!
//! "Tetap berjalan di menu bar saat jendela ditutup" (`set_keep_in_tray`) default mati, jadi
//! menutup jendela tetap menutup app.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::clipboard::ClipboardWatcher;

pub const NAVIGATE_EVENT: &str = "tray-navigate";
pub const CLIPBOARD_TOGGLE_EVENT: &str = "tray-clipboard-toggle";

pub struct Tray {
    pub keep_running: AtomicBool,
    reminders: Mutex<Option<MenuItem<Wry>>>,
    clipboard: Mutex<Option<CheckMenuItem<Wry>>>,
}

impl Tray {
    pub fn new() -> Self {
        Self { keep_running: AtomicBool::new(false), reminders: Mutex::new(None), clipboard: Mutex::new(None) }
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Buka Cognify", true, None::<&str>)?;
    let note = MenuItem::with_id(app, "note", "Catatan melayang baru", true, None::<&str>)?;
    let study = MenuItem::with_id(app, "study", "Belajar", true, None::<&str>)?;
    let reminders = MenuItem::with_id(app, "reminders", "Pengingat hari ini", true, None::<&str>)?;
    let clipboard = CheckMenuItem::with_id(app, "clipboard", "Pantau clipboard", true, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(
        app,
        &[&open, &sep()?, &note, &study, &sep()?, &reminders, &clipboard, &sep()?, &quit],
    )?;

    let state = app.state::<Tray>();
    *state.reminders.lock().unwrap() = Some(reminders);
    *state.clipboard.lock().unwrap() = Some(clipboard);

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true) // macOS: ikut warna menu bar (terang/gelap)
        .tooltip("Cognify")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let route = match event.id().as_ref() {
                "open" => Some(""),
                "note" => {
                    if let Err(e) = crate::sticky::new_note(app) {
                        log::warn!("Catatan melayang baru gagal: {e}");
                    }
                    None
                }
                "study" => Some("/study"),
                "reminders" => Some("/reminders"),
                "clipboard" => {
                    let watcher = app.state::<ClipboardWatcher>();
                    let enabled = !watcher.enabled();
                    watcher.set_enabled(enabled);
                    set_clipboard_checked(app, enabled);
                    let _ = app.emit(CLIPBOARD_TOGGLE_EVENT, enabled); // UI menyimpan ke pengaturan
                    None
                }
                "quit" => {
                    app.exit(0);
                    None
                }
                _ => None,
            };
            if let Some(route) = route {
                show_main(app);
                if !route.is_empty() {
                    let _ = app.emit(NAVIGATE_EVENT, route);
                }
            }
        })
        .build(app)?;
    Ok(())
}

pub fn set_clipboard_checked(app: &AppHandle, checked: bool) {
    if let Some(item) = app.state::<Tray>().clipboard.lock().unwrap().as_ref() {
        let _ = item.set_checked(checked);
    }
}

/// Dipanggil UI: jumlah pengingat hari ini (teks menu).
#[tauri::command]
pub fn tray_update(app: AppHandle, reminders_today: u32) {
    let text = match reminders_today {
        0 => "Tidak ada pengingat hari ini".to_string(),
        n => format!("{n} pengingat hari ini"),
    };
    if let Some(item) = app.state::<Tray>().reminders.lock().unwrap().as_ref() {
        let _ = item.set_text(text);
    }
}

/// Dipanggil UI dari pengaturan `keep_in_tray`.
#[tauri::command]
pub fn set_keep_in_tray(app: AppHandle, enabled: bool) {
    app.state::<Tray>().keep_running.store(enabled, Ordering::SeqCst);
}
