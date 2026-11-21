//! Pengganti `tray.rs` di iOS dan Android: tidak ada ikon menu bar, jadi semuanya no-op.
//! API-nya sama dengan versi desktop supaya kode lain (notch, link, clipboard, sticky) tetap jalan.

use std::sync::atomic::AtomicBool;

use tauri::AppHandle;

pub const NAVIGATE_EVENT: &str = "tray-navigate";
pub const CLIPBOARD_TOGGLE_EVENT: &str = "tray-clipboard-toggle";

pub struct Tray {
    pub keep_running: AtomicBool,
}

impl Tray {
    pub fn new() -> Self {
        Tray { keep_running: AtomicBool::new(false) }
    }
}

pub fn show_main(_app: &AppHandle) {}

pub fn setup(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

pub fn set_clipboard_checked(_app: &AppHandle, _checked: bool) {}

#[tauri::command]
pub fn tray_update(_app: AppHandle, _reminders_today: u32) {}

#[tauri::command]
pub fn set_keep_in_tray(_app: AppHandle, _enabled: bool) {}
