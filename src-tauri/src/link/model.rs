//! Bentuk data `notch-data.json` (lihat docs/NOTCH_LINK.md). Pembacaan sengaja longgar: semua bagian
//! opsional, bidang tak dikenal diabaikan, dan satu elemen rusak dilewati tanpa membuang yang lain.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};

/// Versi format yang dipahami Cognify ini.
pub const SUPPORTED_SCHEMA: u32 = 1;
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

fn lenient<'de, D, T>(d: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    let raw = Vec::<serde_json::Value>::deserialize(d).unwrap_or_default();
    Ok(raw.into_iter().filter_map(|v| serde_json::from_value(v).ok()).collect())
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Todo {
    pub id: String,
    pub title: String,
    pub done: bool,
    pub due_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Note {
    pub id: String,
    pub text: String,
    pub created_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipItem {
    pub id: String,
    /// `text` atau `link`.
    pub kind: String,
    pub text: String,
    pub at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TrayItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub added_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Timer {
    pub id: String,
    pub title: String,
    pub duration_sec: u64,
    pub ends_at: Option<String>,
    pub running: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Sip {
    pub at: String,
    pub ml: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WaterDay {
    pub date: String,
    pub ml: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Water {
    pub goal_ml: Option<u32>,
    #[serde(deserialize_with = "lenient")]
    pub today: Vec<Sip>,
    #[serde(deserialize_with = "lenient")]
    pub history: Vec<WaterDay>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgendaItem {
    pub id: String,
    pub title: String,
    pub start: String,
    pub end: Option<String>,
    pub all_day: bool,
    pub calendar: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Weather {
    pub temp_c: Option<f64>,
    pub summary: String,
    pub place: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Playing {
    pub title: String,
    pub artist: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Battery {
    pub percent: u8,
    pub charging: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NowInfo {
    pub weather: Option<Weather>,
    pub playing: Option<Playing>,
    pub battery: Option<Battery>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NotchData {
    pub schema: u32,
    pub platform: String,
    pub app_version: String,
    pub updated_at: String,
    #[serde(deserialize_with = "lenient")]
    pub todos: Vec<Todo>,
    #[serde(deserialize_with = "lenient")]
    pub notes: Vec<Note>,
    #[serde(deserialize_with = "lenient")]
    pub clipboard: Vec<ClipItem>,
    #[serde(deserialize_with = "lenient")]
    pub tray: Vec<TrayItem>,
    #[serde(deserialize_with = "lenient")]
    pub timers: Vec<Timer>,
    pub water: Option<Water>,
    #[serde(deserialize_with = "lenient")]
    pub agenda: Vec<AgendaItem>,
    pub now: Option<NowInfo>,
}

impl NotchData {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err("Berkas data Notch terlalu besar.".into());
        }
        serde_json::from_slice(bytes).map_err(|e| format!("Berkas data Notch tidak bisa dibaca: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = include_str!("../../tests/fixtures/notch-data.sample.json");

    #[test]
    fn the_sample_file_parses_completely() {
        let d = NotchData::parse(SAMPLE.as_bytes()).unwrap();
        assert_eq!((d.schema, d.platform.as_str(), d.app_version.as_str()), (1, "mac", "1.0.12"));
        assert_eq!(d.todos.len(), 2);
        assert!(!d.todos[0].done && d.todos[1].done && d.todos[1].due_at.is_none());
        assert_eq!(d.notes[0].text, "Ide judul skripsi: pengaruh LMS terhadap motivasi");
        assert_eq!(d.clipboard[0].kind, "link");
        assert_eq!(d.tray[0].name, "laporan.pdf");
        assert_eq!((d.timers[0].duration_sec, d.timers[0].running), (600, true));
        let w = d.water.unwrap();
        assert_eq!((w.goal_ml, w.today[0].ml, w.history[0].date.as_str()), (Some(2000), 250, "2026-10-21"));
        assert_eq!(d.agenda[0].calendar.as_deref(), Some("Sekolah"));
        let now = d.now.unwrap();
        assert_eq!(now.weather.unwrap().temp_c, Some(29.0));
        assert_eq!(now.playing.unwrap().title, "Ada Selamanya");
        assert_eq!(now.battery.unwrap().percent, 80);
    }

    #[test]
    fn an_empty_object_is_valid_and_empty() {
        let d = NotchData::parse(b"{}").unwrap();
        assert_eq!(d, NotchData::default());
    }

    #[test]
    fn a_broken_element_is_skipped_without_losing_the_rest() {
        let json = br#"{"schema":1,"todos":[{"id":"a","title":"ok"},{"id":5,"title":[]},"bukan objek",{"id":"b","title":"juga ok"}],
                        "notes":"bukan daftar","agenda":[{"id":"e","title":"x","start":"2026-10-22T09:00:00Z"}]}"#;
        let d = NotchData::parse(json).unwrap();
        assert_eq!(d.todos.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert!(d.notes.is_empty());
        assert_eq!(d.agenda.len(), 1);
    }

    #[test]
    fn garbage_and_oversized_input_are_rejected_with_a_message() {
        assert!(NotchData::parse(b"bukan json").unwrap_err().contains("tidak bisa dibaca"));
        let big = vec![b' '; MAX_FILE_BYTES as usize + 1];
        assert!(NotchData::parse(&big).unwrap_err().contains("terlalu besar"));
    }

    /// Uji lintas-bahasa: baca berkas yang ditulis Notch Mac (`cognify-notch --link-dump <berkas>`).
    ///   NOTCH_DUMP_FILE=/path/dump.json cargo test --lib reads_a_real_dump -- --ignored
    #[test]
    #[ignore]
    fn reads_a_real_dump() {
        let path = std::env::var("NOTCH_DUMP_FILE").expect("NOTCH_DUMP_FILE");
        let d = NotchData::parse(&std::fs::read(path).unwrap()).unwrap();
        println!("{d:#?}");
        assert_eq!(d.schema, 1);
        assert_eq!(d.platform, "mac");
        assert!(!d.updated_at.is_empty());
    }
}
