//! Notch macOS: program Swift `cognify-notch` (folder `notch/`) yang menampilkan deadline,
//! catatan cepat, timer belajar, dan tempat menyeret file di notch layar.
//!
//! - Dinyalakan/dimatikan lewat pengaturan `notch` (UI → `set_notch`).
//! - Konfigurasi fitur dikirim lewat stdin (satu baris JSON); koneksi data Cognify ke notch dirancang ulang.
//! - Fitur yang dinyalakan: `{"type":"config",...}` saat start dan setiap pengaturan berubah.
//! - stdout notch: `{"type":"open","path":"/reminders"}` → jendela Cognify muncul di halaman itu.
//! - Cognify keluar/crash → stdin tertutup → notch ikut keluar.
//! - Lokasi program: `tauri dev` = `notch/.build/release/cognify-notch` (`npm run notch:build`);
//!   app terpasang = `Contents/MacOS/cognify-notch` (bundle.macOS.files).

use std::sync::{Arc, Mutex};
use tauri::AppHandle;

#[derive(Default)]
pub struct Notch {
    #[cfg(target_os = "macos")]
    inner: Mutex<imp::State>,
    #[cfg(not(target_os = "macos"))]
    _unused: Mutex<()>,
}

impl Notch {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn shutdown(&self) {
        #[cfg(target_os = "macos")]
        imp::stop(&mut self.inner.lock().unwrap());
    }
}

/// `features`: bagian notch yang dinyalakan, `{media, spectrum, calendar, camera, shortcuts, hud, power, devices, hotkey, clipboard, downloads, voice}` (bool).
#[tauri::command]
pub fn set_notch(app: AppHandle, notch: tauri::State<'_, Arc<Notch>>, enabled: bool, features: serde_json::Value) {
    #[cfg(target_os = "macos")]
    {
        let mut state = notch.inner.lock().unwrap();
        if enabled {
            imp::start(&app, &mut state, features);
        } else {
            imp::stop(&mut state);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, notch, enabled, features);
}

#[cfg(target_os = "macos")]
mod imp {
    use std::io::{BufRead, BufReader, Write};
    use std::path::PathBuf;
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;

    use tauri::{AppHandle, Emitter};

    use crate::tray::{show_main, NAVIGATE_EVENT};

    #[derive(Default)]
    pub struct State {
        child: Option<Child>,
        stdin: Option<Arc<Mutex<ChildStdin>>>,
        /// Dimatikan saat notch dihentikan.
        alive: Option<Arc<AtomicBool>>,
    }

    fn send(stdin: &Mutex<ChildStdin>, line: &serde_json::Value) -> bool {
        let mut pipe = stdin.lock().unwrap();
        writeln!(pipe, "{line}").and_then(|_| pipe.flush()).is_ok()
    }

    fn config_line(features: &serde_json::Value) -> serde_json::Value {
        let mut line = serde_json::json!({"type": "config"});
        if let (Some(obj), Some(src)) = (line.as_object_mut(), features.as_object()) {
            for (key, value) in src {
                if value.is_boolean() {
                    obj.insert(key.clone(), value.clone());
                }
            }
        }
        line
    }

    fn program() -> Option<PathBuf> {
        let path = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../notch/.build/release/cognify-notch")
        } else {
            std::env::current_exe().ok()?.parent()?.join("cognify-notch")
        };
        path.is_file().then_some(path)
    }

    pub fn start(app: &AppHandle, state: &mut State, features: serde_json::Value) {
        if let (Some(child), Some(stdin)) = (state.child.as_mut(), state.stdin.as_ref()) {
            if matches!(child.try_wait(), Ok(None)) {
                send(stdin, &config_line(&features)); // sudah berjalan: cukup perbarui fitur
                return;
            }
        }
        stop(state);
        let Some(path) = program() else {
            log::warn!("notch: program tidak ditemukan (jalankan `npm run notch:build`)");
            return;
        };
        let mut child = match Command::new(&path)
            .arg("--embedded") // tanpa ini program berjalan sebagai app mandiri "Cognify Notch"
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                log::warn!("notch: gagal dijalankan: {e}");
                return;
            }
        };
        let stdin = Arc::new(Mutex::new(child.stdin.take().expect("stdin piped")));
        send(&stdin, &config_line(&features));
        let stdout = child.stdout.take().expect("stdout piped");
        let alive = Arc::new(AtomicBool::new(true));

        // notch → Cognify: buka halaman.
        let handle = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                if msg["type"] == "open" {
                    if let Some(path) = msg["path"].as_str().filter(|p| p.starts_with('/')) {
                        show_main(&handle);
                        let _ = handle.emit(NAVIGATE_EVENT, path.to_string());
                    }
                }
            }
        });

        log::info!("notch berjalan ({})", path.display());
        state.child = Some(child);
        state.stdin = Some(stdin);
        state.alive = Some(alive);
    }

    pub fn stop(state: &mut State) {
        state.stdin = None;
        if let Some(alive) = state.alive.take() {
            alive.store(false, Ordering::SeqCst);
        }
        if let Some(mut child) = state.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
