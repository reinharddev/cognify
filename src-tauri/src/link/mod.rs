//! Hubungan ke Cognify Notch lewat berkas di folder bersama (lihat docs/NOTCH_LINK.md).
//! Cognify menulis persetujuan (`link.json`) dan membaca data (`notch-data.json`); tanpa jaringan.

pub mod model;

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use model::{NotchData, SUPPORTED_SCHEMA, MAX_FILE_BYTES};

const FOLDER: &str = "Cognify Link";
const CONSENT: &str = "link.json";
const DATA: &str = "notch-data.json";
const AGENDA: &str = "cognify-agenda.json";
const MAX_AGENDA_BYTES: usize = 1024 * 1024;
pub const CHANGED_EVENT: &str = "notch-data-changed";

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Share {
    pub clipboard: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Consent {
    pub schema: u32,
    pub enabled: bool,
    pub connected_at: String,
    pub share: Share,
}

/// Versi Cognify Notch paling lama yang bisa mengirim data ke Cognify. `None` = Notch di sistem ini
/// belum mendukungnya sama sekali.
pub fn min_notch_version() -> Option<&'static str> {
    if cfg!(target_os = "macos") {
        Some("1.0.13")
    } else if cfg!(windows) {
        Some("0.1.7")
    } else {
        None
    }
}

/// "1.0.13" menjadi [1, 0, 13]; bagian yang bukan angka (mis. "1.0.13-beta") membuat hasilnya `None`.
pub fn parse_version(v: &str) -> Option<Vec<u32>> {
    let parts: Option<Vec<u32>> = v.trim().trim_start_matches('v').split('.').map(|p| p.parse().ok()).collect();
    parts.filter(|p| !p.is_empty())
}

/// `version >= min`, membandingkan angka demi angka (1.0.9 lebih lama dari 1.0.13).
pub fn version_at_least(version: &str, min: &str) -> Option<bool> {
    let (mut a, mut b) = (parse_version(version)?, parse_version(min)?);
    let n = a.len().max(b.len());
    a.resize(n, 0);
    b.resize(n, 0);
    Some(a >= b)
}

/// Keadaan Notch di komputer ini; dipisah dari `status` supaya mudah diuji.
#[derive(Clone, Debug, Default)]
pub struct NotchEnv {
    pub installed: bool,
    pub installed_version: Option<String>,
    pub min_version: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    pub connected: bool,
    pub share_clipboard: bool,
    pub connected_at: Option<String>,
    /// Aplikasi Notch ditemukan di komputer ini (perkiraan berdasarkan lokasi pemasangan).
    pub notch_installed: bool,
    /// `updatedAt` dari data terakhir; klien menganggap Notch berjalan bila kurang dari 3 menit lalu.
    pub last_update: Option<String>,
    /// Data memakai format yang lebih baru dari yang dipahami Cognify ini.
    pub needs_newer_cognify: bool,
    pub folder: String,
    /// Notch di sistem ini sudah bisa terhubung ke Cognify. False di Windows sampai penulis datanya ada.
    pub link_available: bool,
    /// Versi Notch: dari data bila sudah ada, kalau belum dari aplikasi yang terpasang.
    pub notch_version: Option<String>,
    pub min_notch_version: Option<String>,
    /// Versi Notch diketahui dan lebih lama dari yang dibutuhkan.
    pub notch_outdated: bool,
}

fn now_iso() -> String {
    crate::store::now_iso()
}

// ── operasi murni pada satu folder (diuji dengan folder sementara) ─────────────

fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let tmp = dir.join(format!("{name}.tmp"));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Gagal menulis: {e}"))?;
        f.write_all(bytes).and_then(|_| f.sync_all()).map_err(|e| format!("Gagal menulis: {e}"))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, dir.join(name)).map_err(|e| format!("Gagal menulis: {e}"))
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Folder bersama tidak bisa dibuat: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

pub fn read_consent(dir: &Path) -> Option<Consent> {
    let c: Consent = serde_json::from_slice(&fs::read(dir.join(CONSENT)).ok()?).ok()?;
    c.enabled.then_some(c)
}

pub fn connect(dir: &Path, share_clipboard: bool) -> Result<(), String> {
    ensure_dir(dir)?;
    let consent = Consent { schema: 1, enabled: true, connected_at: now_iso(), share: Share { clipboard: share_clipboard } };
    write_atomic(dir, CONSENT, &serde_json::to_vec_pretty(&consent).map_err(|e| e.to_string())?)
}

pub fn set_share_clipboard(dir: &Path, on: bool) -> Result<(), String> {
    let mut c = read_consent(dir).ok_or("Belum terhubung ke Cognify Notch.")?;
    c.share.clipboard = on;
    write_atomic(dir, CONSENT, &serde_json::to_vec_pretty(&c).map_err(|e| e.to_string())?)
}

pub fn disconnect(dir: &Path) -> Result<(), String> {
    for name in [CONSENT, DATA, AGENDA, "link.json.tmp", "notch-data.json.tmp", "cognify-agenda.json.tmp"] {
        match fs::remove_file(dir.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Gagal memutuskan: {e}")),
        }
    }
    Ok(())
}

/// Agenda dari kalender Cognify untuk Notch (Windows memakainya sebagai pilihan sumber kalender). Hanya
/// ditulis selagi terhubung; paling besar 1 MB, dan harus JSON.
pub fn write_agenda(dir: &Path, json: &str) -> Result<(), String> {
    read_consent(dir).ok_or("Belum terhubung ke Cognify Notch.")?;
    if json.len() > MAX_AGENDA_BYTES {
        return Err("Agenda terlalu besar.".into());
    }
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("Agenda bukan JSON: {e}"))?;
    write_atomic(dir, AGENDA, json.as_bytes())
}

/// Data terbaru dari Notch, atau `None` bila belum terhubung atau belum ada berkas. Bagian clipboard
/// dibuang di sini bila pengguna tidak mengizinkannya, apa pun isi berkasnya.
pub fn read_data(dir: &Path) -> Result<Option<NotchData>, String> {
    let Some(consent) = read_consent(dir) else { return Ok(None) };
    let path = dir.join(DATA);
    let Ok(meta) = fs::metadata(&path) else { return Ok(None) };
    if meta.len() > MAX_FILE_BYTES {
        return Err("Berkas data Notch terlalu besar.".into());
    }
    let mut data = NotchData::parse(&fs::read(&path).map_err(|e| format!("Gagal membaca: {e}"))?)?;
    if !consent.share.clipboard {
        data.clipboard.clear();
    }
    Ok(Some(data))
}

pub fn status(dir: &Path, env: &NotchEnv) -> LinkStatus {
    let consent = read_consent(dir);
    let data = read_data(dir).ok().flatten();
    let schema = fs::read(dir.join(DATA)).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()).and_then(|v| v["schema"].as_u64());
    let data_version = data.as_ref().map(|d| d.app_version.clone()).filter(|v| !v.is_empty());
    let notch_version = data_version.or_else(|| env.installed_version.clone());
    let notch_outdated = match (&notch_version, &env.min_version) {
        (Some(v), Some(min)) => version_at_least(v, min) == Some(false),
        _ => false,
    };
    LinkStatus {
        connected: consent.is_some(),
        share_clipboard: consent.as_ref().is_some_and(|c| c.share.clipboard),
        connected_at: consent.as_ref().map(|c| c.connected_at.clone()),
        notch_installed: env.installed,
        last_update: data.map(|d| d.updated_at).filter(|s| !s.is_empty()),
        needs_newer_cognify: schema.is_some_and(|s| s > SUPPORTED_SCHEMA as u64),
        folder: dir.display().to_string(),
        link_available: env.min_version.is_some(),
        notch_version,
        min_notch_version: env.min_version.clone(),
        notch_outdated,
    }
}

pub fn notch_installed() -> bool {
    if cfg!(target_os = "macos") {
        Path::new("/Applications/Cognify Notch.app").exists()
            || std::env::var_os("HOME").is_some_and(|h| Path::new(&h).join("Applications/Cognify Notch.app").exists())
    } else if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").is_some_and(|d| Path::new(&d).join("CognifyNotch").exists())
    } else {
        false
    }
}

/// Versi aplikasi Cognify Notch yang terpasang di macOS, dibaca dari Info.plist-nya.
fn installed_notch_version() -> Option<String> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let mut candidates = vec![PathBuf::from("/Applications/Cognify Notch.app")];
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(Path::new(&home).join("Applications/Cognify Notch.app"));
    }
    candidates.into_iter().find(|p| p.exists()).and_then(|app| {
        let plist = app.join("Contents/Info"); // `defaults read` memakai jalur tanpa ".plist"
        let out = std::process::Command::new("/usr/bin/defaults")
            .args(["read", &plist.to_string_lossy(), "CFBundleShortVersionString"])
            .output()
            .ok()?;
        let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (out.status.success() && parse_version(&v).is_some()).then_some(v)
    })
}

fn current_env() -> NotchEnv {
    NotchEnv {
        installed: notch_installed(),
        installed_version: installed_notch_version(),
        min_version: min_notch_version().map(String::from),
    }
}

// ── Tauri ────────────────────────────────────────────────────────────────────

fn shared_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().data_dir().map_err(|e| format!("Folder data tidak ditemukan: {e}"))?.join(FOLDER))
}

#[tauri::command]
pub fn link_status(app: AppHandle) -> Result<LinkStatus, String> {
    Ok(status(&shared_dir(&app)?, &current_env()))
}

#[tauri::command]
pub fn link_connect(app: AppHandle, share_clipboard: Option<bool>) -> Result<LinkStatus, String> {
    let dir = shared_dir(&app)?;
    connect(&dir, share_clipboard.unwrap_or(false))?;
    Ok(status(&dir, &current_env()))
}

#[tauri::command]
pub fn link_set_share_clipboard(app: AppHandle, on: bool) -> Result<LinkStatus, String> {
    let dir = shared_dir(&app)?;
    set_share_clipboard(&dir, on)?;
    Ok(status(&dir, &current_env()))
}

#[tauri::command]
pub fn link_disconnect(app: AppHandle) -> Result<LinkStatus, String> {
    let dir = shared_dir(&app)?;
    disconnect(&dir)?;
    Ok(status(&dir, &current_env()))
}

#[tauri::command]
pub fn link_write_agenda(app: AppHandle, json: String) -> Result<(), String> {
    write_agenda(&shared_dir(&app)?, &json)
}

#[tauri::command]
pub fn link_data(app: AppHandle) -> Result<Option<NotchData>, String> {
    read_data(&shared_dir(&app)?)
}

fn mtime(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// Memberi tahu UI saat berkas persetujuan atau data berubah. Hanya dua panggilan `stat` per putaran.
pub fn start(app: AppHandle) {
    let Ok(dir) = shared_dir(&app) else { return };
    std::thread::spawn(move || {
        let mut last = (mtime(&dir.join(CONSENT)), mtime(&dir.join(DATA)));
        loop {
            let connected = dir.join(CONSENT).exists();
            std::thread::sleep(Duration::from_secs(if connected { 2 } else { 5 }));
            let now = (mtime(&dir.join(CONSENT)), mtime(&dir.join(DATA)));
            if now != last {
                last = now;
                let _ = app.emit(CHANGED_EVENT, ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = include_str!("../../tests/fixtures/notch-data.sample.json");

    fn env(installed: bool) -> NotchEnv {
        NotchEnv { installed, installed_version: None, min_version: Some("1.0.13".into()) }
    }

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("cognify-link-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn the_agenda_is_written_only_while_connected_and_removed_on_disconnect() {
        let d = temp();
        assert!(write_agenda(&d, "{}").is_err(), "tanpa persetujuan tidak ada yang ditulis");
        assert!(!d.join(AGENDA).exists());
        connect(&d, false).unwrap();
        write_agenda(&d, r#"{"schema":1,"events":[]}"#).unwrap();
        assert_eq!(fs::read_to_string(d.join(AGENDA)).unwrap(), r#"{"schema":1,"events":[]}"#);
        assert!(write_agenda(&d, "{rusak").is_err());
        assert!(write_agenda(&d, &format!("\"{}\"", "x".repeat(MAX_AGENDA_BYTES))).is_err());
        disconnect(&d).unwrap();
        assert!(!d.join(AGENDA).exists());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn nothing_is_connected_until_the_user_connects() {
        let d = temp();
        fs::write(d.join(DATA), SAMPLE).unwrap(); // berkas data ada, tapi tanpa persetujuan
        let s = status(&d, &env(true));
        assert!(!s.connected && s.last_update.is_none());
        assert_eq!(read_data(&d).unwrap(), None, "tanpa persetujuan data tidak dibaca");
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn connect_writes_consent_and_data_then_appears_and_disconnect_removes_both() {
        let d = temp();
        connect(&d, false).unwrap();
        assert!(read_consent(&d).unwrap().enabled);
        fs::write(d.join(DATA), SAMPLE).unwrap();
        let s = status(&d, &env(true));
        assert!(s.connected && s.notch_installed && !s.share_clipboard);
        assert_eq!(s.last_update.as_deref(), Some("2026-10-22T08:30:00.000Z"));
        assert!(!s.needs_newer_cognify);
        assert_eq!(read_data(&d).unwrap().unwrap().todos.len(), 2);

        disconnect(&d).unwrap();
        assert!(!d.join(CONSENT).exists() && !d.join(DATA).exists());
        assert!(!status(&d, &env(true)).connected);
        disconnect(&d).unwrap(); // dua kali tidak apa-apa
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn clipboard_is_withheld_unless_allowed_even_if_the_file_contains_it() {
        let d = temp();
        connect(&d, false).unwrap();
        fs::write(d.join(DATA), SAMPLE).unwrap();
        assert!(read_data(&d).unwrap().unwrap().clipboard.is_empty());
        set_share_clipboard(&d, true).unwrap();
        assert_eq!(read_data(&d).unwrap().unwrap().clipboard.len(), 1);
        assert!(status(&d, &env(true)).share_clipboard);
        set_share_clipboard(&d, false).unwrap();
        assert!(read_data(&d).unwrap().unwrap().clipboard.is_empty());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn changing_share_needs_a_connection_and_a_disabled_consent_counts_as_disconnected() {
        let d = temp();
        assert!(set_share_clipboard(&d, true).is_err());
        fs::write(d.join(CONSENT), r#"{"schema":1,"enabled":false}"#).unwrap();
        assert!(!status(&d, &env(false)).connected);
        fs::write(d.join(CONSENT), "rusak").unwrap();
        assert!(!status(&d, &env(false)).connected);
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn a_newer_format_is_flagged_and_a_broken_data_file_is_an_error_not_a_crash() {
        let d = temp();
        connect(&d, false).unwrap();
        fs::write(d.join(DATA), r#"{"schema":2,"updatedAt":"2027-01-01T00:00:00.000Z"}"#).unwrap();
        assert!(status(&d, &env(true)).needs_newer_cognify);
        fs::write(d.join(DATA), "{rusak").unwrap();
        assert!(read_data(&d).is_err());
        let s = status(&d, &env(true));
        assert!(s.connected && s.last_update.is_none());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn atomic_writes_leave_no_temp_file_and_unix_permissions_are_private() {
        let d = temp();
        let sub = d.join("Cognify Link");
        connect(&sub, true).unwrap();
        assert!(!sub.join("link.json.tmp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&sub).unwrap().permissions().mode() & 0o777, 0o700);
            assert_eq!(fs::metadata(sub.join(CONSENT)).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn versions_compare_numerically_not_as_text() {
        assert_eq!(version_at_least("1.0.13", "1.0.13"), Some(true));
        assert_eq!(version_at_least("1.0.9", "1.0.13"), Some(false), "9 lebih kecil dari 13");
        assert_eq!(version_at_least("1.1", "1.0.13"), Some(true));
        assert_eq!(version_at_least("2.0.0", "1.9.99"), Some(true));
        assert_eq!(version_at_least("1.0", "1.0.0"), Some(true));
        assert_eq!(version_at_least("v1.0.14", "1.0.13"), Some(true));
        assert_eq!(version_at_least("1.0.13-beta", "1.0.13"), None, "tidak dikenali, bukan ditebak");
        assert_eq!(version_at_least("", "1.0.13"), None);
    }

    #[test]
    fn an_old_installed_notch_is_flagged_and_a_new_one_or_unknown_is_not() {
        let d = temp();
        let with = |v: Option<&str>, min: Option<&str>| NotchEnv {
            installed: true,
            installed_version: v.map(String::from),
            min_version: min.map(String::from),
        };
        let old = status(&d, &with(Some("1.0.12"), Some("1.0.13")));
        assert!(old.notch_outdated && old.link_available);
        assert_eq!((old.notch_version.as_deref(), old.min_notch_version.as_deref()), (Some("1.0.12"), Some("1.0.13")));
        assert!(!status(&d, &with(Some("1.0.13"), Some("1.0.13"))).notch_outdated);
        assert!(!status(&d, &with(None, Some("1.0.13"))).notch_outdated, "versi tidak diketahui tidak dituduh usang");
        assert!(!status(&d, &with(Some("garbage"), Some("1.0.13"))).notch_outdated);
        let none = status(&d, &with(Some("1.0.0"), None));
        assert!(!none.link_available && !none.notch_outdated, "tanpa versi minimum: belum didukung, bukan usang");
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn the_version_inside_the_data_wins_over_the_installed_app() {
        let d = temp();
        connect(&d, false).unwrap();
        fs::write(d.join(DATA), r#"{"schema":1,"appVersion":"1.0.14","updatedAt":"2026-10-22T08:00:00.000Z"}"#).unwrap();
        let env = NotchEnv { installed: true, installed_version: Some("1.0.12".into()), min_version: Some("1.0.13".into()) };
        let s = status(&d, &env);
        assert_eq!(s.notch_version.as_deref(), Some("1.0.14"));
        assert!(!s.notch_outdated);
        let _ = fs::remove_dir_all(d);
    }
}
