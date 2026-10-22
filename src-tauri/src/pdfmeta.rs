//! Metadata dan nomor halaman dari berkas PDF yang dibuka di browser, untuk sitasi. Dibaca dengan `lopdf`, seluruhnya di
//! komputer ini: ekstensi mengirim berkas ke app lokal, app tidak menyimpannya dan tidak menghubungi internet.
//! Yang dibaca: kamus Info, XMP, DOI di halaman awal, dan halaman tempat teks yang disorot berada. Kolom yang hanya
//! disimpulkan (judul dari nama berkas, nama penulis dipecah, tanggal dari tanggal pembuatan berkas) ditandai di `_guess`.

use lopdf::{Dictionary, Document, Object};
use serde_json::{json, Map, Value};

const MAX_PAGES_SCANNED: u32 = 500;
const MAX_PAGE_BYTES: usize = 8 * 1024 * 1024;

pub struct PdfInfo {
    pub source: Value,
    pub pages: u32,
    /// Halaman (nomor urut di berkas, mulai 1) tempat teks yang disorot ditemukan.
    pub page: Option<u32>,
}

/// PDFDocEncoding (dianggap Latin-1) atau UTF-16BE dengan BOM.
fn decode_text(raw: &[u8]) -> String {
    if raw.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = raw[2..].chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        return String::from_utf16_lossy(&units);
    }
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&raw[3..]).into_owned();
    }
    raw.iter().map(|&b| b as char).collect()
}

fn clean(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn info_dict(doc: &Document) -> Option<&Dictionary> {
    let (_, info) = doc.dereference(doc.trailer.get(b"Info").ok()?).ok()?;
    info.as_dict().ok()
}

fn info_str(doc: &Document, dict: &Dictionary, key: &[u8]) -> String {
    dict.get(key)
        .ok()
        .and_then(|o| doc.dereference(o).ok())
        .and_then(|(_, o)| o.as_str().ok().map(decode_text))
        .map(|s| clean(&s))
        .unwrap_or_default()
}

fn xmp_text(doc: &Document) -> String {
    let Ok(catalog) = doc.catalog() else { return String::new() };
    let Ok(meta) = catalog.get(b"Metadata") else { return String::new() };
    let Ok((_, obj)) = doc.dereference(meta) else { return String::new() };
    let Object::Stream(stream) = obj else { return String::new() };
    let bytes = stream.decompressed_content().unwrap_or_else(|_| stream.content.clone());
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Isi pertama sebuah elemen XMP, mis. `<dc:title>…<rdf:li …>Judul</rdf:li>…</dc:title>` atau `<prism:doi>…</prism:doi>`.
fn xmp_value(xmp: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let Some(start) = xmp.find(&open) else { return String::new() };
    let rest = &xmp[start..];
    let close = format!("</{tag}>");
    let end = rest.find(&close).unwrap_or(rest.len());
    let block = &rest[..end];
    let inner = match block.find("<rdf:li") {
        Some(li) => {
            let after = &block[li..];
            after.find('>').map(|g| &after[g + 1..]).unwrap_or("")
        }
        None => block.find('>').map(|g| &block[g + 1..]).unwrap_or(""),
    };
    let text = inner.split('<').next().unwrap_or("");
    clean(&text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'"))
}

/// DOI pertama dalam teks (`10.NNNN/…`), tanpa tanda baca di ujungnya.
pub fn find_doi(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while let Some(pos) = text[i..].find("10.") {
        let start = i + pos;
        i = start + 3;
        if start > 0 && bytes[start - 1].is_ascii_alphanumeric() {
            continue;
        }
        let digits = text[start + 3..].chars().take_while(|c| c.is_ascii_digit()).count();
        if !(4..=9).contains(&digits) {
            continue;
        }
        let after = start + 3 + digits;
        if bytes.get(after) != Some(&b'/') {
            continue;
        }
        let tail: String = text[after + 1..].chars().take_while(|c| !c.is_whitespace() && !matches!(c, '"' | '<' | '>' | '\'')).collect();
        let tail = tail.trim_end_matches(['.', ',', ';', ')', ']', ':']);
        if tail.is_empty() {
            continue;
        }
        return Some(format!("{}/{}", &text[start..after], tail));
    }
    None
}

fn looks_like_filename(t: &str) -> bool {
    let l = t.to_lowercase();
    const EXT: [&str; 8] = [".pdf", ".doc", ".docx", ".tex", ".ppt", ".pptx", ".odt", ".indd"];
    EXT.iter().any(|e| l.ends_with(e)) || (!t.contains(char::is_whitespace) && t.contains('_')) || t.chars().all(|c| c.is_ascii_digit() || c == '-' || c == '_' || c == '.')
}

/// Judul yang masuk akal: bukan nama berkas atau judul bawaan aplikasi pembuat dokumen.
pub fn sane_title(t: &str) -> bool {
    let t = t.trim();
    let l = t.to_lowercase();
    t.chars().count() >= 4
        && t.chars().count() <= 300
        && !["microsoft word", "microsoft powerpoint", "untitled", "document", "dokumen", "powerpoint presentation", "slide", "scan", "image", "new document", "title", "judul"]
            .iter()
            .any(|p| l == *p || l.starts_with(&format!("{p} -")) || l.starts_with(&format!("{p}1")))
        && !looks_like_filename(t)
}

fn sane_author(a: &str) -> bool {
    let l = a.trim().to_lowercase();
    !l.is_empty()
        && !["admin", "administrator", "user", "windows user", "microsoft office user", "unknown", "author", "owner", "pc", "laptop", "anonymous", "(anonymous)", "default", "root", "guest", "usuario", "pengguna"]
            .iter()
            .any(|j| l == *j)
        && !l.ends_with(".pdf")
}

/// Satu nama: "Keluarga, Depan" bila ada koma; "Depan Keluarga" (tebakan gaya Barat) untuk 2-4 kata huruf; selain itu utuh.
fn parse_name(full: &str) -> Value {
    let n = clean(full);
    let parts: Vec<&str> = n.split(',').map(str::trim).collect();
    if parts.len() == 2 && is_last_first(&parts) {
        return json!({ "family": parts[0], "given": parts[1] });
    }
    let words: Vec<&str> = n.split(' ').collect();
    if (2..=4).contains(&words.len()) && n.chars().all(|c| c.is_alphabetic() || c == ' ' || c == '.' || c == '\'' || c == '-') {
        return json!({ "family": words[words.len() - 1], "given": words[..words.len() - 1].join(" "), "_guess": true });
    }
    json!({ "literal": n })
}

/// "Keluarga, Depan": yang sebelum koma satu kata, atau yang sesudahnya hanya inisial ("Smith, J. K."). "A B, C D" justru dua nama.
fn is_last_first(parts: &[&str]) -> bool {
    parts.len() == 2
        && !parts[1].is_empty()
        && parts[1].split(' ').count() <= 3
        && (parts[0].split(' ').count() == 1 || parts[1].split(' ').all(|w| w.trim_end_matches('.').chars().count() <= 1))
}

/// Daftar penulis dari satu string: dipisah `;`, " and ", "&", atau baris baru; koma tunggal dianggap "Keluarga, Depan".
pub fn parse_authors(raw: &str) -> Vec<Value> {
    let raw = raw.replace(" and ", ";").replace(" dan ", ";").replace(" & ", ";").replace('\n', ";");
    let comma_parts: Vec<&str> = raw.split(',').map(str::trim).collect();
    let chunks: Vec<String> = if raw.contains(';') {
        raw.split(';').map(clean).collect()
    } else if raw.matches(',').count() >= 2 || (comma_parts.len() == 2 && !is_last_first(&comma_parts)) {
        raw.split(',').map(clean).collect()
    } else {
        vec![clean(&raw)]
    };
    chunks.into_iter().filter(|c| sane_author(c)).map(|c| parse_name(&c)).collect()
}

/// "D:20260821103000+07'00'" menjadi (tahun, bulan, hari).
fn pdf_date(raw: &str) -> Option<(i64, i64, i64)> {
    let d = raw.trim().strip_prefix("D:").unwrap_or(raw.trim());
    let num = |a: usize, b: usize| d.get(a..b).and_then(|s| s.parse::<i64>().ok());
    let y = num(0, 4)?;
    (1900..=2100).contains(&y).then_some(())?;
    Some((y, num(4, 6).filter(|m| (1..=12).contains(m)).unwrap_or(0), num(6, 8).filter(|d| (1..=31).contains(d)).unwrap_or(0)))
}

fn normalize(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn prettify_filename(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or("");
    let name = path.rsplit('/').next().unwrap_or("");
    let name = name.strip_suffix(".pdf").or_else(|| name.strip_suffix(".PDF")).unwrap_or(name);
    let mut out = String::new();
    let bytes = name.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() + 0 && let Ok(b) = u8::from_str_radix(&name[i + 1..i + 3], 16) {
            out.push(b as char);
            i += 3;
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    clean(&out.replace(['_', '-', '+'], " "))
}

/// Potongan teks halaman pertama beserta ukuran hurufnya (ukuran Tf dikali skala Tm). Dipakai menebak judul: judul adalah
/// teks terbesar di halaman pertama. Urutannya mengikuti urutan di berkas.
fn first_page_runs(doc: &Document) -> Vec<(f64, String)> {
    let Some((_, &page_id)) = doc.get_pages().iter().next() else { return Vec::new() };
    let Ok(fonts) = doc.get_page_fonts(page_id) else { return Vec::new() };
    let encodings: std::collections::BTreeMap<Vec<u8>, lopdf::Encoding> =
        fonts.into_iter().filter_map(|(name, font)| font.get_font_encoding_with_limit(doc, MAX_PAGE_BYTES).ok().map(|e| (name, e))).collect();
    let Ok(data) = doc.get_page_content_with_limit(page_id, MAX_PAGE_BYTES) else { return Vec::new() };
    let Ok(content) = lopdf::content::Content::decode(&data) else { return Vec::new() };
    let num = |o: &Object| o.as_float().map(f64::from).or_else(|_| o.as_i64().map(|i| i as f64)).ok();
    let mut runs: Vec<(f64, String)> = Vec::new();
    let (mut size, mut scale, mut enc): (f64, f64, Option<&lopdf::Encoding>) = (0.0, 1.0, None);
    for op in &content.operations {
        match op.operator.as_str() {
            "BT" => scale = 1.0,
            "Tf" => {
                enc = op.operands.first().and_then(|o| o.as_name().ok()).and_then(|n| encodings.get(n));
                size = op.operands.get(1).and_then(num).unwrap_or(size);
            }
            "Tm" => scale = op.operands.get(3).and_then(num).map(f64::abs).filter(|d| *d > 0.0).unwrap_or(scale),
            "Tj" | "TJ" | "'" | "\"" => {
                let Some(e) = enc else { continue };
                let mut text = String::new();
                let push = |text: &mut String, o: &Object| {
                    if let Object::String(bytes, _) = o {
                        if let Ok(t) = Document::decode_text(e, bytes) {
                            text.push_str(&t);
                        }
                    }
                };
                for operand in &op.operands {
                    match operand {
                        // Dalam TJ, selisih posisi besar (negatif, per seribu em) di antara potongan berarti spasi.
                        Object::Array(items) => {
                            for item in items {
                                match item {
                                    Object::String(..) => push(&mut text, item),
                                    other => {
                                        if num(other).is_some_and(|n| n < -200.0) {
                                            text.push(' ');
                                        }
                                    }
                                }
                            }
                        }
                        other => push(&mut text, other),
                    }
                }
                let text = clean(&text);
                if !text.is_empty() {
                    runs.push(((size * scale * 10.0).round() / 10.0, text));
                }
            }
            _ => {}
        }
    }
    runs
}

/// Judul = teks terbesar di halaman pertama (potongan berurutan dengan ukuran yang sama digabung). None bila tidak meyakinkan.
fn guess_title(runs: &[(f64, String)]) -> Option<String> {
    // Cap arXiv di tepi halaman berhuruf besar dan bukan bagian judul; judul ada di awal isi halaman.
    let owned: Vec<(f64, String)> = runs.iter().filter(|(_, t)| !t.starts_with("arXiv:") && !t.contains('@')).take(80).cloned().collect();
    let runs = owned.as_slice();
    let max = runs.iter().filter(|(_, t)| t.chars().filter(|c| c.is_alphabetic()).count() >= 3).map(|(s, _)| *s).fold(0.0, f64::max);
    if max <= 0.0 {
        return None;
    }
    let start = runs.iter().position(|(s, t)| (*s - max).abs() < 0.06 * max && t.chars().any(|c| c.is_alphabetic()))?;
    let mut title = String::new();
    for (s, t) in &runs[start..] {
        if (*s - max).abs() >= 0.06 * max {
            if title.is_empty() { continue } else { break }
        }
        if !title.is_empty() {
            title.push(' ');
        }
        title.push_str(t);
        if title.chars().count() > 300 {
            return None;
        }
    }
    let title = clean(&title);
    let words = title.split(' ').count();
    let letters = title.chars().filter(|c| c.is_alphabetic()).count();
    (words >= 2 && letters * 2 >= title.chars().count() && !title.contains("http") && sane_title(&title)).then_some(title)
}

/// Cap arXiv di tepi halaman pertama: `arXiv:1706.03762v7 [cs.CL] 2 Aug 2023` memberi nomor, kategori, dan tanggal terbit versi itu.
fn arxiv_stamp(runs: &[(f64, String)]) -> Option<(String, (i64, i64, i64))> {
    let text: String = runs.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join(" ");
    let start = text.find("arXiv:")?;
    let rest = &text[start + 6..];
    let id: String = rest.chars().take_while(|c| c.is_ascii_digit() || matches!(c, '.' | 'v' | '/') || c.is_ascii_alphabetic() && false).collect();
    let after = &rest[id.len()..];
    let close = after.find(']')?;
    let tail: Vec<&str> = after[close + 1..].split_whitespace().take(3).collect();
    if tail.len() < 3 {
        return None;
    }
    let month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].iter().position(|m| tail[1].to_lowercase().starts_with(m))? as i64 + 1;
    Some((id, (tail[2].trim_matches(|c: char| !c.is_ascii_digit()).parse().ok()?, month, tail[0].parse().ok()?)))
}

/// Halaman tempat `selection` berada: dicocokkan tanpa spasi dan tanda baca (supaya potongan baris dan tanda hubung tidak mengganggu).
fn locate(doc: &Document, selection: &str) -> Option<u32> {
    let needle: String = normalize(selection).chars().take(80).collect();
    if needle.chars().count() < 12 {
        return None;
    }
    let pages = doc.get_pages();
    for &n in pages.keys().take(MAX_PAGES_SCANNED as usize) {
        if let Ok(text) = doc.extract_text_with_limit(&[n], MAX_PAGE_BYTES) {
            if normalize(&text).contains(&needle) {
                return Some(n);
            }
        }
    }
    None
}

pub fn analyze(bytes: &[u8], selection: Option<&str>, tab_title: &str, url: &str) -> Result<PdfInfo, String> {
    let doc = Document::load_mem(bytes).map_err(|e| format!("PDF tidak bisa dibaca ({e})"))?;
    if doc.is_encrypted() {
        return Err("PDF ini terkunci, jadi isinya tidak bisa dibaca.".into());
    }
    let pages = doc.get_pages().len() as u32;
    let dict = info_dict(&doc);
    let field = |k: &[u8]| dict.map(|d| info_str(&doc, d, k)).unwrap_or_default();
    let xmp = xmp_text(&doc);
    let mut guess: Vec<&str> = Vec::new();

    let runs = first_page_runs(&doc);
    let mut title = [field(b"Title"), xmp_value(&xmp, "dc:title")].into_iter().find(|t| sane_title(t));
    if title.is_none() {
        // Judul tab yang masuk akal (bukan nama berkas) lebih dipercaya daripada tebakan dari isi halaman.
        let tab = clean(tab_title);
        if sane_title(&tab) && tab != prettify_filename(url) {
            title = Some(tab);
        } else if let Some(g) = guess_title(&runs) {
            // Tanpa metadata (umum pada PDF arXiv dan hasil ekspor): teks terbesar di halaman pertama.
            title = Some(g);
        } else {
            let pretty = prettify_filename(url);
            if !pretty.is_empty() {
                title = Some(pretty);
            }
        }
        guess.push("title");
    }
    let arxiv = arxiv_stamp(&runs);

    let author_raw = [field(b"Author"), xmp_value(&xmp, "dc:creator")].into_iter().find(|a| sane_author(a)).unwrap_or_default();
    let authors = parse_authors(&author_raw);
    if authors.iter().any(|a| a.get("_guess").is_some()) {
        guess.push("author");
    }

    // DOI: XMP lebih dulu, lalu kamus Info, lalu teks dua halaman pertama.
    let mut doi = ["prism:doi", "pdfx:doi", "pdfx:DOI", "dc:identifier"].iter().filter_map(|t| find_doi(&xmp_value(&xmp, t))).next();
    if doi.is_none() {
        doi = find_doi(&[field(b"Subject"), field(b"Keywords"), field(b"Title")].join(" "));
    }
    if doi.is_none() {
        let first: Vec<u32> = doc.get_pages().keys().copied().take(2).collect();
        if let Ok(text) = doc.extract_text_with_limit(&first, MAX_PAGE_BYTES) {
            doi = find_doi(&text);
        }
    }

    let issued = ["prism:publicationDate", "prism:coverDate", "dc:date"].iter().find_map(|t| pdf_date(&xmp_value(&xmp, t).replace('-', "")))
        .map(|d| (d, false))
        .or_else(|| arxiv.as_ref().map(|(_, d)| (*d, false)))
        .or_else(|| pdf_date(&field(b"CreationDate")).map(|d| (d, true)));
    let issued_json = issued.map(|((y, m, d), is_file_date)| {
        if is_file_date {
            guess.push("issued"); // tanggal pembuatan berkas belum tentu tanggal terbit
        }
        let mut parts = vec![y];
        if m > 0 {
            parts.push(m);
            if d > 0 {
                parts.push(d);
            }
        }
        json!({ "date-parts": [parts] })
    });

    let journal = xmp_value(&xmp, "prism:publicationName");
    let kind = if arxiv.is_some() { "article" } else if doi.is_some() || !journal.is_empty() { "article-journal" } else { "document" };
    if journal.is_empty() && arxiv.is_none() {
        guess.push("type");
    }

    let mut source = Map::new();
    source.insert("type".into(), json!(kind));
    if let Some(t) = title {
        source.insert("title".into(), json!(t));
    }
    if !authors.is_empty() {
        source.insert("author".into(), json!(authors));
    }
    if let Some(i) = issued_json {
        source.insert("issued".into(), i);
    }
    source.insert("URL".into(), json!(url.split('#').next().unwrap_or(url)));
    if let Some(d) = doi {
        source.insert("DOI".into(), json!(d));
    }
    for (key, tag) in [("container-title", "prism:publicationName"), ("volume", "prism:volume"), ("issue", "prism:number"), ("publisher", "dc:publisher")] {
        let v = xmp_value(&xmp, tag);
        if !v.is_empty() {
            source.insert(key.into(), json!(v));
        }
    }
    let (first, last) = (xmp_value(&xmp, "prism:startingPage"), xmp_value(&xmp, "prism:endingPage"));
    if !first.is_empty() {
        source.insert("page".into(), json!(if last.is_empty() { first } else { format!("{first}-{last}") }));
    }
    if let Some((id, _)) = &arxiv {
        source.insert("container-title".into(), json!("arXiv"));
        source.insert("number".into(), json!(format!("arXiv:{id}")));
        source.insert("publisher".into(), json!("arXiv"));
    }
    if !guess.is_empty() {
        source.insert("_guess".into(), json!(guess));
    }
    source.insert("_pdf".into(), json!(true));

    let page = selection.and_then(|s| locate(&doc, s));
    Ok(PdfInfo { source: Value::Object(source), pages, page })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Stream};

    /// PDF kecil: satu halaman per teks, dengan kamus Info bila diberikan.
    pub(crate) fn pdf(pages: &[&str], info: Option<Dictionary>) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
        let resources = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font } });
        let mut kids = Vec::new();
        for text in pages {
            let content = Content {
                operations: vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec!["F1".into(), 12.into()]),
                    Operation::new("Td", vec![50.into(), 700.into()]),
                    Operation::new("Tj", vec![Object::string_literal(*text)]),
                    Operation::new("ET", vec![]),
                ],
            };
            let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
            let page_id = doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id, "Contents" => content_id, "Resources" => resources, "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()] });
            kids.push(page_id.into());
        }
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => pages.len() as i64 }));
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        if let Some(info) = info {
            let id = doc.add_object(info);
            doc.trailer.set("Info", id);
        }
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    #[test]
    fn reads_info_dictionary_doi_and_finds_the_page_of_a_selection() {
        let info = dictionary! {
            "Title" => Object::string_literal("Determinan Fungsi Intermediasi Bank"),
            "Author" => Object::string_literal("Putri, Friestha Sari; Falianty, Telisa Aulia"),
            "CreationDate" => Object::string_literal("D:20260821103000+07'00'"),
        };
        let bytes = pdf(&["Halaman satu. Doi: 10.7454/jepi.v26i2.1636.", "Halaman dua memuat kalimat tentang rasio kredit terhadap simpanan bank."], Some(info));
        let got = analyze(&bytes, Some("kalimat tentang rasio kredit terhadap simpanan"), "tab", "https://a.test/x.pdf").unwrap();
        assert_eq!(got.pages, 2);
        assert_eq!(got.page, Some(2));
        assert_eq!(got.source["title"], "Determinan Fungsi Intermediasi Bank");
        assert_eq!(got.source["author"][0]["family"], "Putri");
        assert_eq!(got.source["author"][1]["given"], "Telisa Aulia");
        assert_eq!(got.source["DOI"], "10.7454/jepi.v26i2.1636");
        assert_eq!(got.source["issued"]["date-parts"][0][0], 2026);
        assert!(got.source["_guess"].as_array().unwrap().iter().any(|g| g == "issued"));
        assert!(!got.source["_guess"].as_array().unwrap().iter().any(|g| g == "title"));
    }

    #[test]
    fn junk_titles_and_authors_fall_back_and_are_flagged() {
        let info = dictionary! { "Title" => Object::string_literal("Microsoft Word - skripsi_final.docx"), "Author" => Object::string_literal("Windows User") };
        let bytes = pdf(&["Isi."], Some(info));
        let got = analyze(&bytes, None, "Judul Dari Tab Browser", "https://a.test/files/laporan_akhir-2026.pdf").unwrap();
        assert_eq!(got.source["title"], "Judul Dari Tab Browser");
        assert!(got.source.get("author").is_none());
        assert!(got.source["_guess"].as_array().unwrap().iter().any(|g| g == "title"));
        // Tab hanya nama berkas: jatuh ke nama berkas yang dirapikan.
        let got = analyze(&bytes, None, "laporan_akhir-2026.pdf", "https://a.test/files/laporan_akhir-2026.pdf").unwrap();
        assert_eq!(got.source["title"], "laporan akhir 2026");
        assert_eq!(got.page, None);
    }

    #[test]
    fn no_info_at_all_still_gives_a_usable_source() {
        let got = analyze(&pdf(&["Hanya teks."], None), Some("tidak ada di dokumen ini sama sekali"), "", "https://a.test/b.pdf").unwrap();
        assert_eq!(got.source["type"], "document");
        assert_eq!(got.source["URL"], "https://a.test/b.pdf");
        assert_eq!(got.page, None);
    }

    /// Berkas nyata: `PDF_SAMPLE=/jalur/berkas.pdf PDF_SELECTION="..." cargo test --lib real_pdf -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_pdf() {
        let path = std::env::var("PDF_SAMPLE").expect("PDF_SAMPLE");
        let bytes = std::fs::read(path).unwrap();
        let sel = std::env::var("PDF_SELECTION").ok();
        let t = std::time::Instant::now();
        let got = analyze(&bytes, sel.as_deref(), &std::env::var("PDF_TAB").unwrap_or_default(), "https://arxiv.org/pdf/1706.03762").unwrap();
        if std::env::var("PDF_RUNS").is_ok() {
            let doc = Document::load_mem(&bytes).unwrap();
            for (sz, t) in first_page_runs(&doc).iter().take(40) {
                println!("{sz:>5} | {t}");
            }
        }
        println!("{} ms\n{}\npages={} page={:?}", t.elapsed().as_millis(), serde_json::to_string_pretty(&got.source).unwrap(), got.pages, got.page);
    }

    #[test]
    fn broken_input_is_a_clean_error() {
        assert!(analyze(b"bukan pdf", None, "", "https://a.test/x.pdf").is_err());
    }

    #[test]
    fn doi_scanner_and_helpers() {
        assert_eq!(find_doi("lihat https://doi.org/10.1038/s41586-020-2649-2."), Some("10.1038/s41586-020-2649-2".into()));
        assert_eq!(find_doi("angka 10.5 dan 3.10.2/x"), None);
        assert_eq!(decode_text(&[0xFE, 0xFF, 0x00, 0x41, 0x00, 0xE9]), "Aé");
        assert!(!sane_title("Untitled") && !sane_title("laporan_akhir_v2") && sane_title("Array programming with NumPy"));
        assert_eq!(parse_authors("Harris, Charles R.; Millman, K. Jarrod").len(), 2);
        assert_eq!(parse_authors("Admin").len(), 0);
        // Satu koma: "Keluarga, Depan" atau dua nama utuh?
        assert_eq!(parse_authors("Putri, Friestha Sari")[0]["family"], "Putri");
        assert_eq!(parse_authors("Smith, J. K.")[0]["given"], "J. K.");
        let two = parse_authors("George A. Alessandria, Horag Choi");
        assert_eq!(two.len(), 2);
        assert_eq!(two[0]["family"], "Alessandria");
        assert_eq!(two[1]["family"], "Choi");
        assert_eq!(pdf_date("D:2026"), Some((2026, 0, 0)));
    }
}
