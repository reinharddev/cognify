//! Jembatan ke ekstensi browser (folder `extension/`): server HTTP kecil di `127.0.0.1:47615`,
//! hanya berjalan saat dinyalakan di Pengaturan → Data. Ekstensi dipasangkan dengan kode 6 angka
//! (5 menit, sekali pakai, gugur setelah 5 kali salah) dan sesudahnya membawa kunci acak; yang disimpan
//! app hanya SHA-256 dari kunci itu. Permintaan dari origin selain ekstensi browser atau dengan Host
//! yang bukan loopback ditolak, jadi halaman web biasa tidak bisa menyentuhnya.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::store::pages::{self, NewPage, PageUpdate};
use crate::store::{markdown, settings, Error, Store};
use crate::sticky;

pub const PORT: u16 = 47615;
const ENABLED_KEY: &str = "ext.enabled";
const TOKEN_KEY: &str = "ext.token";
const FOLDER_KEY: &str = "ext.folder";
const FOLDER_TITLE: &str = "Kliping web";
/// Batas isi untuk permintaan simpan biasa; rute PDF boleh jauh lebih besar (berkasnya dikirim sebagai base64).
const MAX_CLIP_BODY: usize = 6 * 1024 * 1024;
const MAX_BODY: usize = 40 * 1024 * 1024;
const MAX_HEADERS: usize = 16 * 1024;
const CODE_TTL: Duration = Duration::from_secs(300);
const MAX_CODE_TRIES: u8 = 5;
/// Versi protokol; ekstensi memakainya untuk tahu fitur apa yang ada.
const PROTOCOL: u32 = 2;

struct Code {
    value: String,
    made: Instant,
    tries: u8,
}

/// Keadaan jembatan yang dibagi ke semua koneksi.
#[derive(Default)]
pub struct Bridge {
    code: Mutex<Option<Code>>,
    running: AtomicBool,
    error: Mutex<Option<String>>,
    /// Waktu simpanan terakhir, untuk membatasi kecepatan (satu pemakai wajar tidak sampai batas ini).
    recent: Mutex<std::collections::VecDeque<Instant>>,
}

const RATE_LIMIT: usize = 40;
const RATE_WINDOW: Duration = Duration::from_secs(60);

/// Catat satu simpanan; `false` bila dalam semenit terakhir sudah mencapai batas.
fn allow_clip(bridge: &Bridge) -> bool {
    let mut recent = bridge.recent.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    while recent.front().is_some_and(|t| now.duration_since(*t) > RATE_WINDOW) {
        recent.pop_front();
    }
    if recent.len() >= RATE_LIMIT {
        return false;
    }
    recent.push_back(now);
    true
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    enabled: bool,
    running: bool,
    port: u16,
    paired: bool,
    error: Option<String>,
    code: Option<String>,
    code_expires_in: Option<u64>,
}

struct Request {
    method: String,
    path: String,
    origin: Option<String>,
    host: Option<String>,
    token: Option<String>,
    private_network: bool,
    body: Vec<u8>,
}

struct Reply {
    status: u16,
    body: Value,
}

/// Hasil penanganan: balasan, dan apa yang harus dikerjakan app setelahnya (di luar penyimpanan).
struct Outcome {
    reply: Reply,
    changed: bool,
    open_sticky: Option<String>,
    /// (id halaman, isi baru) untuk disiarkan supaya jendela yang sedang membukanya ikut berubah.
    synced: Option<(String, String)>,
}

impl Outcome {
    fn reply(status: u16, body: Value) -> Self {
        Self { reply: Reply { status, body }, changed: false, open_sticky: None, synced: None }
    }
    fn error(status: u16, code: &str, message: &str) -> Self {
        Self::reply(status, json!({ "error": { "code": code, "message": message } }))
    }
}

fn err_from(e: Error) -> Outcome {
    match e {
        Error::NotFound(m) => Outcome::error(404, "not_found", &m),
        Error::Invalid(m) => Outcome::error(422, "invalid", &m),
        Error::Db(_) => Outcome::error(500, "db_error", &e.to_string()),
    }
}

fn hash(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn random_hex(bytes: usize) -> String {
    let mut out = String::new();
    while out.len() < bytes * 2 {
        out.push_str(&uuid::Uuid::new_v4().simple().to_string());
    }
    out.truncate(bytes * 2);
    out
}

fn random_code() -> String {
    let n = u32::from_be_bytes(uuid::Uuid::new_v4().as_bytes()[..4].try_into().unwrap()) % 1_000_000;
    format!("{n:06}")
}

fn is_extension_origin(origin: &str) -> bool {
    ["chrome-extension://", "moz-extension://", "safari-web-extension://"].iter().any(|p| origin.starts_with(p))
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "[::1]") || host == format!("127.0.0.1:{PORT}") || host == format!("localhost:{PORT}")
}

// ---------- HTTP ----------

fn read_request(stream: &mut TcpStream) -> Result<Request, (u16, &'static str)> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEADERS {
            return Err((431, "Header terlalu besar."));
        }
        let n = stream.read(&mut chunk).map_err(|_| (408, "Permintaan terlalu lama."))?;
        if n == 0 {
            return Err((400, "Permintaan terputus."));
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let method = first.next().unwrap_or("").to_string();
    let path = first.next().unwrap_or("").to_string();
    let mut req = Request { method, path, origin: None, host: None, token: None, private_network: false, body: Vec::new() };
    let mut length = 0usize;
    for line in lines {
        let Some((k, v)) = line.split_once(':') else { continue };
        let v = v.trim();
        match k.trim().to_ascii_lowercase().as_str() {
            "origin" => req.origin = Some(v.to_string()),
            "host" => req.host = Some(v.to_string()),
            "x-cognify-extension" => req.token = Some(v.to_string()),
            "access-control-request-private-network" => req.private_network = true,
            "content-length" => length = v.parse().map_err(|_| (400, "Content-Length tidak sah."))?,
            _ => {}
        }
    }
    if length > MAX_BODY {
        return Err((413, "Isi terlalu besar."));
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < length {
        let n = stream.read(&mut chunk).map_err(|_| (408, "Permintaan terlalu lama."))?;
        if n == 0 {
            return Err((400, "Permintaan terputus."));
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    req.body = body;
    Ok(req)
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        421 => "Misdirected Request",
        422 => "Unprocessable Entity",
        429 => "Too Many Requests",
        _ => "Error",
    }
}

fn write_reply(stream: &mut TcpStream, origin: Option<&str>, private_network: bool, reply: &Reply) {
    let body = if reply.status == 204 { String::new() } else { reply.body.to_string() };
    let mut head = format!("HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n", reply.status, reason(reply.status), body.len());
    if let Some(o) = origin.filter(|o| is_extension_origin(o)) {
        head.push_str(&format!("Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\nAccess-Control-Allow-Headers: Content-Type, X-Cognify-Extension\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n"));
        if private_network {
            head.push_str("Access-Control-Allow-Private-Network: true\r\n");
        }
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}

// ---------- Pemasangan ----------

fn pair(store: &Store, bridge: &Bridge, body: &Value) -> Outcome {
    let given = body.get("code").and_then(|c| c.as_str()).unwrap_or("").trim().to_string();
    let mut slot = bridge.code.lock().unwrap_or_else(|e| e.into_inner());
    let Some(code) = slot.as_mut() else {
        return Outcome::error(400, "pair_invalid", "Belum ada kode. Buat kode baru di Cognify → Pengaturan → Data.");
    };
    if code.made.elapsed() > CODE_TTL {
        *slot = None;
        return Outcome::error(400, "pair_expired", "Kodenya sudah kedaluwarsa. Buat kode baru di Cognify.");
    }
    if code.value != given {
        code.tries += 1;
        if code.tries >= MAX_CODE_TRIES {
            *slot = None;
            return Outcome::error(429, "pair_locked", "Terlalu banyak salah. Buat kode baru di Cognify.");
        }
        return Outcome::error(400, "pair_invalid", "Kodenya salah.");
    }
    *slot = None;
    drop(slot);
    let token = random_hex(32);
    match store.with(|c| settings::set(c, TOKEN_KEY, &hash(&token))) {
        Ok(()) => Outcome::reply(200, json!({ "token": token, "protocol": PROTOCOL })),
        Err(e) => err_from(e),
    }
}

fn authorized(store: &Store, token: Option<&str>) -> bool {
    let Some(token) = token.filter(|t| !t.is_empty()) else { return false };
    store.with(|c| settings::get(c, TOKEN_KEY)).ok().flatten().is_some_and(|h| h == hash(token))
}

// ---------- Simpan ----------

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Target {
    kind: String,
    parent_id: Option<String>,
    page_id: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Clip {
    mode: String,
    url: String,
    title: String,
    text: String,
    markdown: String,
    tags: Vec<String>,
    target: Target,
    /// Data sumber (CSL-JSON) dari metadata halaman, bahan sitasi.
    source: Value,
    /// Judul bagian terdekat di atas teks yang disorot.
    section: String,
    /// Tanggal akses (YYYY-MM-DD) dari browser.
    accessed: String,
    /// Nomor halaman PDF tempat teks yang disorot berada (dari `/bridge/pdf-info`).
    page: Option<u32>,
}

fn clean_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let t: String = t.trim().chars().take(40).collect();
        if !t.is_empty() && !out.iter().any(|x| x.eq_ignore_ascii_case(&t)) && out.len() < 8 {
            out.push(t);
        }
    }
    out
}

/// Halaman induk "Kliping web", dibuat sekali dan dipakai ulang selama masih ada.
fn clips_folder(store: &Store) -> Result<String, Error> {
    if let Some(id) = store.with(|c| settings::get(c, FOLDER_KEY))? {
        if store.with(|c| pages::get(c, &id)).is_ok_and(|p| p.trashed_at.is_none()) {
            return Ok(id);
        }
    }
    let page = store.with(|c| {
        pages::create(c, NewPage { parent_id: None, kind: "folder".into(), title: Some(FOLDER_TITLE.into()), content: None, plain_text: None })
    })?;
    store.with(|c| settings::set(c, FOLDER_KEY, &page.node.id))?;
    Ok(page.node.id)
}

/// Bentuk baku sebuah alamat untuk mengenali halaman web yang sama: skema dan host huruf kecil, tanpa `www.`, tanpa
/// `#bagian`, tanpa parameter pelacak (`utm_*`, `fbclid`, `gclid`, ...), tanpa garis miring di ujung, dan http dianggap https.
/// Parameter lain (mis. `?v=` di YouTube) tetap dihitung supaya halaman berbeda tidak tercampur.
fn normalize_url(url: &str) -> String {
    let url = url.trim();
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")).unwrap_or(url);
    let rest = rest.split('#').next().unwrap_or("");
    let (location, query) = rest.split_once('?').unwrap_or((rest, ""));
    let (host, path) = location.split_once('/').map_or((location, ""), |(h, p)| (h, p));
    let host = host.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let path = path.trim_end_matches('/');
    let mut keep: Vec<&str> = query
        .split('&')
        .filter(|kv| !kv.is_empty())
        .filter(|kv| {
            let key = kv.split('=').next().unwrap_or("").to_ascii_lowercase();
            !(key.starts_with("utm_") || ["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "ref", "ref_src", "si"].contains(&key.as_str()))
        })
        .collect();
    keep.sort_unstable();
    let mut out = format!("https://{host}");
    if !path.is_empty() {
        out.push('/');
        out.push_str(path);
    }
    if !keep.is_empty() {
        out.push('?');
        out.push_str(&keep.join("&"));
    }
    out
}

/// Kunci pengaturan penunjuk "alamat ini sudah punya halaman": `kind` = `h` (sorotan), `p` (halaman penuh), `s` (catatan melayang).
fn url_key(kind: &str, url: &str) -> String {
    let mut h = Sha256::new();
    h.update(normalize_url(url).as_bytes());
    let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    format!("ext.{kind}.{}", &hex[..40])
}

/// Halaman dokumen aktif untuk alamat ini, bila ada dan belum dibuang.
fn lookup(store: &Store, kind: &str, url: &str) -> Result<Option<String>, Error> {
    let Some(id) = store.with(|c| settings::get(c, &url_key(kind, url)))? else { return Ok(None) };
    let alive = store.with(|c| pages::get(c, &id)).is_ok_and(|p| p.trashed_at.is_none() && p.node.kind == "doc");
    Ok(alive.then_some(id))
}

fn remember(store: &Store, kind: &str, url: &str, id: &str) {
    let _ = store.with(|c| settings::set(c, &url_key(kind, url), id));
}

fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// Halaman `id` sudah memuat semua baris teks ini?
fn page_has_text(store: &Store, id: &str, text: &str) -> Result<bool, Error> {
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let like = format!("%{}%", like_escape(line));
        let found = store.with(|c| {
            Ok(c.query_row("SELECT 1 FROM pages WHERE id = ?1 AND plain_text LIKE ?2 ESCAPE '\\'", rusqlite::params![id, like], |_| Ok(())).optional()?.is_some())
        })?;
        if !found {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Tambahkan blok ke akhir dokumen; mengembalikan isi baru (JSON Tiptap) untuk disiarkan ke jendela yang membukanya.
fn append_to(store: &Store, id: &str, add: &Value) -> Result<String, Error> {
    let page = store.with(|c| pages::get(c, id))?;
    if page.node.kind != "doc" {
        return Err(Error::Invalid("Hanya dokumen yang bisa ditambah.".into()));
    }
    let mut doc: Value = serde_json::from_str(&page.content).unwrap_or_else(|_| json!({ "type": "doc", "content": [] }));
    if !doc.get("content").is_some_and(|c| c.is_array()) {
        doc = json!({ "type": "doc", "content": [] });
    }
    let list = doc["content"].as_array_mut().unwrap();
    // Dokumen kosong hanya berisi satu paragraf tanpa isi; ganti, jangan ditumpuk.
    if list.len() == 1 && list[0].get("content").is_none() && list[0].get("type").and_then(|t| t.as_str()) == Some("paragraph") {
        list.clear();
    } else if !list.is_empty() {
        list.push(json!({ "type": "horizontalRule" }));
    }
    if let Some(new) = add.get("content").and_then(|c| c.as_array()) {
        list.extend(new.iter().cloned());
    }
    let plain = markdown::plain_text(&doc);
    let content = doc.to_string();
    store.with(|c| pages::update(c, id, PageUpdate { content: Some(content.clone()), plain_text: Some(plain), ..Default::default() }))?;
    Ok(content)
}

/// Buang penanda rujukan gaya Wikipedia yang ikut tersalin: `[2]`, `[b]`, `[2, 3]`, `[2–4]`, `[citation needed]`.
fn strip_citations(text: &str) -> String {
    fn is_marker(inner: &str) -> bool {
        let inner = inner.trim();
        let notes = ["citation needed", "clarification needed", "when?", "who?", "dubious", "verification needed"];
        notes.iter().any(|n| inner.eq_ignore_ascii_case(n))
            || (inner.len() == 1 && inner.chars().all(|c| c.is_ascii_lowercase()))
            || (!inner.is_empty() && inner.len() <= 12 && inner.chars().next().is_some_and(|c| c.is_ascii_digit()) && inner.chars().all(|c| c.is_ascii_digit() || matches!(c, ',' | ' ' | '-' | '–' | '—')))
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find(']') else { break };
        let inner = &rest[open + 1..open + close];
        out.push_str(&rest[..open]);
        if is_marker(inner) {
            // Spasi ganda akibat pembuangan dirapikan di bawah.
        } else {
            out.push_str(&rest[open..=open + close]);
        }
        rest = &rest[open + close + 1..];
    }
    out.push_str(rest);
    out.replace("  ", " ").replace(" .", ".").replace(" ,", ",")
}

/// Alamat tanpa `#bagian`.
fn without_fragment(url: &str) -> &str {
    url.split('#').next().unwrap_or(url)
}

fn host_of(url: &str) -> String {
    let rest = url.trim().trim_start_matches("https://").trim_start_matches("http://");
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase();
    host.strip_prefix("www.").unwrap_or(&host).to_string()
}

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Alamat yang membuka halaman tepat di teks yang disorot (text fragment, didukung Chrome, Edge, Brave, Safari, dan
/// Firefox baru); browser yang tidak mengenalinya membuka halamannya saja.
fn text_fragment_url(url: &str, text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let frag = if words.len() <= 6 {
        percent_encode(&words.join(" "))
    } else {
        format!("{},{}", percent_encode(&words[..3].join(" ")), percent_encode(&words[words.len() - 3..].join(" ")))
    };
    format!("{}#:~:text={frag}", without_fragment(url))
}

/// Alamat bagian: untuk PDF `#page=N` (parameter standar penampil PDF), selain itu text fragment.
fn part_url(url: &str, text: &str, page: Option<u32>) -> String {
    match page {
        Some(n) => format!("{}#page={n}", without_fragment(url)),
        None => text_fragment_url(url, text),
    }
}

/// Satu paragraf berisi tautan. `class` dipakai CSS editor: `src` (sumber utama) dan `src-part` (sumber bagian).
fn link_para(href: &str, label: &str, class: &str) -> Value {
    json!({ "type": "paragraph", "content": [{ "type": "text", "text": label, "marks": [{ "type": "link", "attrs": { "href": href, "class": class, "target": "_blank", "rel": "noopener noreferrer nofollow" } }] }] })
}

/// Sumber utama di awal catatan: `en.wikipedia.org · Judul ↗`.
fn source_block(url: &str, title: &str) -> Value {
    let host = host_of(url);
    let t = title.trim();
    let label = if t.is_empty() || t == url { format!("{host} ↗") } else { format!("{host} · {} ↗", t.chars().take(80).collect::<String>()) };
    link_para(without_fragment(url), &label, "src")
}

/// Isi sorotan sebagai teks biasa (satu paragraf per baris), diikuti tautan ke bagian itu di halaman asalnya.
fn highlight_blocks(url: &str, text: &str, page: Option<u32>) -> Vec<Value> {
    let mut out: Vec<Value> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|l| json!({ "type": "paragraph", "content": [{ "type": "text", "text": l }] }))
        .collect();
    // Alamat bagian ditulis apa adanya sebagai teks (bisa diblok dan disalin), sekaligus tetap bisa diklik.
    let part = part_url(url, text, page);
    out.push(link_para(&part, &part, "src-part"));
    out
}

fn doc_of(blocks: Vec<Value>) -> Value {
    json!({ "type": "doc", "content": blocks })
}


fn clip(store: &Store, body: &Value) -> Outcome {
    let c: Clip = match serde_json::from_value(body.clone()) {
        Ok(c) => c,
        Err(_) => return Outcome::error(422, "invalid", "Isi permintaan tidak sah."),
    };
    if !(c.url.starts_with("http://") || c.url.starts_with("https://")) || c.url.len() > 2048 {
        return Outcome::error(422, "invalid", "Hanya alamat http/https yang bisa disimpan.");
    }
    let title: String = {
        let t = c.title.trim();
        let t = if t.is_empty() { c.url.as_str() } else { t };
        t.chars().take(200).collect()
    };
    let tags = clean_tags(&c.tags);

    // Susunan catatan: sumber utama di atas, isi sebagai teks biasa, lalu tautan ke bagian yang disorot. `piece` adalah
    // bagian yang ditambahkan ke catatan yang sudah ada (tanpa sumber utama, karena sudah ada di sana).
    let (doc, piece, page_title): (Value, Value, String) = match c.mode.as_str() {
        "selection" => {
            if c.text.trim().is_empty() {
                return Outcome::error(422, "invalid", "Tidak ada teks terpilih.");
            }
            let cleaned = strip_citations(&c.text);
            let mut blocks = vec![source_block(&c.url, &title)];
            let body = highlight_blocks(&c.url, &cleaned, c.page);
            blocks.extend(body.clone());
            (doc_of(blocks), doc_of(body), title.clone())
        }
        "page" => {
            if c.markdown.trim().is_empty() {
                return Outcome::error(422, "invalid", "Halaman ini tidak punya isi yang bisa disimpan.");
            }
            let mut blocks = vec![source_block(&c.url, &title)];
            if let Some(list) = markdown::to_doc(&c.markdown).get("content").and_then(|x| x.as_array()) {
                blocks.extend(list.iter().cloned());
            }
            (doc_of(blocks.clone()), doc_of(blocks), title.clone())
        }
        "link" => {
            let d = doc_of(vec![source_block(&c.url, &title)]);
            (d.clone(), d, title.clone())
        }
        // PDF yang dibuka di browser: catatan berisi sumber saja; isinya datang dari sorotan berikutnya.
        "pdf" => {
            if !c.source.is_object() {
                return Outcome::error(422, "invalid", "Data PDF tidak ada.");
            }
            let d = doc_of(vec![source_block(&c.url, &title)]);
            (d.clone(), d, title.clone())
        }
        _ => return Outcome::error(422, "invalid", "Jenis simpan tidak dikenal."),
    };
    let plain = markdown::plain_text(&doc);

    type Done = (String, bool, Option<String>, Option<String>); // id, baru dibuat, buka sebagai catatan melayang, isi baru
    let result: Result<Done, Outcome> = (|| {
        // Tambah ke halaman pilihan pengguna.
        if c.target.kind == "append" {
            let id = c.target.page_id.clone().ok_or_else(|| Outcome::error(422, "invalid", "Pilih halaman tujuan."))?;
            let content = append_to(store, &id, &doc).map_err(err_from)?;
            return Ok((id, false, None, Some(content)));
        }
        let sticky_note = c.target.kind == "sticky";
        let kind = if sticky_note { "s" } else if c.mode == "selection" { "h" } else { "p" };
        let tracked = sticky_note || c.mode != "link";
        // Satu alamat, satu halaman: sorotan menumpuk di catatannya (teks yang sama tidak ditambah lagi), dan catatan
        // melayang untuk alamat itu cukup dimunculkan.
        if tracked {
            if let Some(id) = lookup(store, kind, &c.url).map_err(err_from)? {
                let mut content = None;
                if c.mode == "selection" {
                    let cleaned = strip_citations(&c.text);
                    if !page_has_text(store, &id, &cleaned).map_err(err_from)? {
                        content = Some(append_to(store, &id, &piece).map_err(err_from)?);
                    }
                } else if !sticky_note {
                    return Err(Outcome::reply(409, json!({ "error": { "code": "exists", "message": "Halaman ini sudah tersimpan." }, "id": id })));
                }
                return Ok((id.clone(), false, sticky_note.then_some(id), content));
            }
        }
        let parent = if sticky_note {
            sticky::folder_in(store).map_err(|m| Outcome::error(500, "db_error", &m))?
        } else if let Some(p) = c.target.parent_id.clone().filter(|p| !p.is_empty()) {
            p
        } else {
            clips_folder(store).map_err(err_from)?
        };
        let page = store
            .with(|conn| {
                pages::create(
                    conn,
                    NewPage { parent_id: Some(parent), kind: "doc".into(), title: Some(page_title.clone()), content: Some(doc.to_string()), plain_text: Some(plain.clone()) },
                )
            })
            .map_err(err_from)?;
        let id = page.node.id;
        if !tags.is_empty() {
            store.with(|conn| pages::update(conn, &id, PageUpdate { tags: Some(tags.clone()), ..Default::default() })).map_err(err_from)?;
        }
        if tracked {
            remember(store, kind, &c.url, &id);
        }
        Ok((id.clone(), true, sticky_note.then_some(id), None))
    })();

    match result {
        Ok((id, created, open_sticky, content)) => {
            if (c.mode != "link" || c.source.is_object()) && c.target.kind != "append" {
                // Data sumber untuk sitasi; gagal menyimpannya tidak boleh menggagalkan simpanan itu sendiri.
                let accessed: String = if c.accessed.len() == 10 && c.accessed.chars().all(|ch| ch.is_ascii_digit() || ch == '-') { c.accessed.clone() } else { crate::store::now_iso().chars().take(10).collect() };
                let section: String = c.section.trim().chars().take(200).collect();
                let url = if c.mode == "selection" { part_url(&c.url, &strip_citations(&c.text), c.page) } else { without_fragment(&c.url).to_string() };
                let mark = json!({ "url": url, "section": section, "accessed": accessed, "page": c.page });
                let source = if c.source.is_object() { c.source.clone() } else { json!({}) };
                if let Err(e) = store.with(|conn| crate::store::sources::save(conn, &id, &source, Some(mark))) {
                    log::warn!("Data sumber tidak tersimpan: {e}");
                }
            }
            let mut out = Outcome::reply(200, json!({ "id": id, "created": created }));
            out.changed = true;
            out.synced = content.map(|c| (id.clone(), c));
            out.open_sticky = open_sticky;
            out
        }
        Err(o) => o,
    }
}

/// Baca PDF yang dikirim ekstensi: metadata, DOI, dan halaman tempat teks yang disorot berada. Tidak ada yang disimpan.
fn pdf_info(body: &Value) -> Outcome {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let Some(data) = body.get("data").and_then(|d| d.as_str()) else {
        return Outcome::error(422, "invalid", "Berkas PDF tidak ada.");
    };
    let Ok(bytes) = STANDARD.decode(data) else {
        return Outcome::error(422, "invalid", "Berkas PDF rusak.");
    };
    if !bytes.starts_with(b"%PDF") {
        return Outcome::error(422, "invalid", "Ini bukan berkas PDF.");
    }
    let text = |k: &str| body.get(k).and_then(|v| v.as_str()).unwrap_or("");
    let url = text("url");
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Outcome::error(422, "invalid", "Alamat PDF tidak sah.");
    }
    let selection = Some(text("selection")).filter(|s| !s.trim().is_empty());
    match crate::pdfmeta::analyze(&bytes, selection, text("tabTitle"), url) {
        Ok(info) => Outcome::reply(200, json!({ "source": info.source, "pages": info.pages, "page": info.page })),
        Err(m) => Outcome::error(422, "invalid_pdf", &m),
    }
}

fn targets(store: &Store) -> Outcome {
    let rows = store.with(|c| {
        let mut stmt = c.prepare("SELECT id, title FROM pages WHERE kind = 'doc' AND trashed_at IS NULL ORDER BY updated_at DESC LIMIT 30")?;
        let rows = stmt.query_map([], |r| Ok(json!({ "id": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)? })))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    });
    match rows {
        Ok(pages) => Outcome::reply(200, json!({ "pages": pages })),
        Err(e) => err_from(e),
    }
}

fn handle(store: &Store, bridge: &Bridge, req: &Request) -> Outcome {
    // Browser menyertakan Origin pada POST dan preflight, tapi tidak pada GET dari halaman ekstensi, jadi Origin yang
    // ada harus milik ekstensi, dan yang tidak ada hanya boleh membawa kunci sah (halaman web biasa tidak bisa
    // menambah header kunci tanpa preflight, dan pemasangan lewat POST selalu membawa Origin).
    match req.origin.as_deref() {
        Some(o) if !is_extension_origin(o) => return Outcome::error(403, "forbidden_origin", "Hanya ekstensi browser yang boleh memakai jembatan ini."),
        None if req.method == "OPTIONS" || req.path.split('?').next() == Some("/bridge/pair") => {
            return Outcome::error(403, "forbidden_origin", "Hanya ekstensi browser yang boleh memakai jembatan ini.");
        }
        _ => {}
    }
    if !req.host.as_deref().is_some_and(is_loopback_host) {
        return Outcome::error(421, "forbidden_host", "Host tidak dikenali.");
    }
    if req.method == "OPTIONS" {
        return Outcome::reply(204, Value::Null);
    }
    let path = req.path.split('?').next().unwrap_or("");
    let body: Value = if req.body.is_empty() { Value::Null } else { serde_json::from_slice(&req.body).unwrap_or(Value::Null) };
    match (req.method.as_str(), path) {
        ("POST", "/bridge/pair") => pair(store, bridge, &body),
        (_, "/bridge/status" | "/bridge/targets" | "/bridge/clip" | "/bridge/pdf-info") if !authorized(store, req.token.as_deref()) => {
            Outcome::error(401, "unauthorized", "Ekstensi belum dipasangkan.")
        }
        ("GET", "/bridge/status") => Outcome::reply(200, json!({ "ok": true, "protocol": PROTOCOL })),
        ("GET", "/bridge/targets") => targets(store),
        ("POST", "/bridge/clip") if req.body.len() > MAX_CLIP_BODY => Outcome::error(413, "too_large", "Isi terlalu besar."),
        ("POST", "/bridge/pdf-info") if !allow_clip(bridge) => Outcome::error(429, "too_fast", "Terlalu cepat. Tunggu sebentar lalu coba lagi."),
        ("POST", "/bridge/pdf-info") => pdf_info(&body),
        ("POST", "/bridge/clip") if !allow_clip(bridge) => {
            Outcome::error(429, "too_fast", "Terlalu cepat. Tunggu sebentar lalu coba lagi.")
        }
        ("POST", "/bridge/clip") => clip(store, &body),
        _ => Outcome::error(404, "not_found", "Tidak ada."),
    }
}

fn serve(app: &AppHandle, mut stream: TcpStream) {
    let store = app.state::<Store>();
    let bridge = app.state::<Bridge>();
    let req = match read_request(&mut stream) {
        Ok(r) => r,
        Err((status, msg)) => {
            write_reply(&mut stream, None, false, &Reply { status, body: json!({ "error": { "code": "bad_request", "message": msg } }) });
            return;
        }
    };
    let out = handle(&store, &bridge, &req);
    write_reply(&mut stream, req.origin.as_deref(), req.private_network, &out.reply);
    if out.changed {
        let _ = app.emit(sticky::PAGES_CHANGED, ());
    }
    if let Some((id, content)) = out.synced {
        // Jendela (catatan melayang atau halaman di jendela utama) yang sedang membuka halaman ini ikut berubah.
        let _ = app.emit("page-synced", json!({ "id": id, "content": content, "from": "bridge" }));
    }
    if let Some(id) = out.open_sticky {
        let _ = sticky::open(app, &id);
    }
}

// ---------- Menyalakan dan mematikan ----------

fn enabled(store: &Store) -> bool {
    store.with(|c| settings::get(c, ENABLED_KEY)).ok().flatten().as_deref() == Some("1")
}

/// Jalankan server bila belum jalan dan pengaturannya menyala; berhenti sendiri saat dimatikan.
pub fn start(app: &AppHandle) {
    let bridge = app.state::<Bridge>();
    if !enabled(&app.state::<Store>()) || bridge.running.swap(true, Ordering::SeqCst) {
        return;
    }
    let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(l) => l,
        Err(e) => {
            bridge.running.store(false, Ordering::SeqCst);
            *bridge.error.lock().unwrap_or_else(|e| e.into_inner()) = Some({ log::warn!("Jembatan ekstensi: port {PORT} tidak bisa dipakai ({e})"); "Belum bisa dinyalakan karena ada aplikasi lain yang memakai jalurnya. Tutup aplikasi lain lalu nyalakan lagi.".to_string() });
            return;
        }
    };
    *bridge.error.lock().unwrap_or_else(|e| e.into_inner()) = None;
    listener.set_nonblocking(true).ok();
    let app = app.clone();
    let alive = Arc::new(());
    std::thread::spawn(move || {
        let _alive = alive;
        loop {
            if !enabled(&app.state::<Store>()) {
                break;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false).ok();
                    let app = app.clone();
                    std::thread::spawn(move || serve(&app, stream));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(120)),
                Err(_) => std::thread::sleep(Duration::from_millis(500)),
            }
        }
        app.state::<Bridge>().running.store(false, Ordering::SeqCst);
    });
}

fn status_of(app: &AppHandle) -> BridgeStatus {
    let store = app.state::<Store>();
    let bridge = app.state::<Bridge>();
    let paired = store.with(|c| settings::get(c, TOKEN_KEY)).ok().flatten().is_some_and(|h| !h.is_empty());
    let (code, expires) = {
        let mut slot = bridge.code.lock().unwrap_or_else(|e| e.into_inner());
        if slot.as_ref().is_some_and(|c| c.made.elapsed() > CODE_TTL) {
            *slot = None;
        }
        match slot.as_ref() {
            Some(c) => (Some(c.value.clone()), Some(CODE_TTL.saturating_sub(c.made.elapsed()).as_secs())),
            None => (None, None),
        }
    };
    let error = bridge.error.lock().unwrap_or_else(|e| e.into_inner()).clone();
    BridgeStatus { enabled: enabled(&store), running: bridge.running.load(Ordering::SeqCst), port: PORT, paired, error, code, code_expires_in: expires }
}

#[tauri::command]
pub fn bridge_status(app: AppHandle) -> BridgeStatus {
    status_of(&app)
}

#[tauri::command]
pub fn bridge_set_enabled(app: AppHandle, store: State<'_, Store>, enabled: bool) -> Result<BridgeStatus, Error> {
    store.with(|c| settings::set(c, ENABLED_KEY, if enabled { "1" } else { "0" }))?;
    if enabled {
        start(&app);
    } else {
        *app.state::<Bridge>().code.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
    // Server berhenti sendiri dalam sekejap; beri waktu supaya status yang dikembalikan sudah benar.
    if !enabled {
        std::thread::sleep(Duration::from_millis(250));
    }
    Ok(status_of(&app))
}

#[tauri::command]
pub fn bridge_new_code(app: AppHandle) -> Result<BridgeStatus, String> {
    if !enabled(&app.state::<Store>()) {
        return Err("Nyalakan ekstensi browser dulu.".into());
    }
    start(&app);
    *app.state::<Bridge>().code.lock().unwrap_or_else(|e| e.into_inner()) = Some(Code { value: random_code(), made: Instant::now(), tries: 0 });
    Ok(status_of(&app))
}

#[tauri::command]
pub fn bridge_unpair(app: AppHandle, store: State<'_, Store>) -> Result<BridgeStatus, Error> {
    store.with(|c| settings::set(c, TOKEN_KEY, ""))?;
    Ok(status_of(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(method: &str, path: &str, token: Option<&str>, body: Value) -> Request {
        Request {
            method: method.into(),
            path: path.into(),
            origin: Some("chrome-extension://abc".into()),
            host: Some(format!("127.0.0.1:{PORT}")),
            token: token.map(String::from),
            private_network: false,
            body: if body.is_null() { Vec::new() } else { body.to_string().into_bytes() },
        }
    }

    fn setup() -> (Store, Bridge) {
        (Store::open_in_memory().unwrap(), Bridge::default())
    }

    fn pair_now(store: &Store, bridge: &Bridge) -> String {
        *bridge.code.lock().unwrap() = Some(Code { value: "123456".into(), made: Instant::now(), tries: 0 });
        let out = handle(store, bridge, &req("POST", "/bridge/pair", None, json!({ "code": "123456" })));
        assert_eq!(out.reply.status, 200);
        out.reply.body["token"].as_str().unwrap().to_string()
    }

    #[test]
    fn web_pages_and_foreign_hosts_are_refused() {
        let (store, bridge) = setup();
        let mut r = req("GET", "/bridge/status", None, Value::Null);
        r.origin = Some("https://evil.example".into());
        assert_eq!(handle(&store, &bridge, &r).reply.status, 403);
        // Tanpa Origin (GET dari ekstensi): ditolak bila tanpa kunci, tapi bukan karena origin.
        r.origin = None;
        assert_eq!(handle(&store, &bridge, &r).reply.status, 401);
        let mut pairing = req("POST", "/bridge/pair", None, json!({ "code": "123456" }));
        pairing.origin = None;
        assert_eq!(handle(&store, &bridge, &pairing).reply.status, 403);
        let mut r = req("GET", "/bridge/status", None, Value::Null);
        r.host = Some("evil.example:47615".into());
        assert_eq!(handle(&store, &bridge, &r).reply.status, 421);
    }

    #[test]
    fn pairing_gives_a_token_once_and_the_hash_is_stored() {
        let (store, bridge) = setup();
        assert_eq!(handle(&store, &bridge, &req("GET", "/bridge/status", None, Value::Null)).reply.status, 401);
        let token = pair_now(&store, &bridge);
        assert_eq!(handle(&store, &bridge, &req("GET", "/bridge/status", Some(&token), Value::Null)).reply.status, 200);
        assert_eq!(handle(&store, &bridge, &req("GET", "/bridge/status", Some("salah"), Value::Null)).reply.status, 401);
        let stored = store.with(|c| settings::get(c, TOKEN_KEY)).unwrap().unwrap();
        assert_eq!(stored, hash(&token));
        assert_ne!(stored, token);
        // Kode sekali pakai.
        let again = handle(&store, &bridge, &req("POST", "/bridge/pair", None, json!({ "code": "123456" })));
        assert_eq!(again.reply.status, 400);
    }

    #[test]
    fn five_wrong_codes_lock_the_code() {
        let (store, bridge) = setup();
        *bridge.code.lock().unwrap() = Some(Code { value: "123456".into(), made: Instant::now(), tries: 0 });
        for _ in 0..4 {
            assert_eq!(handle(&store, &bridge, &req("POST", "/bridge/pair", None, json!({ "code": "000000" }))).reply.status, 400);
        }
        assert_eq!(handle(&store, &bridge, &req("POST", "/bridge/pair", None, json!({ "code": "000000" }))).reply.status, 429);
        assert_eq!(handle(&store, &bridge, &req("POST", "/bridge/pair", None, json!({ "code": "123456" }))).reply.status, 400);
    }

    #[test]
    fn expired_codes_are_rejected() {
        let (store, bridge) = setup();
        *bridge.code.lock().unwrap() = Some(Code { value: "123456".into(), made: Instant::now() - CODE_TTL - Duration::from_secs(1), tries: 0 });
        let out = handle(&store, &bridge, &req("POST", "/bridge/pair", None, json!({ "code": "123456" })));
        assert_eq!(out.reply.body["error"]["code"], "pair_expired");
    }

    #[test]
    fn selections_pile_up_on_one_note_per_address() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let send = |text: &str| {
            handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), json!({ "mode": "selection", "url": "https://a.test/x", "title": "Artikel", "text": text, "tags": ["web", "WEB"] })))
        };
        let first = send("kalimat satu");
        assert_eq!(first.reply.body["created"], true);
        let second = send("kalimat dua");
        assert_eq!(second.reply.body["created"], false);
        assert_eq!(first.reply.body["id"], second.reply.body["id"]);
        let page = store.with(|c| pages::get(c, first.reply.body["id"].as_str().unwrap())).unwrap();
        assert_eq!(page.node.title, "Artikel");
        assert_eq!(page.tags, vec!["web".to_string()]);
        assert!(page.content.contains("kalimat satu") && page.content.contains("kalimat dua"));
        let parent = page.node.parent_id.unwrap();
        assert_eq!(store.with(|c| pages::get(c, &parent)).unwrap().node.title, FOLDER_TITLE);
    }

    #[test]
    fn a_page_saved_twice_is_a_conflict() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let body = json!({ "mode": "page", "url": "https://a.test/p", "title": "Halaman", "markdown": "# Judul\n\nIsi." });
        assert_eq!(handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), body.clone())).reply.status, 200);
        assert_eq!(handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), body)).reply.status, 409);
    }

    #[test]
    fn append_target_adds_to_the_chosen_page() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let target = store.with(|c| pages::create(c, NewPage { parent_id: None, kind: "doc".into(), title: Some("Riset".into()), content: None, plain_text: None })).unwrap();
        let out = handle(
            &store,
            &bridge,
            &req("POST", "/bridge/clip", Some(&token), json!({ "mode": "link", "url": "https://a.test/l", "title": "Tautan", "target": { "kind": "append", "pageId": target.node.id } })),
        );
        assert_eq!(out.reply.status, 200);
        let page = store.with(|c| pages::get(c, &target.node.id)).unwrap();
        assert!(page.content.contains("https://a.test/l"));
        let mut bad = json!({ "mode": "link", "url": "https://a.test/l", "target": { "kind": "append", "pageId": "tidak-ada" } });
        assert_eq!(handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), bad.take())).reply.status, 404);
    }

    #[test]
    fn sticky_target_creates_under_the_floating_notes_page_and_asks_to_open() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let out = handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), json!({ "mode": "selection", "url": "https://a.test/s", "text": "catatan", "target": { "kind": "sticky" } })));
        assert_eq!(out.reply.status, 200);
        let id = out.open_sticky.unwrap();
        let parent = store.with(|c| pages::get(c, &id)).unwrap().node.parent_id.unwrap();
        assert_eq!(store.with(|c| pages::get(c, &parent)).unwrap().node.title, "Catatan melayang");
    }

    #[test]
    fn bad_clips_are_rejected() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        for body in [
            json!({ "mode": "selection", "url": "file:///etc/passwd", "text": "x" }),
            json!({ "mode": "selection", "url": "https://a.test", "text": "  " }),
            json!({ "mode": "page", "url": "https://a.test", "markdown": "" }),
            json!({ "mode": "gambar", "url": "https://a.test" }),
        ] {
            assert_eq!(handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), body)).reply.status, 422);
        }
    }

    #[test]
    fn targets_list_recent_documents() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        store.with(|c| pages::create(c, NewPage { parent_id: None, kind: "doc".into(), title: Some("Satu".into()), content: None, plain_text: None })).unwrap();
        let out = handle(&store, &bridge, &req("GET", "/bridge/targets", Some(&token), Value::Null));
        assert_eq!(out.reply.body["pages"][0]["title"], "Satu");
    }

    #[test]
    fn preflight_needs_no_token_but_still_an_extension_origin() {
        let (store, bridge) = setup();
        assert_eq!(handle(&store, &bridge, &req("OPTIONS", "/bridge/clip", None, Value::Null)).reply.status, 204);
    }

    #[test]
    fn http_layer_parses_split_requests_and_answers_with_cors() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut s = TcpStream::connect(addr).unwrap();
            let body = r#"{"code":"123456"}"#;
            let head = format!("POST /bridge/pair HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nOrigin: moz-extension://x\r\nContent-Type: application/json\r\nAccess-Control-Request-Private-Network: true\r\nContent-Length: {}\r\n\r\n", body.len());
            s.write_all(head.as_bytes()).unwrap();
            std::thread::sleep(Duration::from_millis(50));
            s.write_all(body.as_bytes()).unwrap();
            let mut reply = String::new();
            s.read_to_string(&mut reply).unwrap();
            reply
        });
        let (mut conn, _) = listener.accept().unwrap();
        let req = read_request(&mut conn).unwrap();
        assert_eq!((req.method.as_str(), req.path.as_str()), ("POST", "/bridge/pair"));
        assert_eq!(req.body, br#"{"code":"123456"}"#);
        write_reply(&mut conn, req.origin.as_deref(), req.private_network, &Reply { status: 400, body: json!({ "error": { "code": "pair_invalid" } }) });
        drop(conn);
        let reply = client.join().unwrap();
        assert!(reply.starts_with("HTTP/1.1 400 Bad Request"));
        assert!(reply.contains("Access-Control-Allow-Origin: moz-extension://x"));
        assert!(reply.contains("Access-Control-Allow-Private-Network: true"));
        assert!(reply.ends_with(r#"{"error":{"code":"pair_invalid"}}"#));
    }

    #[test]
    fn oversized_bodies_are_refused_before_reading_them() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut s = TcpStream::connect(addr).unwrap();
            s.write_all(format!("POST /bridge/clip HTTP/1.1\r\nContent-Length: {}\r\n\r\n", MAX_BODY + 1).as_bytes()).unwrap();
        });
        let (mut conn, _) = listener.accept().unwrap();
        assert_eq!(read_request(&mut conn).err().map(|e| e.0), Some(413));
        client.join().unwrap();
    }

    #[test]
    fn repeating_the_same_floating_note_reuses_it() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let send = || handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), json!({ "mode": "selection", "url": "https://a.test/s", "text": "kalimat yang sama[2]", "target": { "kind": "sticky" } })));
        let first = send();
        assert_eq!(first.reply.body["created"], true);
        for _ in 0..30 {
            let again = send();
            assert_eq!(again.reply.body["created"], false);
            assert_eq!(again.reply.body["id"], first.reply.body["id"]);
            assert!(again.open_sticky.is_some());
        }
        let folder = sticky::folder_in(&store).unwrap();
        let count: i64 = store.with(|c| Ok(c.query_row("SELECT COUNT(*) FROM pages WHERE parent_id = ?1", [&folder], |r| r.get(0))?)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn source_data_and_section_are_stored_per_page_and_highlight() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let send = |text: &str, section: &str| {
            handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), json!({
                "mode": "selection", "url": "https://a.test/artikel", "title": "Artikel", "text": text, "section": section, "accessed": "2026-10-22",
                "source": { "type": "article-newspaper", "title": "Artikel", "container-title": "Harian", "author": [{ "family": "Rahman", "given": "Andi" }] }
            })))
        };
        let id = send("satu dua tiga empat lima enam tujuh", "Sejarah").reply.body["id"].as_str().unwrap().to_string();
        send("kalimat lain", "Fakta");
        let got = store.with(|c| crate::store::sources::get(c, &id)).unwrap().unwrap();
        assert_eq!(got["source"]["container-title"], "Harian");
        assert_eq!(got["marks"].as_array().unwrap().len(), 2);
        assert_eq!(got["marks"][0]["section"], "Sejarah");
        assert_eq!(got["marks"][0]["accessed"], "2026-10-22");
        assert!(got["marks"][0]["url"].as_str().unwrap().starts_with("https://a.test/artikel#:~:text=satu%20dua%20tiga,"));
    }

    #[test]
    fn pdf_flow_reads_the_file_then_saves_a_source_note_and_page_linked_highlights() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let bytes = crate::pdfmeta::tests::pdf(&["Halaman satu.", "Halaman dua: kalimat penting tentang inflasi dan suku bunga acuan."], None);
        let info = handle(&store, &bridge, &req("POST", "/bridge/pdf-info", Some(&token), json!({
            "data": STANDARD.encode(&bytes), "selection": "kalimat penting tentang inflasi dan suku bunga", "url": "https://a.test/laporan.pdf", "tabTitle": "Laporan Inflasi 2026"
        })));
        assert_eq!(info.reply.status, 200);
        assert_eq!(info.reply.body["page"], 2);
        assert_eq!(info.reply.body["source"]["title"], "Laporan Inflasi 2026");
        let source = info.reply.body["source"].clone();
        let clip = |mode: &str, extra: Value| {
            let mut b = json!({ "mode": mode, "url": "https://a.test/laporan.pdf", "title": "Laporan Inflasi 2026", "source": source, "accessed": "2026-10-22" });
            b.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), b))
        };
        let saved = clip("pdf", json!({}));
        assert_eq!(saved.reply.status, 200);
        assert_eq!(saved.reply.body["created"], true);
        assert_eq!(clip("pdf", json!({})).reply.status, 409);
        let h = clip("selection", json!({ "text": "kalimat penting tentang inflasi", "page": 2 }));
        let id = h.reply.body["id"].as_str().unwrap().to_string();
        let got = store.with(|c| crate::store::sources::get(c, &id)).unwrap().unwrap();
        assert_eq!(got["source"]["title"], "Laporan Inflasi 2026");
        assert_eq!(got["marks"].as_array().unwrap().last().unwrap()["page"], 2);
        let content = store.with(|c| pages::get(c, &id)).unwrap().content;
        assert!(content.contains("https://a.test/laporan.pdf#page=2"));
        // Bukan PDF, atau base64 rusak, ditolak rapi.
        let bad = handle(&store, &bridge, &req("POST", "/bridge/pdf-info", Some(&token), json!({ "data": STANDARD.encode(b"halo"), "url": "https://a.test/x.pdf" })));
        assert_eq!(bad.reply.status, 422);
    }

    #[test]
    fn highlight_links_jump_to_the_passage() {
        assert_eq!(text_fragment_url("https://en.wikipedia.org/wiki/X#bagian", "Kalimat pendek ini"), "https://en.wikipedia.org/wiki/X#:~:text=Kalimat%20pendek%20ini");
        let long = "satu dua tiga empat lima enam tujuh delapan sembilan sepuluh";
        assert_eq!(text_fragment_url("https://a.test/p", long), "https://a.test/p#:~:text=satu%20dua%20tiga,delapan%20sembilan%20sepuluh");
        assert_eq!(host_of("https://www.En.Wikipedia.org/wiki/X?y=1"), "en.wikipedia.org");
    }

    #[test]
    fn urls_are_normalized_but_meaningful_query_stays() {
        assert_eq!(normalize_url("http://WWW.Example.com/a/b/?utm_source=x&fbclid=1#bagian"), "https://example.com/a/b");
        assert_eq!(normalize_url("https://example.com/a/b"), normalize_url("https://www.example.com/a/b/?utm_campaign=z"));
        assert_ne!(normalize_url("https://youtube.com/watch?v=aaa"), normalize_url("https://youtube.com/watch?v=bbb"));
        assert_eq!(normalize_url("https://x.test/p?b=2&a=1"), normalize_url("https://x.test/p?a=1&b=2"));
    }

    #[test]
    fn one_floating_note_per_page_however_many_highlights() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let mut ids = std::collections::HashSet::new();
        for i in 0..30 {
            let out = handle(
                &store,
                &bridge,
                &req("POST", "/bridge/clip", Some(&token), json!({ "mode": "selection", "url": format!("https://www.a.test/artikel/?utm_source=s{i}#h{i}"), "title": "A", "text": format!("sorotan nomor {i}"), "target": { "kind": "sticky" } })),
            );
            assert_eq!(out.reply.status, 200);
            ids.insert(out.reply.body["id"].as_str().unwrap().to_string());
            assert!(out.open_sticky.is_some());
        }
        assert_eq!(ids.len(), 1);
        let id = ids.into_iter().next().unwrap();
        let content = store.with(|c| pages::get(c, &id)).unwrap().content;
        assert!(content.contains("sorotan nomor 0") && content.contains("sorotan nomor 29"));
    }

    #[test]
    fn appending_tells_open_windows_about_the_new_content_and_a_trashed_note_is_replaced() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let send = |t: &str| handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), json!({ "mode": "selection", "url": "https://a.test/z", "text": t, "target": { "kind": "sticky" } })));
        let first = send("satu");
        assert!(first.synced.is_none());
        let id = first.reply.body["id"].as_str().unwrap().to_string();
        let second = send("dua");
        assert_eq!(second.synced.as_ref().map(|s| s.0.as_str()), Some(id.as_str()));
        assert!(second.synced.unwrap().1.contains("dua"));
        store.with(|c| pages::trash(c, &id)).unwrap();
        let third = send("tiga");
        assert_eq!(third.reply.body["created"], true);
        assert_ne!(third.reply.body["id"].as_str().unwrap(), id);
    }

    #[test]
    fn the_same_highlight_is_not_appended_twice() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let send = |t: &str| handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), json!({ "mode": "selection", "url": "https://a.test/x", "title": "X", "text": t })));
        let id = send("satu").reply.body["id"].as_str().unwrap().to_string();
        send("satu");
        send("dua");
        send("dua");
        let content = store.with(|c| pages::get(c, &id)).unwrap().content;
        let lines: Vec<String> = markdown::plain_text(&serde_json::from_str::<Value>(&content).unwrap()).lines().map(String::from).collect();
        assert_eq!(lines.iter().filter(|l| *l == "satu").count(), 1);
        assert_eq!(lines.iter().filter(|l| *l == "dua").count(), 1);
        // Susunan: sumber utama sekali di atas, isi sebagai teks biasa, tautan bagian di bawah tiap sorotan.
        let blocks = serde_json::from_str::<Value>(&content).unwrap()["content"].as_array().unwrap().clone();
        assert_eq!(blocks.iter().filter(|b| b["content"][0]["marks"][0]["attrs"]["class"] == "src").count(), 1);
        assert_eq!(blocks.iter().filter(|b| b["content"][0]["marks"][0]["attrs"]["class"] == "src-part").count(), 2);
        assert!(blocks.iter().all(|b| b["type"] != "blockquote"));
    }

    #[test]
    fn a_flood_of_clips_is_slowed_down() {
        let (store, bridge) = setup();
        let token = pair_now(&store, &bridge);
        let mut refused = 0;
        for i in 0..100 {
            let out = handle(&store, &bridge, &req("POST", "/bridge/clip", Some(&token), json!({ "mode": "link", "url": format!("https://a.test/{i}") })));
            if out.reply.status == 429 {
                refused += 1;
            }
        }
        assert_eq!(refused, 100 - RATE_LIMIT);
    }

    #[test]
    fn citation_markers_are_removed_from_selections() {
        assert_eq!(strip_citations("Spirit Airlines was[b] an American airline. It ceased on May 2, 2026.[2]"), "Spirit Airlines was an American airline. It ceased on May 2, 2026.");
        assert_eq!(strip_citations("fakta[2][3] dan lagi[2, 3] serta[4–6] lalu[citation needed]."), "fakta dan lagi serta lalu.");
        // Kurung yang bukan rujukan tetap.
        assert_eq!(strip_citations("array[index] dan [Catatan penting] serta [12345678901234]"), "array[index] dan [Catatan penting] serta [12345678901234]");
    }

    #[test]
    fn codes_are_six_digits_and_tokens_are_long() {
        for _ in 0..50 {
            let c = random_code();
            assert_eq!(c.len(), 6);
            assert!(c.chars().all(|x| x.is_ascii_digit()));
        }
        assert_eq!(random_hex(32).len(), 64);
    }
}
