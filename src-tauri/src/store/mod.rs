//! Penyimpanan lokal Cognify: satu berkas SQLite berisi pohon halaman, tag, pencarian, dan
//! pengaturan. Semua operasi ada di `pages` dan `settings` (murni, mudah diuji dengan database di
//! memori); `commands` hanya membungkusnya menjadi perintah Tauri.

pub mod calendar;
pub mod commands;
pub mod markdown;
pub mod pages;
pub mod proposals;
pub mod schema;
pub mod settings;
pub mod sources;
mod time;

/// Waktu sekarang (UTC, ISO-8601) untuk modul lain.
pub fn now_iso() -> String {
    time::utc_now()
}

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Serialize, Serializer};
use tauri::{AppHandle, Manager};

#[derive(Debug)]
pub enum Error {
    Db(rusqlite::Error),
    NotFound(String),
    Invalid(String),
}

impl Error {
    fn code(&self) -> &'static str {
        match self {
            Error::Db(_) => "db_error",
            Error::NotFound(_) => "not_found",
            Error::Invalid(_) => "invalid",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Db(e) => write!(f, "Penyimpanan bermasalah: {e}"),
            Error::NotFound(m) | Error::Invalid(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Db(e)
    }
}

/// Bentuk galat ke UI: `{ code, message }`, sama dengan `ApiError` di frontend.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, Error> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, Error> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self, Error> {
        // WAL: pembacaan tidak menunggu penulisan, dan kehilangan daya tidak merusak berkas.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        schema::migrate(&conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> Result<T, Error>) -> Result<T, Error> {
        // Kunci yang tercemar (panik di perintah lain) tetap aman dipakai: SQLite menjaga konsistensinya.
        let guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        f(&guard)
    }
}

/// Folder data app. Build dev memakai subfolder `dev/` agar tidak mencampur data rilis.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| format!("Folder data app tidak ditemukan: {e}"))?;
    Ok(if cfg!(debug_assertions) { base.join("dev") } else { base })
}

/// Folder data tanpa Tauri, untuk mode `--mcp` (proses tanpa jendela). Harus sama dengan `data_dir`:
/// Tauri memakai folder data pengguna di bawah pengenal app.
pub fn headless_data_dir() -> Result<PathBuf, String> {
    const IDENTIFIER: &str = "com.reinhard.cognify";
    // Untuk uji dan pemakaian khusus: folder data ditentukan langsung.
    if let Some(dir) = std::env::var_os("COGNIFY_DATA_DIR").filter(|d| !d.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    let home = || std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| "HOME tidak diatur".to_string());
    let base = if cfg!(target_os = "macos") {
        home()?.join("Library/Application Support").join(IDENTIFIER)
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from).ok_or("APPDATA tidak diatur")?.join(IDENTIFIER)
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).map_or_else(|| home().map(|h| h.join(".local/share")), Ok)?.join(IDENTIFIER)
    };
    Ok(if cfg!(debug_assertions) { base.join("dev") } else { base })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrating_twice_is_a_no_op_and_a_newer_database_is_refused() {
        let store = Store::open_in_memory().unwrap();
        store
            .with(|c| {
                assert_eq!(schema::version(c)?, schema::LATEST);
                schema::migrate(c)?;
                c.execute_batch("PRAGMA user_version = 99")?;
                let err = schema::migrate(c).unwrap_err();
                assert!(err.to_string().contains("lebih baru"), "{err}");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn a_database_file_survives_reopening_with_its_data() {
        let dir = std::env::temp_dir().join(format!("cognify-store-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("workspace.db");
        let id = {
            let s = Store::open(&path).unwrap();
            s.with(|c| {
                let p = pages::create(c, pages::NewPage { kind: "doc".into(), title: Some("Tahan restart".into()), ..Default::default() })?;
                settings::set(c, "level", "smp")?;
                Ok(p.node.id)
            })
            .unwrap()
        };
        let s = Store::open(&path).unwrap();
        s.with(|c| {
            assert_eq!(pages::get(c, &id)?.node.title, "Tahan restart");
            assert_eq!(settings::get(c, "level")?.as_deref(), Some("smp"));
            Ok(())
        })
        .unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn errors_serialize_as_code_and_message() {
        let v = serde_json::to_value(Error::NotFound("x".into())).unwrap();
        assert_eq!(v, serde_json::json!({"code": "not_found", "message": "x"}));
    }
}
