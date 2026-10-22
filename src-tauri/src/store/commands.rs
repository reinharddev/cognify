//! Perintah Tauri untuk penyimpanan. Tipis: validasi dan logika ada di `pages` dan `settings`.

use serde::Serialize;
use tauri::State;

use super::calendar::{self, Event, EventInput, Source, SourceInput};
use super::proposals::{self, Proposal};
use super::pages::{self, NewPage, Page, PageNode, PageUpdate, SearchHit, TrashItem};
use super::{Error, Store, schema, settings};

type Res<T> = Result<T, Error>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    tag: String,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    count: i64,
}

#[tauri::command]
pub fn page_create(store: State<'_, Store>, new: NewPage) -> Res<Page> {
    store.with(|c| pages::create(c, new))
}

#[tauri::command]
pub fn page_get(store: State<'_, Store>, id: String) -> Res<Page> {
    store.with(|c| pages::get(c, &id))
}

#[tauri::command]
pub fn page_tree(store: State<'_, Store>) -> Res<Vec<PageNode>> {
    store.with(pages::tree)
}

#[tauri::command]
pub fn page_update(store: State<'_, Store>, id: String, update: PageUpdate) -> Res<Page> {
    store.with(|c| pages::update(c, &id, update))
}

#[tauri::command]
pub fn page_move(store: State<'_, Store>, id: String, parent_id: Option<String>, before_id: Option<String>) -> Res<()> {
    store.with(|c| pages::move_page(c, &id, parent_id.as_deref(), before_id.as_deref()))
}

#[tauri::command]
pub fn page_trash(store: State<'_, Store>, id: String) -> Res<Moved> {
    store.with(|c| pages::trash(c, &id)).map(|count| Moved { count })
}

#[tauri::command]
pub fn page_restore(store: State<'_, Store>, id: String) -> Res<Moved> {
    store.with(|c| pages::restore(c, &id)).map(|count| Moved { count })
}

#[tauri::command]
pub fn page_delete_forever(store: State<'_, Store>, id: String) -> Res<()> {
    store.with(|c| pages::delete_forever(c, &id))
}

/// Data sumber (CSL-JSON) dan penunjuk sorotan sebuah halaman, atau null bila belum ada.
#[tauri::command]
pub fn page_source_get(store: State<'_, Store>, id: String) -> Res<Option<serde_json::Value>> {
    store.with(|c| super::sources::get(c, &id))
}

#[tauri::command]
pub fn page_source_set(store: State<'_, Store>, id: String, source: serde_json::Value) -> Res<()> {
    store.with(|c| super::sources::replace_source(c, &id, &source))
}

#[tauri::command]
pub fn trash_list(store: State<'_, Store>) -> Res<Vec<TrashItem>> {
    store.with(pages::trash_list)
}

#[tauri::command]
pub fn trash_empty(store: State<'_, Store>) -> Res<Moved> {
    store.with(pages::empty_trash).map(|count| Moved { count })
}

#[tauri::command]
pub fn page_search(store: State<'_, Store>, query: String, limit: Option<usize>) -> Res<Vec<SearchHit>> {
    store.with(|c| pages::search(c, &query, limit.unwrap_or(20)))
}

#[tauri::command]
pub fn page_by_tag(store: State<'_, Store>, tag: String) -> Res<Vec<PageNode>> {
    store.with(|c| pages::by_tag(c, &tag))
}

#[tauri::command]
pub fn tag_list(store: State<'_, Store>) -> Res<Vec<TagCount>> {
    store.with(pages::tag_counts).map(|v| v.into_iter().map(|(tag, count)| TagCount { tag, count }).collect())
}

#[tauri::command]
pub fn setting_get(store: State<'_, Store>, key: String) -> Res<Option<String>> {
    store.with(|c| settings::get(c, &key))
}

#[tauri::command]
pub fn setting_set(store: State<'_, Store>, key: String, value: String) -> Res<()> {
    store.with(|c| settings::set(c, &key, &value))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInfo {
    status: serde_json::Value,
    base_url: Option<String>,
    token: String,
    schema_version: u32,
}

/// Kompatibel dengan `getBackendInfo()` lama di frontend: penyimpanan lokal selalu "siap" bila app
/// sudah berjalan (kegagalan membuka database menghentikan app sejak awal).
#[tauri::command]
pub fn backend_info(store: State<'_, Store>) -> Res<BackendInfo> {
    let schema_version = store.with(|c| schema::version(c))?;
    Ok(BackendInfo { status: serde_json::json!({"state": "ready", "port": 0}), base_url: None, token: String::new(), schema_version })
}

// ── kalender ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn event_list(store: State<'_, Store>) -> Res<Vec<Event>> {
    store.with(calendar::event_list)
}

#[tauri::command]
pub fn event_create(store: State<'_, Store>, input: EventInput) -> Res<Event> {
    store.with(|c| calendar::event_create(c, input))
}

#[tauri::command]
pub fn event_update(store: State<'_, Store>, id: String, input: EventInput) -> Res<Event> {
    store.with(|c| calendar::event_update(c, &id, input))
}

#[tauri::command]
pub fn event_delete(store: State<'_, Store>, id: String) -> Res<()> {
    store.with(|c| calendar::event_delete(c, &id))
}

#[tauri::command]
pub fn calendar_source_list(store: State<'_, Store>) -> Res<Vec<Source>> {
    store.with(calendar::source_list)
}

/// Berkas .ics: teksnya dikirim klien. Tautan: dibuat lalu langsung diambil.
#[tauri::command]
pub async fn calendar_source_add(store: State<'_, Store>, input: SourceInput) -> Res<Source> {
    let source = store.with(|c| calendar::source_create(c, input))?;
    if source.kind == "url" {
        return refresh(&store, &source).await;
    }
    Ok(source)
}

async fn refresh(store: &Store, source: &Source) -> Res<Source> {
    let url = source.url.clone().ok_or_else(|| Error::Invalid("Kalender ini bukan langganan tautan.".into()))?;
    let result = crate::ics_fetch::fetch(&url).await;
    // Teks yang bukan kalender dicatat sebagai galat, bukan membuat perintah gagal.
    store.with(|c| match calendar::source_store_fetch(c, &source.id, result.clone()) {
        Err(Error::Invalid(m)) => calendar::source_store_fetch(c, &source.id, Err(m)),
        other => other,
    })
}

#[tauri::command]
pub async fn calendar_source_refresh(store: State<'_, Store>, id: String) -> Res<Source> {
    let source = store.with(|c| calendar::source_get(c, &id))?;
    refresh(&store, &source).await
}

#[tauri::command]
pub fn calendar_source_enable(store: State<'_, Store>, id: String, enabled: bool) -> Res<Source> {
    store.with(|c| calendar::source_set_enabled(c, &id, enabled))
}

#[tauri::command]
pub fn calendar_source_delete(store: State<'_, Store>, id: String) -> Res<()> {
    store.with(|c| calendar::source_delete(c, &id))
}

#[tauri::command]
pub fn proposal_list(store: State<'_, Store>) -> Res<Vec<Proposal>> {
    store.with(|c| proposals::list_pending(c))
}

/// Setujui usulan dari AI: membuat halamannya dan mengembalikan halaman itu.
#[tauri::command]
pub fn proposal_approve(store: State<'_, Store>, id: String) -> Res<Page> {
    store.with(|c| proposals::approve(c, &id))
}

#[tauri::command]
pub fn proposal_reject(store: State<'_, Store>, id: String) -> Res<()> {
    store.with(|c| proposals::reject(c, &id))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInfo {
    /// Jalur program yang dijalankan klien MCP dengan argumen `--mcp`.
    command: String,
    /// True pada build pengembangan: datanya terpisah dari app terpasang.
    dev: bool,
}

#[tauri::command]
pub fn mcp_info() -> Res<McpInfo> {
    let exe = std::env::current_exe().map_err(|e| Error::Invalid(format!("Lokasi app tidak diketahui: {e}")))?;
    Ok(McpInfo { command: exe.to_string_lossy().into_owned(), dev: cfg!(debug_assertions) })
}
