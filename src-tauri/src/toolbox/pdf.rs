//! PDF merge/split on lopdf (MIT, pure Rust, runs in-process).
//!
//! Known limits: encrypted PDFs are rejected (an unlock tool comes later) and
//! merging drops bookmarks (outlines), because they would point at objects
//! from separate documents.

use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

use lopdf::{dictionary, Document, Object, ObjectId};
use serde::{Deserialize, Serialize};

use crate::toolbox::fsutil;

/// Page attributes a page may inherit from its parent `Pages` node. When pages
/// from different documents end up under one new `Pages` node they must carry
/// these themselves, or a page silently picks up another file's MediaBox.
const INHERITABLE: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

pub(crate) fn load(path: &Path) -> Result<Document, String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("?");
    let doc = Document::load(path).map_err(|e| format!("{name}: tidak bisa dibaca ({e})"))?;
    if doc.is_encrypted() {
        return Err(format!("{name}: PDF ini terkunci dengan password, belum didukung."));
    }
    Ok(doc)
}

fn inline_inherited(doc: &mut Document, page_id: ObjectId) {
    let mut found: Vec<(&[u8], Object)> = Vec::new();
    for key in INHERITABLE {
        let mut current = page_id;
        for _ in 0..64 {
            let Ok(dict) = doc.get_dictionary(current) else { break };
            if let Ok(value) = dict.get(key) {
                found.push((key, value.clone()));
                break;
            }
            match dict.get(b"Parent").and_then(Object::as_reference) {
                Ok(parent) => current = parent,
                Err(_) => break,
            }
        }
    }
    if let Ok(page) = doc.get_object_mut(page_id).and_then(Object::as_dict_mut) {
        for (key, value) in found {
            if !page.has(key) {
                page.set(key, value);
            }
        }
    }
}

pub fn page_count(path: &Path) -> Result<u32, String> {
    Ok(load(path)?.get_pages().len() as u32)
}

/// Concatenates `inputs` in order into `output`. Returns the page count.
pub fn merge(inputs: &[PathBuf], output: &Path) -> Result<u32, String> {
    let mut merged = Document::with_version("1.5");
    let mut next_id = 1;
    let mut pages: Vec<(ObjectId, Object)> = Vec::new(); // kept in reading order
    let mut catalog: Option<Object> = None;

    for path in inputs {
        let mut doc = load(path)?;
        let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
        for id in &page_ids {
            inline_inherited(&mut doc, *id);
        }
        doc.renumber_objects_with(next_id);
        next_id = doc.max_id + 1;

        // renumbering moved the pages too, so look them up again
        for id in doc.get_pages().into_values() {
            let object = doc.get_object(id).map_err(|e| e.to_string())?.clone();
            pages.push((id, object));
        }
        for (id, object) in doc.objects {
            match object.type_name().unwrap_or(b"") {
                b"Catalog" => {
                    catalog.get_or_insert(object);
                }
                // old page tree and its pages are rebuilt below
                b"Pages" | b"Page" => {}
                _ => {
                    merged.objects.insert(id, object);
                }
            }
        }
    }

    let catalog = catalog.ok_or("Tidak ada katalog PDF yang valid")?;
    let pages_id = (next_id, 0);
    let page_count = pages.len() as u32;

    let mut kids: Vec<Object> = Vec::with_capacity(pages.len());
    for (id, object) in pages {
        let mut dict = object.as_dict().map_err(|e| e.to_string())?.clone();
        dict.set("Parent", pages_id);
        merged.objects.insert(id, Object::Dictionary(dict));
        kids.push(Object::Reference(id));
    }
    merged.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => page_count as i64,
        }),
    );

    let mut catalog_dict = catalog.as_dict().map_err(|e| e.to_string())?.clone();
    catalog_dict.set("Pages", pages_id);
    catalog_dict.remove(b"Outlines");
    catalog_dict.remove(b"Names");
    catalog_dict.remove(b"Dests");
    catalog_dict.remove(b"AcroForm");
    let catalog_id = (next_id + 1, 0);
    merged.objects.insert(catalog_id, Object::Dictionary(catalog_dict));
    merged.trailer.set("Root", catalog_id);
    merged.max_id = next_id + 1;

    merged.prune_objects();
    merged.renumber_objects();
    merged.compress();
    merged.save(output).map_err(|e| format!("Gagal menyimpan: {e}"))?;
    Ok(page_count)
}

/// Parses "1-3, 5, 8-" into inclusive ranges, validated against `total`.
/// An open end ("8-") runs to the last page, an open start ("-3") from page 1.
pub fn parse_ranges(spec: &str, total: u32) -> Result<Vec<(u32, u32)>, String> {
    let mut ranges = Vec::new();
    for part in spec.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        let bad = || format!("Rentang tidak valid: \"{part}\"");
        let num = |s: &str| s.trim().parse::<u32>().map_err(|_| bad());

        let (from, to) = match part.split_once('-') {
            None => {
                let n = num(part)?;
                (n, n)
            }
            Some((a, b)) => (
                if a.trim().is_empty() { 1 } else { num(a)? },
                if b.trim().is_empty() { total } else { num(b)? },
            ),
        };
        if from < 1 || from > to || to > total {
            return Err(format!("\"{part}\" di luar jangkauan (PDF ini punya {total} halaman)"));
        }
        ranges.push((from, to));
    }
    if ranges.is_empty() {
        return Err("Isi halaman yang ingin diambil, misalnya 1-3, 5".into());
    }
    Ok(ranges)
}

fn label(from: u32, to: u32) -> String {
    if from == to { format!("p{from}") } else { format!("p{from}-{to}") }
}

fn extract(input: &Path, keep: &BTreeSet<u32>, output: &Path) -> Result<(), String> {
    let mut doc = load(input)?;
    let drop: Vec<u32> = doc.get_pages().keys().copied().filter(|p| !keep.contains(p)).collect();
    doc.delete_pages(&drop);
    doc.prune_objects();
    doc.renumber_objects();
    doc.compress();
    doc.save(output).map_err(|e| format!("Gagal menyimpan: {e}"))?;
    Ok(())
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SplitMode {
    /// All selected pages go into one new PDF, in their original order.
    Single,
    /// One new PDF per range.
    PerRange,
}

/// Returns the files written.
pub fn split(
    input: &Path,
    out_dir: Option<&str>,
    spec: &str,
    mode: SplitMode,
) -> Result<Vec<PathBuf>, String> {
    let total = page_count(input)?;
    let ranges = parse_ranges(spec, total)?;
    let dir = fsutil::output_dir(input, out_dir);
    let stem = fsutil::stem_of(input);

    let groups: Vec<Vec<(u32, u32)>> = match mode {
        SplitMode::Single => vec![ranges],
        SplitMode::PerRange => ranges.into_iter().map(|r| vec![r]).collect(),
    };

    let mut written = Vec::new();
    for group in groups {
        let keep: BTreeSet<u32> = group.iter().flat_map(|&(a, b)| a..=b).collect();
        let tag = group.iter().map(|&(a, b)| label(a, b)).collect::<Vec<_>>().join("_");
        let output = fsutil::unique_path(&dir, &format!("{stem}_{tag}"), "pdf");
        extract(input, &keep, &output)?;
        written.push(output);
    }
    Ok(written)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequest {
    pub inputs: Vec<String>,
    pub out_dir: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitRequest {
    pub input: String,
    pub out_dir: Option<String>,
    pub ranges: String,
    pub mode: SplitMode,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub output: String,
    pub pages: u32,
}

fn check_out_dir(dir: &Option<String>) -> Result<(), String> {
    match dir {
        Some(d) if !Path::new(d).is_dir() => Err(format!("Folder tujuan tidak ada: {d}")),
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn pdf_info(path: String) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || page_count(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pdf_merge(req: MergeRequest) -> Result<MergeResult, String> {
    if req.inputs.len() < 2 {
        return Err("Pilih minimal 2 PDF".into());
    }
    check_out_dir(&req.out_dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        let inputs: Vec<PathBuf> = req.inputs.iter().map(PathBuf::from).collect();
        let first = &inputs[0];
        let dir = fsutil::output_dir(first, req.out_dir.as_deref());
        let output = fsutil::unique_path(&dir, &format!("{}_merged", fsutil::stem_of(first)), "pdf");
        let pages = merge(&inputs, &output)?;
        Ok(MergeResult { output: output.to_string_lossy().into_owned(), pages })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pdf_split(req: SplitRequest) -> Result<Vec<String>, String> {
    check_out_dir(&req.out_dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        let files = split(Path::new(&req.input), req.out_dir.as_deref(), &req.ranges, req.mode)?;
        Ok(files.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::Stream;

    /// Builds a PDF where Resources and MediaBox live only on the Pages node,
    /// so merging has to cope with inherited attributes.
    fn make_pdf(dir: &Path, name: &str, labels: &[&str], width: i64) -> PathBuf {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        });
        let resources_id = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font_id } });

        let mut kids: Vec<Object> = Vec::new();
        for label in labels {
            let content = Content {
                operations: vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec!["F1".into(), 24.into()]),
                    Operation::new("Td", vec![100.into(), 600.into()]),
                    Operation::new("Tj", vec![Object::string_literal(*label)]),
                    Operation::new("ET", vec![]),
                ],
            };
            let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
            let page_id = doc.add_object(dictionary! {
                "Type" => "Page", "Parent" => pages_id, "Contents" => content_id,
            });
            kids.push(page_id.into());
        }
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => kids,
                "Count" => labels.len() as i64,
                "Resources" => resources_id,
                "MediaBox" => vec![0.into(), 0.into(), width.into(), 800.into()],
            }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);

        let path = dir.join(name);
        doc.save(&path).unwrap();
        path
    }

    fn workdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("toolbox-pdf-test-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn texts(path: &Path) -> Vec<String> {
        let doc = Document::load(path).unwrap();
        let mut out = Vec::new();
        for (n, _) in doc.get_pages() {
            out.push(doc.extract_text(&[n]).unwrap().trim().to_string());
        }
        out
    }

    fn media_width(path: &Path, page: u32) -> f64 {
        let doc = Document::load(path).unwrap();
        let id = doc.get_pages()[&page];
        let dict = doc.get_dictionary(id).unwrap();
        dict.get(b"MediaBox").unwrap().as_array().unwrap()[2].as_float().unwrap() as f64
    }

    #[test]
    fn ranges_parse() {
        assert_eq!(parse_ranges("1-3, 5, 8-", 10).unwrap(), vec![(1, 3), (5, 5), (8, 10)]);
        assert_eq!(parse_ranges("-2", 5).unwrap(), vec![(1, 2)]);
        assert!(parse_ranges("0", 5).is_err());
        assert!(parse_ranges("3-2", 5).is_err());
        assert!(parse_ranges("2-9", 5).is_err());
        assert!(parse_ranges("abc", 5).is_err());
        assert!(parse_ranges("  ", 5).is_err());
    }

    #[test]
    fn merge_keeps_order_and_each_files_page_size() {
        let dir = workdir("merge");
        let a = make_pdf(&dir, "a.pdf", &["A1", "A2", "A3"], 400);
        let b = make_pdf(&dir, "b.pdf", &["B1", "B2"], 600);
        let out = dir.join("out.pdf");

        assert_eq!(merge(&[a, b], &out).unwrap(), 5);
        assert_eq!(texts(&out), ["A1", "A2", "A3", "B1", "B2"]);
        // page size came from each source's own Pages node, not the first file's
        assert_eq!(media_width(&out, 1), 400.0);
        assert_eq!(media_width(&out, 4), 600.0);
    }

    #[test]
    fn split_single_and_per_range() {
        let dir = workdir("split");
        let src = make_pdf(&dir, "src.pdf", &["P1", "P2", "P3", "P4", "P5"], 400);

        let single = split(&src, None, "1-2, 5", SplitMode::Single).unwrap();
        assert_eq!(single.len(), 1);
        assert_eq!(texts(&single[0]), ["P1", "P2", "P5"]);

        let each = split(&src, None, "2, 4-5", SplitMode::PerRange).unwrap();
        assert_eq!(each.len(), 2);
        assert_eq!(texts(&each[0]), ["P2"]);
        assert_eq!(texts(&each[1]), ["P4", "P5"]);

        // running again must not overwrite earlier results
        let again = split(&src, None, "2", SplitMode::PerRange).unwrap();
        assert_ne!(again[0], each[0]);
    }

    /// Real-world smoke test. Skipped unless asked for:
    ///   TOOLBOX_SAMPLE_PDFS=a.pdf:b.pdf TOOLBOX_OUT=/some/dir cargo test real_world -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_world_merge_and_split() {
        let (Ok(samples), Ok(out)) = (std::env::var("TOOLBOX_SAMPLE_PDFS"), std::env::var("TOOLBOX_OUT")) else {
            panic!("set TOOLBOX_SAMPLE_PDFS (colon separated) and TOOLBOX_OUT");
        };
        let inputs: Vec<PathBuf> = samples.split(':').map(PathBuf::from).collect();
        let out = PathBuf::from(out);

        let total: u32 = inputs.iter().map(|p| page_count(p).unwrap()).sum();
        let merged = out.join("merged.pdf");
        let pages = merge(&inputs, &merged).unwrap();
        println!("merged {} files -> {pages} pages (expected {total})", inputs.len());
        assert_eq!(pages, total);
        assert_eq!(page_count(&merged).unwrap(), total);

        let parts = split(&merged, Some(out.to_str().unwrap()), "1-2", SplitMode::Single).unwrap();
        println!("split -> {:?} ({} pages)", parts[0], page_count(&parts[0]).unwrap());
        assert_eq!(page_count(&parts[0]).unwrap(), 2.min(total));
    }

    #[test]
    fn missing_file_is_a_clean_error() {
        let err = page_count(Path::new("/definitely/not/here.pdf")).unwrap_err();
        assert!(err.contains("here.pdf"));
    }
}
