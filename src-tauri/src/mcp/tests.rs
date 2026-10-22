use super::*;

fn store(enabled: bool, propose: bool) -> Store {
    let s = Store::open_in_memory().unwrap();
    s.with(|c| settings::set(c, "prefs", &json!({ "mcp": { "enabled": enabled, "propose": propose } }).to_string())).unwrap();
    s
}

fn call(s: &Store, session: &mut Session, method: &str, params: Value) -> Value {
    handle(s, session, &json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })).unwrap()
}

fn tool(s: &Store, session: &mut Session, name: &str, args: Value) -> Value {
    call(s, session, "tools/call", json!({ "name": name, "arguments": args }))["result"].clone()
}

fn text(r: &Value) -> String {
    r["content"][0]["text"].as_str().unwrap().to_string()
}

fn seed(s: &Store) -> String {
    s.with(|c| {
        let doc = markdown::to_doc("# Gaya\n\nF = m a");
        let p = pages::create(c, pages::NewPage { kind: "doc".into(), title: Some("Fisika".into()), content: Some(doc.to_string()), plain_text: Some(markdown::plain_text(&doc)), ..Default::default() })?;
        pages::update(c, &p.node.id, pages::PageUpdate { tags: Some(vec!["sekolah".into()]), ..Default::default() })?;
        Ok(p.node.id)
    })
    .unwrap()
}

#[test]
fn initialize_negotiates_the_protocol_and_remembers_the_client() {
    let s = store(true, false);
    let mut se = Session::default();
    let r = call(&s, &mut se, "initialize", json!({ "protocolVersion": "2025-03-26", "clientInfo": { "name": "claude-code" } }));
    assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(r["result"]["serverInfo"]["name"], "cognify");
    assert_eq!(se.client, "claude-code");
    let r = call(&s, &mut se, "initialize", json!({ "protocolVersion": "1999-01-01" }));
    assert_eq!(r["result"]["protocolVersion"], LATEST_PROTOCOL);
}

#[test]
fn notifications_get_no_reply_and_unknown_methods_get_an_error() {
    let s = store(true, false);
    let mut se = Session::default();
    assert!(handle(&s, &mut se, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
    let r = call(&s, &mut se, "resources/list", json!({}));
    assert_eq!(r["error"]["code"], -32601);
    assert_eq!(call(&s, &mut se, "ping", json!({}))["result"], json!({}));
}

#[test]
fn everything_is_off_by_default() {
    let s = Store::open_in_memory().unwrap();
    let mut se = Session::default();
    assert_eq!(call(&s, &mut se, "tools/list", json!({}))["result"]["tools"], json!([]));
    let r = tool(&s, &mut se, "list_pages", json!({}));
    assert_eq!(r["isError"], true);
    assert!(text(&r).contains("dimatikan"));
    let off = store(false, true);
    assert_eq!(call(&off, &mut se, "tools/list", json!({}))["result"]["tools"], json!([]));
}

#[test]
fn read_only_mode_lists_only_read_tools_and_refuses_proposals() {
    let s = store(true, false);
    let mut se = Session::default();
    let names: Vec<String> = call(&s, &mut se, "tools/list", json!({}))["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
    assert_eq!(names, ["search_pages", "list_pages", "read_page", "list_tags", "list_events"]);
    let r = tool(&s, &mut se, "propose_page", json!({ "title": "x", "content_markdown": "y" }));
    assert_eq!(r["isError"], true);
    assert!(s.with(|c| proposals::count_pending(c)).unwrap() == 0);
}

#[test]
fn reading_works_and_hides_the_trash() {
    let s = store(true, false);
    let id = seed(&s);
    let mut se = Session::default();
    let hits: Value = serde_json::from_str(&text(&tool(&s, &mut se, "search_pages", json!({ "query": "gaya" })))).unwrap();
    assert_eq!(hits[0]["id"], id.as_str());
    let page: Value = serde_json::from_str(&text(&tool(&s, &mut se, "read_page", json!({ "id": id })))).unwrap();
    assert_eq!(page["text"], "Gaya\nF = m a");
    assert_eq!(page["tags"], json!(["sekolah"]));
    let tags: Value = serde_json::from_str(&text(&tool(&s, &mut se, "list_tags", json!({})))).unwrap();
    assert_eq!(tags[0]["tag"], "sekolah");
    s.with(|c| pages::trash(c, &id)).unwrap();
    assert_eq!(tool(&s, &mut se, "read_page", json!({ "id": id }))["isError"], true);
    assert_eq!(text(&tool(&s, &mut se, "list_pages", json!({}))).trim(), "[]");
}

#[test]
fn proposing_queues_a_proposal_and_creates_no_page() {
    let s = store(true, true);
    let mut se = Session::default();
    call(&s, &mut se, "initialize", json!({ "clientInfo": { "name": "codex" } }));
    assert!(call(&s, &mut se, "tools/list", json!({}))["result"]["tools"].as_array().unwrap().iter().any(|t| t["name"] == "propose_page"));
    let r = tool(&s, &mut se, "propose_page", json!({ "title": "Ringkasan bab 3", "content_markdown": "# Bab 3\n\n- poin" }));
    assert_eq!(r["isError"], false);
    assert!(text(&r).contains("menunggu_persetujuan"));
    s.with(|c| {
        assert!(pages::tree(c)?.is_empty());
        let pending = proposals::list_pending(c)?;
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].source, "codex");
        Ok(())
    })
    .unwrap();
}

#[test]
fn bad_arguments_and_unknown_tools_are_reported_as_tool_errors() {
    let s = store(true, true);
    let mut se = Session::default();
    assert_eq!(tool(&s, &mut se, "search_pages", json!({}))["isError"], true);
    assert_eq!(tool(&s, &mut se, "read_page", json!({ "id": 5 }))["isError"], true);
    assert_eq!(tool(&s, &mut se, "propose_page", json!({ "title": "  ", "content_markdown": "x" }))["isError"], true);
    assert_eq!(tool(&s, &mut se, "delete_page", json!({ "id": "x" }))["isError"], true);
    assert_eq!(tool(&s, &mut se, "list_events", json!({ "from": "kemarin" }))["isError"], true);
    assert_eq!(call(&s, &mut se, "tools/call", json!({}))["error"]["code"], -32602);
}

#[test]
fn serve_speaks_one_json_message_per_line_and_survives_garbage() {
    let s = store(true, false);
    let input = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n\nbukan json\n[]\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}\n";
    let mut out = Vec::new();
    serve(&s, input.as_bytes(), &mut out);
    let lines: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines.len(), 4);
    assert_eq!(lines[0]["id"], 1);
    assert_eq!(lines[1]["error"]["code"], -32700);
    assert_eq!(lines[2]["error"]["code"], -32600);
    assert_eq!(lines[3]["id"], 2);
}
