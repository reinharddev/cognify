//! Pengaturan sederhana: pasangan kunci dan nilai teks (nilai boleh berupa JSON).

use rusqlite::{Connection, OptionalExtension, params};

use super::Error;

const MAX_KEY: usize = 64;
const MAX_VALUE: usize = 64 * 1024;

fn check_key(key: &str) -> Result<(), Error> {
    if key.is_empty() || key.len() > MAX_KEY || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.') {
        return Err(Error::Invalid("Nama pengaturan tidak sah.".into()));
    }
    Ok(())
}

pub fn get(conn: &Connection, key: &str) -> Result<Option<String>, Error> {
    check_key(key)?;
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), Error> {
    check_key(key)?;
    if value.len() > MAX_VALUE {
        return Err(Error::Invalid("Nilai pengaturan terlalu besar.".into()));
    }
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
pub fn all(conn: &Connection) -> Result<Vec<(String, String)>, Error> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    Ok(stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn values_roundtrip_overwrite_and_validate_keys() {
        Store::open_in_memory()
            .unwrap()
            .with(|c| {
                assert_eq!(get(c, "level")?, None);
                set(c, "level", "sma")?;
                set(c, "level", "kuliah")?;
                set(c, "ui.scale", r#"{"a":1}"#)?;
                assert_eq!(get(c, "level")?.as_deref(), Some("kuliah"));
                assert_eq!(all(c)?.len(), 2);
                for bad in ["", "a b", "x'; DROP TABLE settings;--", &"k".repeat(65)] {
                    assert!(set(c, bad, "v").is_err(), "{bad:?}");
                }
                assert!(set(c, "besar", &"x".repeat(64 * 1024 + 1)).is_err());
                Ok(())
            })
            .unwrap();
    }
}
