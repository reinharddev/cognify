//! Server MCP (Model Context Protocol) untuk Cognify, lewat stdio: `cognify --mcp`.
//! Klien MCP apa pun (Claude, Codex, Cursor, dan lainnya) menjalankan perintah itu sebagai proses anak.
//!
//! Aturan keamanan:
//!   - Mati kecuali pengguna menyalakannya di Pengaturan (kunci `prefs`, `mcp.enabled`).
//!   - Hanya baca, kecuali `propose_page`, dan itu pun hanya bila `mcp.propose` menyala.
//!     `propose_page` menambahkan usulan; halaman baru dibuat saat pengguna menyetujuinya di app.
//!   - Tidak ada alat untuk mengubah, menghapus, atau menyetujui apa pun.
//!   - Hanya stdout yang membawa protokol; galat dan log tidak pernah bocor ke sana.

use std::io::{BufRead, Write};

use serde_json::{Value, json};

use crate::store::{Store, calendar, markdown, pages, proposals, settings};

const LATEST_PROTOCOL: &str = "2025-06-18";
const KNOWN_PROTOCOLS: [&str; 3] = ["2024-11-05", "2025-03-26", "2025-06-18"];
const MAX_READ_CHARS: usize = 60_000;
const MAX_LIST: usize = 500;

#[derive(Default)]
pub struct Session {
    client: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Access {
    enabled: bool,
    propose: bool,
}

fn access(store: &Store) -> Access {
    let raw = store.with(|c| settings::get(c, "prefs")).ok().flatten();
    let v: Value = raw.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or(Value::Null);
    let enabled = v["mcp"]["enabled"] == json!(true);
    Access { enabled, propose: enabled && v["mcp"]["propose"] == json!(true) }
}

fn tool_defs(a: Access) -> Vec<Value> {
    let read = json!({ "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false });
    let mut tools = vec![
        json!({
            "name": "search_pages",
            "description": "Cari halaman di Cognify menurut judul dan isi. Mengembalikan id, judul, dan cuplikan.",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string", "description": "Kata yang dicari" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 } }, "required": ["query"] },
            "annotations": read,
        }),
        json!({
            "name": "list_pages",
            "description": "Daftar halaman (id, induk, jenis, judul) menurut urutan pohon. Halaman di sampah tidak ikut.",
            "inputSchema": { "type": "object", "properties": {
                "parent_id": { "type": "string", "description": "Hanya turunan langsung halaman ini; kosongkan untuk semuanya" } } },
            "annotations": read,
        }),
        json!({
            "name": "read_page",
            "description": "Baca isi satu halaman sebagai teks polos beserta tag-nya. Papan dan tabel tidak punya isi teks.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] },
            "annotations": read,
        }),
        json!({
            "name": "list_tags",
            "description": "Semua tag beserta jumlah halaman aktif yang memakainya.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": read,
        }),
        json!({
            "name": "list_events",
            "description": "Acara kalender buatan pengguna (bukan langganan ICS) yang dimulai pada atau setelah tanggal tertentu. Pengulangan tidak diperluas; lihat field repeat.",
            "inputSchema": { "type": "object", "properties": {
                "from": { "type": "string", "description": "Tanggal awal, format YYYY-MM-DD. Bawaan: hari ini (UTC)" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 30 } } },
            "annotations": read,
        }),
    ];
    if a.propose {
        tools.push(json!({
            "name": "propose_page",
            "description": "Usulkan dokumen baru. Tidak ada yang langsung dibuat: usulan muncul di Cognify dan baru jadi halaman setelah pengguna menyetujuinya. Hanya gunakan atas permintaan pengguna.",
            "inputSchema": { "type": "object", "properties": {
                "title": { "type": "string", "maxLength": 300 },
                "content_markdown": { "type": "string", "description": "Isi dalam Markdown: judul, daftar, daftar centang, kutipan, kode" },
                "parent_id": { "type": "string", "description": "Opsional: id halaman induk" } }, "required": ["title", "content_markdown"] },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false },
        }));
    }
    tools
}

fn ok_text(text: String) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": false })
}

fn err_text(text: impl Into<String>) -> Value {
    json!({ "content": [{ "type": "text", "text": text.into() }], "isError": true })
}

fn json_text(v: &Value) -> Value {
    ok_text(serde_json::to_string_pretty(v).unwrap_or_default())
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(|v| v.as_str())
}

fn call_tool(store: &Store, session: &Session, name: &str, args: &Value) -> Value {
    let a = access(store);
    if !a.enabled {
        return err_text("MCP dimatikan. Pengguna perlu menyalakannya di Cognify: Pengaturan > MCP.");
    }
    let result: Result<Value, String> = store
        .with(|c| {
            Ok(match name {
                "search_pages" => {
                    let Some(q) = str_arg(args, "query") else { return Ok(Err("Parameter query wajib berupa teks.".into())) };
                    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10).clamp(1, 50) as usize;
                    let hits = pages::search(c, q, limit)?;
                    Ok(json!(hits.iter().map(|h| json!({ "id": h.id, "kind": h.kind, "title": h.title, "snippet": h.snippet })).collect::<Vec<_>>()))
                }
                "list_pages" => {
                    let parent = str_arg(args, "parent_id");
                    let all = pages::tree(c)?;
                    let list: Vec<Value> = all
                        .iter()
                        .filter(|n| parent.map_or(true, |p| n.parent_id.as_deref() == Some(p)))
                        .take(MAX_LIST)
                        .map(|n| json!({ "id": n.id, "parent_id": n.parent_id, "kind": n.kind, "title": n.title }))
                        .collect();
                    Ok(json!(list))
                }
                "read_page" => {
                    let Some(id) = str_arg(args, "id") else { return Ok(Err("Parameter id wajib berupa teks.".into())) };
                    let page = match pages::get(c, id) {
                        Ok(p) if p.trashed_at.is_none() => p,
                        Ok(_) | Err(crate::store::Error::NotFound(_)) => return Ok(Err(format!("Halaman tidak ditemukan: {id}"))),
                        Err(e) => return Err(e),
                    };
                    let text = if page.node.kind == "doc" {
                        serde_json::from_str::<Value>(&page.content).map(|d| markdown::plain_text(&d)).unwrap_or_else(|_| page.content.clone())
                    } else {
                        String::new()
                    };
                    let truncated = text.chars().count() > MAX_READ_CHARS;
                    let text: String = text.chars().take(MAX_READ_CHARS).collect();
                    Ok(json!({ "id": page.node.id, "kind": page.node.kind, "title": page.node.title, "tags": page.tags,
                               "updated_at": page.node.updated_at, "text": text, "truncated": truncated }))
                }
                "list_tags" => Ok(json!(pages::tag_counts(c)?.into_iter().map(|(t, n)| json!({ "tag": t, "pages": n })).collect::<Vec<_>>())),
                "list_events" => {
                    let from = str_arg(args, "from").map(str::to_string).unwrap_or_else(|| crate::store::now_iso()[..10].to_string());
                    if from.len() != 10 || from.chars().filter(|ch| *ch == '-').count() != 2 {
                        return Ok(Err("Parameter from harus berformat YYYY-MM-DD.".into()));
                    }
                    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(30).clamp(1, 100) as usize;
                    let events = calendar::event_list(c)?;
                    Ok(json!(events.iter().filter(|e| e.start.as_str() >= from.as_str() || e.repeat != "none").take(limit).collect::<Vec<_>>()))
                }
                "propose_page" if a.propose => {
                    let (Some(title), Some(body)) = (str_arg(args, "title"), str_arg(args, "content_markdown")) else {
                        return Ok(Err("Parameter title dan content_markdown wajib berupa teks.".into()));
                    };
                    let source = if session.client.is_empty() { "klien MCP".to_string() } else { session.client.clone() };
                    let input = proposals::ProposalInput {
                        title: title.into(),
                        body: body.into(),
                        parent_id: str_arg(args, "parent_id").map(str::to_string),
                        source: Some(source),
                    };
                    match proposals::propose(c, input) {
                        Ok(p) => Ok(json!({ "status": "menunggu_persetujuan", "proposal_id": p.id,
                            "note": "Usulan belum menjadi halaman. Minta pengguna membukanya di Cognify (Usulan) lalu menyetujuinya." })),
                        Err(crate::store::Error::Invalid(m)) => Err(m),
                        Err(e) => return Err(e),
                    }
                }
                "propose_page" => Err("Usulan dimatikan. Pengguna perlu mengizinkannya di Cognify: Pengaturan > MCP.".into()),
                _ => Err(format!("Alat tidak dikenal: {name}")),
            })
        })
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match result {
        Ok(v) => json_text(&v),
        Err(m) => err_text(m),
    }
}

fn reply(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Tangani satu pesan JSON-RPC. `None` untuk notifikasi (tanpa jawaban).
pub fn handle(store: &Store, session: &mut Session, msg: &Value) -> Option<Value> {
    let Some(method) = msg.get("method").and_then(|m| m.as_str()) else {
        // Jawaban dari klien atas permintaan kita; server ini tidak mengirim permintaan.
        return msg.get("id").filter(|_| msg.get("result").is_none() && msg.get("error").is_none()).map(|id| error(id, -32600, "Permintaan tidak sah"));
    };
    let id = msg.get("id")?; // tanpa id = notifikasi
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    Some(match method {
        "initialize" => {
            session.client = params["clientInfo"]["name"].as_str().unwrap_or("").chars().take(60).collect();
            let asked = params["protocolVersion"].as_str().unwrap_or("");
            let version = if KNOWN_PROTOCOLS.contains(&asked) { asked } else { LATEST_PROTOCOL };
            reply(id, json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "cognify", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Cognify menyimpan catatan pengguna di komputernya. Baca dengan search_pages, list_pages, read_page. propose_page hanya mengusulkan dokumen; pengguna yang menyetujuinya di app. Jangan mengusulkan apa pun tanpa diminta pengguna.",
            }))
        }
        "ping" => reply(id, json!({})),
        "tools/list" => reply(id, json!({ "tools": if access(store).enabled { tool_defs(access(store)) } else { vec![] } })),
        "tools/call" => match params.get("name").and_then(|n| n.as_str()) {
            Some(name) => reply(id, call_tool(store, session, name, params.get("arguments").unwrap_or(&Value::Null))),
            None => error(id, -32602, "Parameter name wajib"),
        },
        _ => error(id, -32601, "Metode tidak dikenal"),
    })
}

/// Baca pesan (satu JSON per baris) dari `input`, tulis jawaban ke `output`. Berhenti saat input habis.
pub fn serve(store: &Store, input: impl BufRead, mut output: impl Write) {
    let mut session = Session::default();
    for line in input.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(_)) => Some(error(&Value::Null, -32600, "Batch tidak didukung")),
            Ok(msg) => handle(store, &mut session, &msg),
            Err(_) => Some(error(&Value::Null, -32700, "JSON tidak sah")),
        };
        if let Some(r) = response {
            if writeln!(output, "{r}").and_then(|_| output.flush()).is_err() {
                break;
            }
        }
    }
}

/// Titik masuk `cognify --mcp`. Kode keluar: 0 normal, 1 bila penyimpanan tidak bisa dibuka.
pub fn run() -> i32 {
    let store = match crate::store::headless_data_dir().and_then(|dir| {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Store::open(&dir.join("workspace.db")).map_err(|e| e.to_string())
    }) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Cognify MCP: penyimpanan tidak bisa dibuka: {e}");
            return 1;
        }
    };
    serve(&store, std::io::stdin().lock(), std::io::stdout().lock());
    0
}

#[cfg(test)]
mod tests;
