//! Pantau clipboard: teks yang disalin dari aplikasi lain dikirim ke UI lewat event
//! `clipboard-captured`, lalu UI menyimpannya ke catatan kliping harian.
//!
//! Privasi: default MATI dan hanya jalan setelah user menyalakannya. Diabaikan: teks yang disalin
//! saat jendela Cognify aktif, teks pendek / satu kata (password, token, kode OTP), dan teks yang
//! sama dengan sebelumnya. Isi clipboard tidak pernah ditulis ke log.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub const CAPTURED_EVENT: &str = "clipboard-captured";
const POLL: Duration = Duration::from_millis(1500);
const IDLE_POLL: Duration = Duration::from_secs(3);
const MIN_CHARS: usize = 40;
const MIN_WORDS: usize = 6;
const MAX_CHARS: usize = 20_000;

pub struct ClipboardWatcher {
    enabled: AtomicBool,
    last: Mutex<Option<u64>>,
}

impl ClipboardWatcher {
    pub fn new() -> Self {
        Self { enabled: AtomicBool::new(false), last: Mutex::new(None) }
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }
}

fn hash(text: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    h.finish()
}

fn worth_saving(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.chars().count() >= MIN_CHARS
        && trimmed.chars().count() <= MAX_CHARS
        && trimmed.split_whitespace().count() >= MIN_WORDS
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        // Saat mati, clipboard tidak dibaca sama sekali (hemat CPU). Begitu menyala lagi, bacaan pertama
        // hanya dicatat sebagai dasar supaya isi lama tidak ikut tersimpan.
        let mut need_baseline = true;
        loop {
        let watcher = app.state::<ClipboardWatcher>();
        if !watcher.enabled() {
            need_baseline = true;
            thread::sleep(IDLE_POLL);
            continue;
        }
        thread::sleep(POLL);
        if !watcher.enabled() {
            continue;
        }
        let Ok(text) = app.clipboard().read_text() else { continue };
        let digest = hash(&text);
        let mut last = watcher.last.lock().unwrap();
        let changed = *last != Some(digest);
        *last = Some(digest);
        drop(last);
        if need_baseline {
            need_baseline = false;
            continue;
        }
        if !changed {
            continue;
        }
        let own_window = app
            .get_webview_window("main")
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false);
        if own_window || !worth_saving(&text) {
            continue;
        }
        let _ = app.emit(CAPTURED_EVENT, text);
        }
    });
}

/// Dipanggil UI saat pengaturan `clipboard_monitor` dimuat / diubah.
#[tauri::command]
pub fn set_clipboard_monitor(app: AppHandle, enabled: bool) {
    app.state::<ClipboardWatcher>().set_enabled(enabled);
    crate::tray::set_clipboard_checked(&app, enabled);
}
