//! Markdown sederhana → dokumen Tiptap (JSON) dan teks polos. Dipakai saat usulan dari AI disetujui:
//! AI menulis Markdown, editor menyimpan JSON Tiptap. Yang dikenali: judul `#`..`###`, paragraf,
//! daftar poin, daftar bernomor, daftar centang `- [ ]`/`- [x]`, kutipan `>`, blok kode ```, garis `---`,
//! dan tebal, miring, coret, serta kode sebaris. Selebihnya menjadi teks biasa.

use serde_json::{json, Value};

fn text_node(text: &str, marks: &[&str]) -> Value {
    if marks.is_empty() {
        json!({ "type": "text", "text": text })
    } else {
        json!({ "type": "text", "text": text, "marks": marks.iter().map(|m| json!({ "type": m })).collect::<Vec<_>>() })
    }
}

/// Teks sebaris: **tebal**, *miring* atau _miring_, ~~coret~~, `kode`.
fn inline(src: &str) -> Vec<Value> {
    let chars: Vec<char> = src.chars().collect();
    let mut out: Vec<Value> = Vec::new();
    let mut plain = String::new();
    let mut i = 0;
    let flush = |plain: &mut String, out: &mut Vec<Value>| {
        if !plain.is_empty() {
            out.push(text_node(plain, &[]));
            plain.clear();
        }
    };
    let find = |from: usize, pat: &[char]| -> Option<usize> {
        let mut j = from;
        while j + pat.len() <= chars.len() {
            if chars[j..j + pat.len()] == *pat {
                return Some(j);
            }
            j += 1;
        }
        None
    };
    while i < chars.len() {
        let rest = &chars[i..];
        let (open, mark): (&[char], &str) = if rest.starts_with(&['*', '*']) {
            (&['*', '*'], "bold")
        } else if rest.starts_with(&['~', '~']) {
            (&['~', '~'], "strike")
        } else if rest[0] == '`' {
            (&['`'], "code")
        } else if rest[0] == '*' {
            (&['*'], "italic")
        } else if rest[0] == '_' && (i == 0 || !chars[i - 1].is_alphanumeric()) {
            (&['_'], "italic")
        } else {
            plain.push(chars[i]);
            i += 1;
            continue;
        };
        let start = i + open.len();
        match find(start, open).filter(|&end| end > start) {
            Some(end) => {
                flush(&mut plain, &mut out);
                let inner: String = chars[start..end].iter().collect();
                if mark == "code" {
                    out.push(text_node(&inner, &["code"]));
                } else {
                    for mut n in inline(&inner) {
                        let mut marks = n.get("marks").and_then(|m| m.as_array()).cloned().unwrap_or_default();
                        marks.insert(0, json!({ "type": mark }));
                        n["marks"] = Value::Array(marks);
                        out.push(n);
                    }
                }
                i = end + open.len();
            }
            None => {
                plain.push(chars[i]);
                i += 1;
            }
        }
    }
    flush(&mut plain, &mut out);
    out
}

fn paragraph(text: &str) -> Value {
    let content = inline(text);
    if content.is_empty() { json!({ "type": "paragraph" }) } else { json!({ "type": "paragraph", "content": content }) }
}

enum ListKind {
    Bullet,
    Ordered,
    Task,
}

/// Penanda daftar di awal baris: (jenis, centang, sisa teks).
fn list_marker(line: &str) -> Option<(ListKind, bool, &str)> {
    let t = line.trim_start();
    for p in ["- ", "* ", "+ "] {
        if let Some(rest) = t.strip_prefix(p) {
            for (tag, checked) in [("[ ] ", false), ("[x] ", true), ("[X] ", true)] {
                if let Some(r) = rest.strip_prefix(tag) {
                    return Some((ListKind::Task, checked, r));
                }
            }
            return Some((ListKind::Bullet, false, rest));
        }
    }
    let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 && digits <= 3 {
        if let Some(rest) = t[digits..].strip_prefix(". ") {
            return Some((ListKind::Ordered, false, rest));
        }
    }
    None
}

pub fn to_doc(markdown: &str) -> Value {
    let lines: Vec<&str> = markdown.lines().collect();
    let mut blocks: Vec<Value> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let t = line.trim();
        if t.is_empty() {
            i += 1;
        } else if t.starts_with("```") {
            let mut code = Vec::new();
            i += 1;
            while i < lines.len() && !lines[i].trim().starts_with("```") {
                code.push(lines[i]);
                i += 1;
            }
            i += 1;
            let text = code.join("\n");
            blocks.push(if text.is_empty() { json!({ "type": "codeBlock" }) } else { json!({ "type": "codeBlock", "content": [{ "type": "text", "text": text }] }) });
        } else if t == "---" || t == "***" || t == "___" {
            blocks.push(json!({ "type": "horizontalRule" }));
            i += 1;
        } else if let Some(level) = (1..=3).find(|n| t.starts_with(&format!("{} ", "#".repeat(*n)))) {
            let text = t[level + 1..].trim();
            let content = inline(text);
            blocks.push(json!({ "type": "heading", "attrs": { "level": level }, "content": content }));
            i += 1;
        } else if t.starts_with('>') {
            let mut quote = Vec::new();
            while i < lines.len() && lines[i].trim().starts_with('>') {
                quote.push(lines[i].trim().trim_start_matches('>').trim());
                i += 1;
            }
            blocks.push(json!({ "type": "blockquote", "content": [paragraph(&quote.join(" "))] }));
        } else if let Some((kind, _, _)) = list_marker(line) {
            let mut items = Vec::new();
            while i < lines.len() {
                let Some((k, checked, text)) = list_marker(lines[i]) else { break };
                if std::mem::discriminant(&k) != std::mem::discriminant(&kind) {
                    break;
                }
                items.push(match k {
                    ListKind::Task => json!({ "type": "taskItem", "attrs": { "checked": checked }, "content": [paragraph(text.trim())] }),
                    _ => json!({ "type": "listItem", "content": [paragraph(text.trim())] }),
                });
                i += 1;
            }
            let ty = match kind {
                ListKind::Bullet => "bulletList",
                ListKind::Ordered => "orderedList",
                ListKind::Task => "taskList",
            };
            blocks.push(json!({ "type": ty, "content": items }));
        } else {
            let mut para = Vec::new();
            while i < lines.len() {
                let l = lines[i].trim();
                if l.is_empty() || l.starts_with("```") || l.starts_with('>') || l.starts_with('#') || list_marker(lines[i]).is_some() || l == "---" {
                    break;
                }
                para.push(l);
                i += 1;
            }
            blocks.push(paragraph(&para.join(" ")));
        }
    }
    if blocks.is_empty() {
        blocks.push(json!({ "type": "paragraph" }));
    }
    json!({ "type": "doc", "content": blocks })
}

/// Teks polos dokumen (untuk pencarian), blok dipisah baris baru. Sama bentuknya dengan `getText` Tiptap.
pub fn plain_text(doc: &Value) -> String {
    fn walk(node: &Value, out: &mut String) {
        if let Some(t) = node.get("text").and_then(|t| t.as_str()) {
            out.push_str(t);
        }
        if let Some(children) = node.get("content").and_then(|c| c.as_array()) {
            let block = node.get("type").and_then(|t| t.as_str()).map_or(false, |t| t != "text");
            for (i, c) in children.iter().enumerate() {
                if i > 0 && block && c.get("type").and_then(|t| t.as_str()) != Some("text") {
                    out.push('\n');
                }
                walk(c, out);
            }
        }
    }
    let mut out = String::new();
    walk(doc, &mut out);
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn types(doc: &Value) -> Vec<String> {
        doc["content"].as_array().unwrap().iter().map(|b| b["type"].as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn headings_paragraphs_and_lists() {
        let doc = to_doc("# Judul\n\nSatu baris\nlanjutan.\n\n- a\n- b\n\n1. x\n2. y\n\n- [ ] tugas\n- [x] selesai");
        assert_eq!(types(&doc), ["heading", "paragraph", "bulletList", "orderedList", "taskList"]);
        assert_eq!(doc["content"][0]["attrs"]["level"], 1);
        assert_eq!(doc["content"][1]["content"][0]["text"], "Satu baris lanjutan.");
        assert_eq!(doc["content"][2]["content"].as_array().unwrap().len(), 2);
        let tasks = doc["content"][4]["content"].as_array().unwrap();
        assert_eq!(tasks[0]["attrs"]["checked"], false);
        assert_eq!(tasks[1]["attrs"]["checked"], true);
    }

    #[test]
    fn inline_marks() {
        let doc = to_doc("a **tebal** dan *miring* serta `kode` ~~coret~~");
        let c = doc["content"][0]["content"].as_array().unwrap();
        let find = |t: &str| c.iter().find(|n| n["text"] == t).unwrap();
        assert_eq!(find("tebal")["marks"][0]["type"], "bold");
        assert_eq!(find("miring")["marks"][0]["type"], "italic");
        assert_eq!(find("kode")["marks"][0]["type"], "code");
        assert_eq!(find("coret")["marks"][0]["type"], "strike");
        assert_eq!(find("a ").get("marks"), None);
    }

    #[test]
    fn unmatched_markers_stay_text() {
        let doc = to_doc("2 * 3 = 6 dan snake_case_name");
        assert_eq!(plain_text(&doc), "2 * 3 = 6 dan snake_case_name");
    }

    #[test]
    fn code_quote_and_rule() {
        let doc = to_doc("> kutipan\n\n```\nlet x = 1;\n# bukan judul\n```\n\n---");
        assert_eq!(types(&doc), ["blockquote", "codeBlock", "horizontalRule"]);
        assert_eq!(doc["content"][1]["content"][0]["text"], "let x = 1;\n# bukan judul");
    }

    #[test]
    fn empty_input_gives_one_empty_paragraph_and_plain_text_matches() {
        assert_eq!(types(&to_doc("")), ["paragraph"]);
        let doc = to_doc("# A\n\nB\n\n- c\n- d");
        assert_eq!(plain_text(&doc), "A\nB\nc\nd");
    }

    #[test]
    fn html_is_kept_as_literal_text() {
        let doc = to_doc("<script>alert(1)</script>");
        assert_eq!(doc["content"][0]["content"][0]["text"], "<script>alert(1)</script>");
    }
}
