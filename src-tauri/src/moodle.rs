//! Integrasi Moodle (opsional, dinyalakan pengguna di Pengaturan). Hanya berbicara dengan alamat Moodle yang
//! diketik pengguna sendiri. Kata sandi dipakai sekali untuk meminta token lalu dibuang; token disimpan di keychain
//! sistem (bukan di database, bukan di log). Tugas dan tenggat disalin ke tabel `moodle_items`.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::{future::join_all, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;

use crate::store::{data_dir, moodle as db, settings, Error, Store};

type Res<T> = Result<T, Error>;

const KEY_ENABLED: &str = "moodle.enabled";
const KEY_CONFIG: &str = "moodle.config";
const SERVICE: &str = if cfg!(debug_assertions) { "com.reinhard.cognify.moodle.dev" } else { "com.reinhard.cognify.moodle" };
/// Tenggat kuis dan modul lain yang masih dilihat ke belakang.
const KEEP_PAST_SECS: i64 = 30 * 86_400;
/// Tugas dilihat sampai satu semester ke belakang supaya yang sudah selesai ikut tampil (Tabel PR).
const KEEP_TASKS_SECS: i64 = 180 * 86_400;

/// Bagian yang tidak rahasia. Token tidak pernah masuk ke sini.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
struct Config {
    base_url: String,
    user_id: i64,
    user_name: String,
    full_name: String,
    site_name: String,
    /// Alamat situs menurut Moodle sendiri (bisa berbeda dari yang diketik, mis. dengan www).
    #[serde(default)]
    site_url: String,
    last_sync: Option<String>,
    error: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    connected: bool,
    base_url: String,
    user_name: String,
    full_name: String,
    site_name: String,
    last_sync: Option<String>,
    error: Option<String>,
    count: i64,
}

fn invalid(m: &str) -> Error {
    Error::Invalid(m.to_string())
}

fn entry() -> Result<keyring::Entry, Error> {
    keyring::Entry::new(SERVICE, "token").map_err(|_| invalid("Keychain tidak bisa dibuka."))
}

fn token() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|t| !t.is_empty())
}

fn load_config(store: &Store) -> Res<Config> {
    Ok(store.with(|c| settings::get(c, KEY_CONFIG))?.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default())
}

fn save_config(store: &Store, cfg: &Config) -> Res<()> {
    let text = serde_json::to_string(cfg).map_err(|_| invalid("Pengaturan Moodle tidak bisa disimpan."))?;
    store.with(|c| settings::set(c, KEY_CONFIG, &text))
}

fn enabled(store: &Store) -> Res<bool> {
    Ok(store.with(|c| settings::get(c, KEY_ENABLED))?.as_deref() == Some("1"))
}

fn status(store: &Store) -> Res<Status> {
    let cfg = load_config(store)?;
    Ok(Status {
        enabled: enabled(store)?,
        connected: token().is_some() && !cfg.base_url.is_empty(),
        base_url: cfg.base_url,
        user_name: cfg.user_name,
        full_name: cfg.full_name,
        site_name: cfg.site_name,
        last_sync: cfg.last_sync,
        error: cfg.error,
        count: store.with(db::count)?,
    })
}

/// Alamat Moodle yang rapi: https (http hanya untuk komputer ini), tanpa jalur login, tanpa akhiran garis miring.
pub fn normalize_base(input: &str) -> Result<String, Error> {
    let t = input.trim();
    if t.is_empty() || t.len() > 200 || t.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(invalid("Alamat Moodle tidak sah."));
    }
    let with_scheme = if t.contains("://") { t.to_string() } else { format!("https://{t}") };
    let (scheme, rest) = with_scheme.split_once("://").ok_or_else(|| invalid("Alamat Moodle tidak sah."))?;
    let scheme = scheme.to_ascii_lowercase();
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = rest[..host_end].to_ascii_lowercase();
    if host.is_empty() || host.contains('@') {
        return Err(invalid("Alamat Moodle tidak sah."));
    }
    let local = host == "localhost" || host.starts_with("localhost:") || host.starts_with("127.0.0.1");
    if scheme != "https" && !(scheme == "http" && local) {
        return Err(invalid("Alamat Moodle harus diawali https://."));
    }
    // Buang jalur halaman Moodle ("/login/index.php", "/my/"); subfolder instalasi tetap dipertahankan.
    let mut path = rest[host_end..].split(['?', '#']).next().unwrap_or("").to_string();
    for marker in ["/login", "/my", "/course", "/mod", "/webservice", "/calendar", "/user"] {
        if let Some(i) = path.find(marker) {
            path.truncate(i);
        }
    }
    Ok(format!("{scheme}://{host}{}", path.trim_end_matches('/')))
}

fn client() -> Result<reqwest::Client, Error> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Cognify (Moodle)")
        .redirect(reqwest::redirect::Policy::custom(|a| {
            let ok = a.url().scheme() == "https" || matches!(a.url().host_str(), Some("localhost" | "127.0.0.1"));
            if ok && a.previous().len() < 5 { a.follow() } else { a.stop() }
        }))
        .build()
        .map_err(|_| invalid("Koneksi ke Moodle tidak bisa dimulai."))
}

/// Pesan ramah tanpa alamat atau data lain (alamat bisa memuat rahasia).
fn net_error(e: &reqwest::Error) -> Error {
    invalid(if e.is_timeout() {
        "Moodle terlalu lama menjawab."
    } else if e.is_connect() {
        "Tidak bisa terhubung ke Moodle. Periksa alamat dan koneksi internetmu."
    } else {
        "Moodle tidak bisa dihubungi."
    })
}

#[derive(Debug)]
enum CallError {
    /// Token ditolak Moodle: harus masuk lagi.
    Auth,
    Other(Error),
}

impl From<Error> for CallError {
    fn from(e: Error) -> Self {
        CallError::Other(e)
    }
}

async fn call(http: &reqwest::Client, base: &str, token: &str, function: &str, params: &[(String, String)]) -> Result<Value, CallError> {
    let mut form: Vec<(String, String)> = vec![
        ("wstoken".into(), token.to_string()),
        ("wsfunction".into(), function.to_string()),
        ("moodlewsrestformat".into(), "json".into()),
    ];
    form.extend(params.iter().cloned());
    let resp = http.post(format!("{base}/webservice/rest/server.php")).form(&form).send().await.map_err(|e| CallError::Other(net_error(&e)))?;
    if !resp.status().is_success() {
        return Err(CallError::Other(invalid("Moodle menolak permintaan.")));
    }
    let v: Value = resp.json().await.map_err(|_| CallError::Other(invalid("Jawaban Moodle tidak bisa dibaca.")))?;
    if let Some(code) = v.get("errorcode").and_then(Value::as_str) {
        return Err(match code {
            "invalidtoken" | "accessexception" | "requireloginerror" => CallError::Auth,
            _ => CallError::Other(invalid("Moodle ini tidak mengizinkan data tersebut diambil.")),
        });
    }
    Ok(v)
}

/// Alamat situs dari `core_webservice_get_site_info`, hanya bila https (atau komputer ini).
fn site_url_of(info: &Value) -> String {
    let u = info.get("siteurl").and_then(Value::as_str).unwrap_or("").trim().trim_end_matches('/').to_string();
    if u.starts_with("https://") || u.starts_with("http://localhost") || u.starts_with("http://127.0.0.1") { u } else { String::new() }
}

/// Alamat yang boleh dipakai untuk mengunduh berkas: yang diketik pengguna dan alamat situs dari Moodle.
fn allowed_prefixes(cfg: &Config) -> Vec<String> {
    let mut v = vec![cfg.base_url.clone()];
    if !cfg.site_url.is_empty() && cfg.site_url != cfg.base_url {
        v.push(cfg.site_url.clone());
    }
    v.retain(|s| !s.is_empty());
    v
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn param(k: &str, v: impl ToString) -> (String, String) {
    (k.to_string(), v.to_string())
}

/// Ambil semua tugas dan tenggat. Status pengumpulan yang gagal dibaca dianggap belum dikumpulkan.
async fn fetch_items(base: &str, token: &str, user_id: i64) -> Result<(Vec<db::Item>, Vec<(i64, String)>), CallError> {
    let http = client()?;
    let courses = call(&http, base, token, "core_enrol_get_users_courses", &[param("userid", user_id)]).await?;
    let ids = db::parse_course_ids(&courses);
    let course_list = db::parse_courses(&courses);
    let mut items = Vec::new();
    if !ids.is_empty() {
        let since = now_secs() - KEEP_TASKS_SECS;
        let params: Vec<_> = ids.iter().enumerate().map(|(i, id)| param(&format!("courseids[{i}]"), id)).collect();
        let assigns = db::parse_assignments(&call(&http, base, token, "mod_assign_get_assignments", &params).await?, since);
        for chunk in assigns.chunks(6) {
            let statuses = join_all(chunk.iter().map(|a| {
                let http = &http;
                async move { call(http, base, token, "mod_assign_get_submission_status", &[param("assignid", a.id)]).await }
            }))
            .await;
            for (a, st) in chunk.iter().zip(statuses) {
                if matches!(st, Err(CallError::Auth)) {
                    return Err(CallError::Auth);
                }
                items.push(db::assign_item(a, st.map(|v| db::parse_state(&v)).unwrap_or("todo"), base));
            }
        }
    }
    // Kuis dan tenggat modul lain; kegagalan di sini tidak membatalkan tugas yang sudah didapat.
    let events = call(
        &http,
        base,
        token,
        "core_calendar_get_action_events_by_timesort",
        &[param("timesortfrom", now_secs() - KEEP_PAST_SECS), param("limitnum", 100), param("limittononsuspendedevents", 1)],
    )
    .await;
    match events {
        Err(CallError::Auth) => return Err(CallError::Auth),
        Ok(v) => items.extend(db::parse_action_events(&v, base)),
        Err(_) => {}
    }
    items.sort_by(|a, b| a.due.cmp(&b.due).then_with(|| a.title.cmp(&b.title)));
    Ok((items, course_list))
}

async fn sync_inner(store: &Store) -> Res<()> {
    let mut cfg = load_config(store)?;
    let Some(tok) = token() else { return Err(invalid("Belum masuk ke Moodle.")) };
    if cfg.base_url.is_empty() {
        return Err(invalid("Belum masuk ke Moodle."));
    }
    match fetch_items(&cfg.base_url, &tok, cfg.user_id).await {
        Ok((items, courses)) => {
            store.with(|c| {
                db::replace_all(c, &items)?;
                db::courses_replace(c, &courses)
            })?;
            cfg.last_sync = Some(db::now());
            cfg.error = None;
            save_config(store, &cfg)
        }
        Err(e) => {
            let msg = match e {
                CallError::Auth => "Sesi Moodle berakhir. Masuk lagi dengan username dan password.".to_string(),
                CallError::Other(Error::Invalid(m)) => m,
                CallError::Other(_) => "Sinkron Moodle gagal.".to_string(),
            };
            cfg.error = Some(msg.clone());
            save_config(store, &cfg)?;
            Err(Error::Invalid(msg))
        }
    }
}

#[tauri::command]
pub fn moodle_status(store: State<'_, Store>) -> Res<Status> {
    status(&store)
}

/// Nyalakan atau matikan. Mati: tugas disembunyikan dan tidak ada sinkron; token tetap tersimpan sampai diputuskan.
#[tauri::command]
pub fn moodle_set_enabled(store: State<'_, Store>, enabled: bool) -> Res<Status> {
    store.with(|c| settings::set(c, KEY_ENABLED, if enabled { "1" } else { "0" }))?;
    status(&store)
}

#[tauri::command]
pub async fn moodle_connect(store: State<'_, Store>, base_url: String, username: String, password: String) -> Res<Status> {
    let base = normalize_base(&base_url)?;
    let username = username.trim().to_string();
    if username.is_empty() || password.is_empty() {
        return Err(invalid("Isi username dan password Moodle."));
    }
    let http = client()?;
    let resp = http
        .post(format!("{base}/login/token.php"))
        .form(&[("username", username.as_str()), ("password", password.as_str()), ("service", "moodle_mobile_app")])
        .send()
        .await
        .map_err(|e| net_error(&e))?;
    drop(password);
    let v: Value = resp.json().await.map_err(|_| invalid("Alamat ini tampaknya bukan Moodle, atau akses aplikasi mobile dimatikan."))?;
    let Some(tok) = v.get("token").and_then(Value::as_str).filter(|t| !t.is_empty()).map(str::to_string) else {
        return Err(invalid(match v.get("errorcode").and_then(Value::as_str) {
            Some("invalidlogin") => "Username atau password salah.",
            Some("enablewsdisabled") => "Moodle ini belum mengaktifkan akses aplikasi mobile.",
            _ => "Tidak bisa masuk ke Moodle. Periksa alamat, username, dan password.",
        }));
    };
    let info = match call(&http, &base, &tok, "core_webservice_get_site_info", &[]).await {
        Ok(v) => v,
        Err(CallError::Auth) => return Err(invalid("Moodle menolak token yang baru dibuat.")),
        Err(CallError::Other(e)) => return Err(e),
    };
    entry()?.set_password(&tok).map_err(|_| invalid("Token tidak bisa disimpan di keychain."))?;
    let cfg = Config {
        base_url: base,
        user_id: info.get("userid").and_then(Value::as_i64).unwrap_or(0),
        user_name: info.get("username").and_then(Value::as_str).unwrap_or(&username).to_string(),
        full_name: info.get("fullname").and_then(Value::as_str).unwrap_or("").to_string(),
        site_name: info.get("sitename").and_then(Value::as_str).unwrap_or("").to_string(),
        site_url: site_url_of(&info),
        last_sync: None,
        error: None,
    };
    save_config(&store, &cfg)?;
    store.with(|c| settings::set(c, KEY_ENABLED, "1"))?;
    // Gagal sinkron pertama tidak membatalkan masuk; pesannya tampil di status.
    let _ = sync_inner(&store).await;
    status(&store)
}

#[tauri::command]
pub async fn moodle_sync(store: State<'_, Store>) -> Res<Status> {
    if !enabled(&store)? {
        return status(&store);
    }
    let _ = sync_inner(&store).await;
    status(&store)
}

/// Hapus token dari keychain, pengaturan, semua tugas, dan materi yang tersimpan di komputer ini.
#[tauri::command]
pub fn moodle_disconnect(app: AppHandle, store: State<'_, Store>) -> Res<Status> {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
    if let Some(root) = materials_root(&app) {
        let _ = std::fs::remove_dir_all(root);
    }
    store.with(|c| {
        db::clear(c)?;
        db::clear_materials(c)?;
        settings::set(c, KEY_CONFIG, "{}")?;
        settings::set(c, KEY_ENABLED, "0")
    })?;
    status(&store)
}

/// Tugas dan tenggat; kosong bila fitur mati.
#[tauri::command]
pub fn moodle_items(store: State<'_, Store>) -> Res<Vec<db::Item>> {
    if !enabled(&store)? {
        return Ok(Vec::new());
    }
    store.with(db::list)
}

// ── Materi (berkas) dan unduhan latar ────────────────────────────────────────────

const MAX_WORKERS: usize = 2;
const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
static WORKERS: AtomicUsize = AtomicUsize::new(0);

fn materials_root(app: &AppHandle) -> Option<std::path::PathBuf> {
    data_dir(app).ok().map(|d| d.join("moodle"))
}

/// Hapus salinan lokal; hanya yang ada di dalam folder materi yang disentuh.
fn remove_local(app: &AppHandle, paths: &[String]) {
    let Some(root) = materials_root(app) else { return };
    for p in paths {
        let path = std::path::Path::new(p);
        if path.starts_with(&root) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .user_agent("Cognify (Moodle)")
        // Token ada di alamat unduhan, jadi hanya ikuti pengalihan di server yang sama.
        .redirect(reqwest::redirect::Policy::custom(|a| {
            let same = a.previous().first().and_then(|u| u.host_str()) == a.url().host_str();
            let secure = a.url().scheme() == "https" || matches!(a.url().host_str(), Some("localhost" | "127.0.0.1"));
            if same && secure && a.previous().len() < 5 { a.follow() } else { a.stop() }
        }))
        .build()
        .map_err(|_| "Unduhan tidak bisa dimulai.".to_string())
}

/// Nyalakan sampai MAX_WORKERS pekerja latar; masing-masing berhenti sendiri saat antrean kosong.
fn ensure_workers(app: &AppHandle) {
    loop {
        let cur = WORKERS.load(Ordering::SeqCst);
        if cur >= MAX_WORKERS {
            return;
        }
        if WORKERS.compare_exchange(cur, cur + 1, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { worker(app).await });
        }
    }
}

async fn worker(app: AppHandle) {
    loop {
        let store = app.state::<Store>();
        if !enabled(&store).unwrap_or(false) {
            break;
        }
        let Ok(Some((id, course_id, url))) = store.with(db::claim_next) else { break };
        if let Err(msg) = download_one(&app, &store, &id, course_id, &url).await {
            let _ = store.with(|c| db::fail(c, &id, &msg));
        }
    }
    WORKERS.fetch_sub(1, Ordering::SeqCst);
    // Berkas yang diantre tepat saat pekerja berhenti tidak boleh tertinggal.
    let store = app.state::<Store>();
    if enabled(&store).unwrap_or(false) && store.with(db::has_queued).unwrap_or(false) {
        ensure_workers(&app);
    }
}

async fn download_one(app: &AppHandle, store: &Store, id: &str, course_id: i64, url: &str) -> Result<(), String> {
    let cfg = load_config(store).map_err(|_| "Pengaturan Moodle tidak terbaca.".to_string())?;
    if !allowed_prefixes(&cfg).iter().any(|b| url.starts_with(&format!("{b}/"))) {
        return Err("Alamat berkas bukan dari server Moodle-mu.".into());
    }
    let tok = token().ok_or_else(|| "Belum masuk ke Moodle.".to_string())?;
    let mut target = reqwest::Url::parse(url).map_err(|_| "Alamat berkas tidak sah.".to_string())?;
    target.query_pairs_mut().append_pair("token", &tok);
    drop(tok);

    let file = store.with(|c| db::file_get(c, id)).ok().flatten().ok_or_else(|| "Berkas tidak ditemukan.".to_string())?;
    let dir = materials_root(app).ok_or_else(|| "Folder data tidak ditemukan.".to_string())?.join(course_id.to_string());
    std::fs::create_dir_all(&dir).map_err(|_| "Folder materi tidak bisa dibuat.".to_string())?;
    let name = format!("{}_{}", db::short_hash(id), db::safe_name(&file.filename));
    let final_path = dir.join(&name);
    let part = dir.join(format!("{name}.part"));

    let resp = download_client()?.get(target).send().await.map_err(|e| match net_error(&e) {
        Error::Invalid(m) => m,
        _ => "Unduhan gagal.".to_string(),
    })?;
    let status = resp.status();
    if status.is_redirection() {
        return Err("Moodle mengalihkan unduhan ke server lain, jadi dibatalkan.".into());
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("Moodle menolak unduhan ini. Coba masuk lagi di Pengaturan.".into());
    }
    if !status.is_success() {
        return Err(format!("Moodle menjawab dengan kode {}.", status.as_u16()));
    }
    // Moodle menjawab 200 dengan JSON bila token tidak berlaku.
    let is_json = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|t| t.starts_with("application/json"));
    if is_json && !file.mime.contains("json") {
        return Err("Sesi Moodle berakhir. Masuk lagi di Pengaturan.".into());
    }
    if resp.content_length().is_some_and(|n| n > MAX_FILE_BYTES) {
        return Err("Berkas terlalu besar (maksimal 1 GB).".into());
    }

    let mut out = tokio::fs::File::create(&part).await.map_err(|_| "Berkas tidak bisa ditulis ke disk.".to_string())?;
    let mut stream = resp.bytes_stream();
    let mut total: u64 = 0;
    let mut last = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Unduhan terputus.".to_string());
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(e);
            }
        };
        total += chunk.len() as u64;
        if total > MAX_FILE_BYTES {
            let _ = tokio::fs::remove_file(&part).await;
            return Err("Berkas terlalu besar (maksimal 1 GB).".into());
        }
        if out.write_all(&chunk).await.is_err() {
            let _ = tokio::fs::remove_file(&part).await;
            return Err("Disk penuh atau berkas tidak bisa ditulis.".into());
        }
        if last.elapsed() >= Duration::from_millis(300) {
            last = Instant::now();
            // Dibatalkan pengguna: status berubah, berhenti dan buang sisa unduhan.
            if !store.with(|c| db::is_downloading(c, id)).unwrap_or(false) {
                drop(out);
                let _ = tokio::fs::remove_file(&part).await;
                return Ok(());
            }
            let _ = store.with(|c| db::set_progress(c, id, total as i64));
        }
    }
    out.flush().await.map_err(|_| "Berkas tidak bisa ditulis ke disk.".to_string())?;
    drop(out);
    // Dibatalkan tepat sebelum selesai: jangan timpa status "remote".
    if !store.with(|c| db::is_downloading(c, id)).unwrap_or(false) {
        let _ = tokio::fs::remove_file(&part).await;
        return Ok(());
    }
    tokio::fs::rename(&part, &final_path).await.map_err(|_| "Berkas tidak bisa disimpan.".to_string())?;
    store.with(|c| db::finish(c, id, &final_path.to_string_lossy(), total as i64)).map_err(|_| "Status unduhan tidak bisa disimpan.".to_string())
}

#[tauri::command]
pub fn moodle_courses(store: State<'_, Store>) -> Res<Vec<db::Course>> {
    if !enabled(&store)? {
        return Ok(Vec::new());
    }
    store.with(db::courses_list)
}

#[tauri::command]
pub fn moodle_files(store: State<'_, Store>, course_id: i64) -> Res<Vec<db::File>> {
    if !enabled(&store)? {
        return Ok(Vec::new());
    }
    store.with(|c| db::files_list(c, course_id))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherKind {
    kind: String,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseView {
    files: Vec<db::File>,
    /// Isi mata pelajaran yang bukan berkas (halaman, kuis, tautan, dan lainnya), per jenis.
    other: Vec<OtherKind>,
    /// Berkas di server lain yang dilewati demi keamanan.
    foreign: usize,
    /// Teks halaman, embed, dan tautan dari halaman Moodle.
    links: Vec<db::Link>,
}

/// Isi `index.html` sebuah halaman Moodle (kecil; lebih dari 512 KB diabaikan).
async fn fetch_page_html(http: &reqwest::Client, url: &str, token: &str) -> Option<String> {
    let mut target = reqwest::Url::parse(url).ok()?;
    target.query_pairs_mut().append_pair("token", token);
    let resp = http.get(target).send().await.ok()?;
    if !resp.status().is_success() || resp.content_length().is_some_and(|n| n > 512 * 1024) {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    (bytes.len() <= 512 * 1024).then(|| String::from_utf8_lossy(&bytes).into_owned())
}

/// Ambil daftar materi satu mata pelajaran dari Moodle (hanya daftar; berkasnya belum diunduh).
#[tauri::command]
pub async fn moodle_refresh_course(app: AppHandle, store: State<'_, Store>, course_id: i64) -> Res<CourseView> {
    if !enabled(&store)? {
        return Err(invalid("Moodle belum dinyalakan."));
    }
    let mut cfg = load_config(&store)?;
    let Some(tok) = token() else { return Err(invalid("Belum masuk ke Moodle.")) };
    let http = client()?;
    // Akun yang masuk sebelum alamat situs dicatat: lengkapi sekali.
    if cfg.site_url.is_empty() {
        if let Ok(info) = call(&http, &cfg.base_url, &tok, "core_webservice_get_site_info", &[]).await {
            cfg.site_url = site_url_of(&info);
            let _ = save_config(&store, &cfg);
        }
    }
    let contents = match call(&http, &cfg.base_url, &tok, "core_course_get_contents", &[param("courseid", course_id)]).await {
        Ok(v) => v,
        Err(CallError::Auth) => return Err(invalid("Sesi Moodle berakhir. Masuk lagi di Pengaturan.")),
        Err(CallError::Other(e)) => return Err(e),
    };
    let parsed = db::parse_contents(&contents, course_id, &allowed_prefixes(&cfg));
    let stale = store.with(|c| db::files_upsert(c, course_id, &parsed.files))?;
    remove_local(&app, &stale);

    // Halaman dan tautan: ambil isi halaman (4 sekaligus) lalu simpan teks, embed, dan tautannya.
    let allowed = allowed_prefixes(&cfg);
    let (mut links, pages) = db::parse_link_modules(&contents, course_id, &allowed);
    if let Ok(dl) = download_client() {
        let refs: Vec<_> = pages.iter().take(60).collect();
        for chunk in refs.chunks(4) {
            let htmls = join_all(chunk.iter().map(|p| {
                let dl = &dl;
                let tok = &tok;
                async move { fetch_page_html(dl, &p.index_url, tok).await }
            }))
            .await;
            for (page, html) in chunk.iter().zip(htmls) {
                if let Some(html) = html {
                    links.extend(db::page_items(page, course_id, &html, &allowed));
                }
            }
        }
    }
    store.with(|c| db::links_replace(c, course_id, &links))?;

    Ok(CourseView {
        files: store.with(|c| db::files_list(c, course_id))?,
        // Halaman dan tautan sudah ditampilkan sendiri, jadi tidak dihitung sebagai "bukan berkas".
        other: parsed.other.into_iter().filter(|(k, _)| k != "page" && k != "url").map(|(kind, count)| OtherKind { kind, count }).collect(),
        foreign: parsed.foreign,
        links: store.with(|c| db::links_list(c, course_id))?,
    })
}

/// Teks halaman, embed, dan tautan yang tersimpan (dibaca offline).
#[tauri::command]
pub fn moodle_links(store: State<'_, Store>, course_id: i64) -> Res<Vec<db::Link>> {
    if !enabled(&store)? {
        return Ok(Vec::new());
    }
    store.with(|c| db::links_list(c, course_id))
}

/// Antrekan unduhan. Kembali seketika; berkas diunduh di latar (dua sekaligus) tanpa mengganggu app.
#[tauri::command]
pub fn moodle_download(app: AppHandle, store: State<'_, Store>, ids: Vec<String>) -> Res<()> {
    if !enabled(&store)? {
        return Err(invalid("Moodle belum dinyalakan."));
    }
    if ids.len() > 2000 {
        return Err(invalid("Terlalu banyak berkas sekaligus."));
    }
    store.with(|c| db::enqueue(c, &ids))?;
    ensure_workers(&app);
    Ok(())
}

#[tauri::command]
pub fn moodle_cancel(store: State<'_, Store>, ids: Vec<String>) -> Res<()> {
    store.with(|c| db::cancel(c, &ids))
}

#[tauri::command]
pub fn moodle_delete_local(app: AppHandle, store: State<'_, Store>, ids: Vec<String>) -> Res<()> {
    let paths = store.with(|c| db::forget_local(c, &ids))?;
    remove_local(&app, &paths);
    Ok(())
}

/// Dipanggil saat app dibuka: unduhan yang terputus dilanjutkan.
#[tauri::command]
pub fn moodle_resume(app: AppHandle, store: State<'_, Store>) -> Res<()> {
    if !enabled(&store)? {
        return Ok(());
    }
    store.with(db::resume_interrupted)?;
    ensure_workers(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize_base;

    #[test]
    fn base_is_cleaned() {
        assert_eq!(normalize_base("lms.sekolah.sch.id").unwrap(), "https://lms.sekolah.sch.id");
        assert_eq!(normalize_base(" https://LMS.Sekolah.sch.id/ ").unwrap(), "https://lms.sekolah.sch.id");
        assert_eq!(normalize_base("https://lms.x.id/login/index.php").unwrap(), "https://lms.x.id");
        assert_eq!(normalize_base("https://x.id/moodle/my/").unwrap(), "https://x.id/moodle");
        assert_eq!(normalize_base("http://localhost:8080/").unwrap(), "http://localhost:8080");
    }

    #[test]
    fn base_rejects_unsafe() {
        assert!(normalize_base("http://lms.x.id").is_err());
        assert!(normalize_base("https://user:pw@lms.x.id").is_err());
        assert!(normalize_base("").is_err());
        assert!(normalize_base("https://lms .x.id").is_err());
        assert!(normalize_base("ftp://lms.x.id").is_err());
    }
}
