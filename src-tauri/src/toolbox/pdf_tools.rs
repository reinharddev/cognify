//! Alat PDF tambahan di atas lopdf dan image, semuanya berjalan di dalam proses (tanpa jaringan, tanpa AI):
//! gambar menjadi PDF, mengatur halaman (hapus, putar, urutkan, gandakan), dan mengambil teks.
//!
//! Batas yang diketahui: PDF yang dikunci password ditolak (sama seperti alat PDF lain), mengatur halaman membuang
//! bookmark (tujuannya bisa menunjuk halaman yang dihapus), dan pengambilan teks tidak membaca PDF hasil pindai
//! (yang isinya gambar, bukan teks) dan bisa berantakan pada font khusus.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::Cursor,
    path::{Path, PathBuf},
};

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, metadata::Orientation};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};

use crate::toolbox::{fsutil, pdf};

const MAX_IMAGES: usize = 300;
const MAX_IMAGE_BYTES: u64 = 80 * 1024 * 1024;
/// Batas piksel satu gambar (sekitar 100 megapiksel) supaya berkas aneh tidak menghabiskan memori.
const MAX_PIXELS: u64 = 100_000_000;
/// Gambar dianggap beresolusi 150 dpi saat halaman mengikuti ukuran gambar.
const DPI: f32 = 150.0;
const MARGIN_PT: f32 = 36.0;

// ───────────────────────────────────────────────────────── gambar ke PDF ──

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PageSize {
    /// Halaman seukuran gambar.
    Fit,
    A4,
    Letter,
}

impl PageSize {
    /// Ukuran potret dalam poin (1 poin = 1/72 inci).
    fn portrait(self) -> Option<(f32, f32)> {
        match self {
            PageSize::Fit => None,
            PageSize::A4 => Some((595.28, 841.89)),
            PageSize::Letter => Some((612.0, 792.0)),
        }
    }
}

enum Pixels {
    /// JPEG apa adanya (tidak dikodekan ulang). `gray` bila satu komponen.
    Jpeg { data: Vec<u8>, gray: bool },
    /// RGB mentah, 8 bit per komponen, dimampatkan tanpa kehilangan (Flate).
    Rgb(Vec<u8>),
}

struct Prepared {
    width: u32,
    height: u32,
    pixels: Pixels,
}

/// Jumlah komponen warna dan presisi dari penanda SOF sebuah JPEG; None bila bukan JPEG yang terbaca.
fn jpeg_info(bytes: &[u8]) -> Option<(u8, u8)> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let mut i = 2;
    while i + 4 <= bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = bytes[i + 1];
        if marker == 0xFF {
            i += 1;
            continue;
        }
        // penanda tanpa panjang
        if marker == 0x01 || (0xD0..=0xD9).contains(&marker) {
            i += 2;
            continue;
        }
        let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
        let is_sof = (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC);
        if is_sof {
            // panjang(2) presisi(1) tinggi(2) lebar(2) komponen(1)
            return (i + 10 <= bytes.len()).then(|| (bytes[i + 9], bytes[i + 4]));
        }
        i += 2 + len;
    }
    None
}

/// Campur piksel transparan dengan latar putih (PDF di sini tidak memakai kanal alfa).
fn flatten_on_white(img: &DynamicImage) -> Vec<u8> {
    let rgba = img.to_rgba8();
    let mut out = Vec::with_capacity(rgba.len() / 4 * 3);
    for p in rgba.pixels() {
        let a = u32::from(p[3]);
        for c in 0..3 {
            out.push(((u32::from(p[c]) * a + 255 * (255 - a)) / 255) as u8);
        }
    }
    out
}

fn prepare(path: &Path) -> Result<Prepared, String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string();
    let meta = std::fs::metadata(path).map_err(|e| format!("{name}: tidak bisa dibaca ({e})"))?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(format!("{name}: terlalu besar (maksimal 80 MB)"));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("{name}: tidak bisa dibaca ({e})"))?;
    let reader = ImageReader::new(Cursor::new(&bytes)).with_guessed_format().map_err(|e| format!("{name}: tidak bisa dibaca ({e})"))?;
    let format = reader.format();
    let mut decoder = reader.into_decoder().map_err(|_| format!("{name}: bukan gambar yang didukung (JPG, PNG, WebP, BMP, atau TIFF)"))?;
    let (w, h) = decoder.dimensions();
    if u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err(format!("{name}: terlalu besar ({w}×{h} piksel)"));
    }
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);

    // JPEG tegak dengan warna biasa: dipakai apa adanya, jadi tidak ada penurunan mutu.
    if format == Some(ImageFormat::Jpeg) && orientation == Orientation::NoTransforms {
        if let Some((components, precision)) = jpeg_info(&bytes) {
            if precision == 8 && (components == 1 || components == 3) {
                drop(decoder); // melepas pinjaman atas `bytes` sebelum dipindahkan ke PDF
                return Ok(Prepared { width: w, height: h, pixels: Pixels::Jpeg { data: bytes, gray: components == 1 } });
            }
        }
    }

    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| format!("{name}: gambar rusak ({e})"))?;
    img.apply_orientation(orientation); // foto dari ponsel tersimpan miring, orientasinya ada di EXIF
    let (width, height) = (img.width(), img.height());
    let rgb = if img.color().has_alpha() { flatten_on_white(&img) } else { img.to_rgb8().into_raw() };
    Ok(Prepared { width, height, pixels: Pixels::Rgb(rgb) })
}

/// Ukuran halaman (poin) dan posisi serta ukuran gambar di dalamnya.
fn layout(img_w: u32, img_h: u32, size: PageSize, margin: bool) -> ((f32, f32), (f32, f32, f32, f32)) {
    let (iw, ih) = (img_w as f32, img_h as f32);
    match size.portrait() {
        None => {
            let (w, h) = ((iw * 72.0 / DPI).max(72.0), (ih * 72.0 / DPI).max(72.0));
            ((w, h), (0.0, 0.0, w, h))
        }
        Some((pw, ph)) => {
            // halaman mengikuti arah gambar, supaya foto mendatar tidak mengecil di halaman tegak
            let (w, h) = if iw > ih { (ph, pw) } else { (pw, ph) };
            let m = if margin { MARGIN_PT } else { 0.0 };
            let scale = ((w - 2.0 * m) / iw).min((h - 2.0 * m) / ih);
            let (dw, dh) = (iw * scale, ih * scale);
            ((w, h), ((w - dw) / 2.0, (h - dh) / 2.0, dw, dh))
        }
    }
}

/// Satu gambar per halaman, sesuai urutan `inputs`. Mengembalikan jumlah halaman.
pub fn images_to_pdf(inputs: &[PathBuf], size: PageSize, margin: bool, output: &Path) -> Result<u32, String> {
    if inputs.is_empty() {
        return Err("Pilih minimal satu gambar".into());
    }
    if inputs.len() > MAX_IMAGES {
        return Err(format!("Terlalu banyak gambar (maksimal {MAX_IMAGES})"));
    }
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids: Vec<Object> = Vec::with_capacity(inputs.len());

    for path in inputs {
        let p = prepare(path)?;
        let (width, height) = (p.width, p.height);
        let image_id = match p.pixels {
            Pixels::Jpeg { data, gray } => doc.add_object(Stream::new(
                dictionary! {
                    "Type" => "XObject", "Subtype" => "Image",
                    "Width" => i64::from(width), "Height" => i64::from(height),
                    "ColorSpace" => if gray { "DeviceGray" } else { "DeviceRGB" },
                    "BitsPerComponent" => 8, "Filter" => "DCTDecode",
                },
                data,
            )),
            Pixels::Rgb(raw) => {
                let mut stream = Stream::new(
                    dictionary! {
                        "Type" => "XObject", "Subtype" => "Image",
                        "Width" => i64::from(width), "Height" => i64::from(height),
                        "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
                    },
                    raw,
                );
                stream.compress().map_err(|e| format!("Gagal memampatkan gambar: {e}"))?;
                doc.add_object(stream)
            }
        };
        let ((pw, ph), (x, y, dw, dh)) = layout(width, height, size, margin);
        let content = format!("q {dw:.3} 0 0 {dh:.3} {x:.3} {y:.3} cm /Im0 Do Q");
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), Object::Real(pw), Object::Real(ph)],
            "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => image_id } },
            "Contents" => content_id,
        });
        kids.push(page_id.into());
    }

    let count = kids.len() as u32;
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => i64::from(count) }));
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    doc.save(output).map_err(|e| format!("Gagal menyimpan: {e}"))?;
    Ok(count)
}

// ──────────────────────────────────────────────────────── atur halaman ──

/// Satu halaman pada hasil akhir: nomor halaman asli (mulai 1) dan putaran tambahan (kelipatan 90 derajat).
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct PageOp {
    pub page: u32,
    #[serde(default)]
    pub rotate: i32,
}

/// Susun PDF baru dari `ops`, sesuai urutannya. Halaman yang tidak disebut dibuang; halaman yang disebut dua kali digandakan.
pub fn organize(input: &Path, ops: &[PageOp], output: &Path) -> Result<u32, String> {
    if ops.is_empty() {
        return Err("Tidak ada halaman yang dipilih".into());
    }
    if ops.iter().any(|o| o.rotate % 90 != 0) {
        return Err("Putaran harus kelipatan 90 derajat".into());
    }
    let mut doc = pdf::load(input)?;
    let pages: BTreeMap<u32, ObjectId> = doc.get_pages();
    for id in pages.values() {
        pdf::inline_inherited(&mut doc, *id);
    }
    // Putaran awal tiap halaman dibaca sekali, supaya halaman yang digandakan tidak memutar dua kali.
    let base: HashMap<u32, i64> = pages
        .iter()
        .map(|(n, id)| (*n, doc.get_dictionary(*id).ok().and_then(|d| d.get(b"Rotate").ok()).and_then(|r| r.as_i64().ok()).unwrap_or(0)))
        .collect();

    doc.max_id += 1;
    let root_id: ObjectId = (doc.max_id, 0);
    let mut used = HashSet::new();
    let mut kids: Vec<Object> = Vec::with_capacity(ops.len());
    for op in ops {
        let original = *pages.get(&op.page).ok_or_else(|| format!("Halaman {} tidak ada", op.page))?;
        let target = if used.insert(op.page) {
            original
        } else {
            let copy = doc.get_dictionary(original).map_err(|e| e.to_string())?.clone();
            doc.add_object(copy)
        };
        let rotate = (base[&op.page] + i64::from(op.rotate)).rem_euclid(360);
        let page = doc.get_object_mut(target).and_then(Object::as_dict_mut).map_err(|e| e.to_string())?;
        page.set("Rotate", rotate);
        page.set("Parent", root_id);
        kids.push(Object::Reference(target));
    }
    let count = kids.len() as u32;
    doc.objects.insert(root_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => i64::from(count) }));

    let catalog_id = doc.trailer.get(b"Root").and_then(Object::as_reference).map_err(|e| e.to_string())?;
    let catalog = doc.get_object_mut(catalog_id).and_then(Object::as_dict_mut).map_err(|e| e.to_string())?;
    catalog.set("Pages", root_id);
    for key in [&b"Outlines"[..], b"Names", b"Dests", b"AcroForm"] {
        catalog.remove(key);
    }
    doc.prune_objects(); // pohon halaman lama dan halaman yang dibuang ikut hilang
    doc.renumber_objects();
    doc.compress();
    doc.save(output).map_err(|e| format!("Gagal menyimpan: {e}"))?;
    Ok(count)
}

// ───────────────────────────────────────────────────────────── ambil teks ──

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextStats {
    pub output: String,
    pub pages: u32,
    /// Jumlah karakter bukan spasi yang berhasil diambil; 0 biasanya berarti PDF hasil pindai.
    pub chars: usize,
}

pub fn extract_text(input: &Path, output: &Path) -> Result<TextStats, String> {
    let doc = pdf::load(input)?;
    let numbers: Vec<u32> = doc.get_pages().keys().copied().collect();
    let mut text = String::new();
    let mut chars = 0;
    for n in &numbers {
        // satu halaman yang gagal dibaca tidak menggagalkan yang lain
        let page = doc.extract_text(&[*n]).unwrap_or_default();
        let page = page.trim();
        chars += page.chars().filter(|c| !c.is_whitespace()).count();
        text.push_str(&format!("--- Halaman {n} ---\n{page}\n\n"));
    }
    std::fs::write(output, text).map_err(|e| format!("Gagal menyimpan: {e}"))?;
    Ok(TextStats { output: output.to_string_lossy().into_owned(), pages: numbers.len() as u32, chars })
}

// ─────────────────────────────────────────────────────────────── perintah ──

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagesToPdfRequest {
    pub inputs: Vec<String>,
    pub out_dir: Option<String>,
    pub page: PageSize,
    pub margin: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeRequest {
    pub input: String,
    pub out_dir: Option<String>,
    pub ops: Vec<PageOp>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOut {
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
pub async fn images_to_pdf_cmd(req: ImagesToPdfRequest) -> Result<PdfOut, String> {
    check_out_dir(&req.out_dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        let inputs: Vec<PathBuf> = req.inputs.iter().map(PathBuf::from).collect();
        let first = inputs.first().ok_or("Pilih minimal satu gambar")?;
        let dir = fsutil::output_dir(first, req.out_dir.as_deref());
        let stem = if inputs.len() == 1 { fsutil::stem_of(first).to_string() } else { format!("{}_gabungan", fsutil::stem_of(first)) };
        let output = fsutil::unique_path(&dir, &stem, "pdf");
        let pages = images_to_pdf(&inputs, req.page, req.margin, &output)?;
        Ok(PdfOut { output: output.to_string_lossy().into_owned(), pages })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pdf_organize(req: OrganizeRequest) -> Result<PdfOut, String> {
    check_out_dir(&req.out_dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        let input = Path::new(&req.input);
        let dir = fsutil::output_dir(input, req.out_dir.as_deref());
        let output = fsutil::unique_path(&dir, &format!("{}_diatur", fsutil::stem_of(input)), "pdf");
        let pages = organize(input, &req.ops, &output)?;
        Ok(PdfOut { output: output.to_string_lossy().into_owned(), pages })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pdf_text(input: String, out_dir: Option<String>) -> Result<TextStats, String> {
    check_out_dir(&out_dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        let input = Path::new(&input);
        let dir = fsutil::output_dir(input, out_dir.as_deref());
        let output = fsutil::unique_path(&dir, fsutil::stem_of(input), "txt");
        extract_text(input, &output)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{codecs::jpeg::JpegEncoder, ExtendedColorType, ImageBuffer, ImageEncoder, Luma, Rgb, Rgba};

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("toolbox-pdftools-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_png(path: &Path, w: u32, h: u32) {
        ImageBuffer::from_fn(w, h, |x, y| Rgb([(x % 256) as u8, (y % 256) as u8, 128u8])).save(path).unwrap();
    }

    fn write_jpeg(path: &Path, w: u32, h: u32, gray: bool) {
        let mut out = Vec::new();
        let enc = JpegEncoder::new_with_quality(&mut out, 85);
        if gray {
            let img: ImageBuffer<Luma<u8>, _> = ImageBuffer::from_fn(w, h, |x, _| Luma([(x % 256) as u8]));
            enc.write_image(img.as_raw(), w, h, ExtendedColorType::L8).unwrap();
        } else {
            let img: ImageBuffer<Rgb<u8>, _> = ImageBuffer::from_fn(w, h, |x, y| Rgb([(x % 256) as u8, (y % 256) as u8, 50]));
            enc.write_image(img.as_raw(), w, h, ExtendedColorType::Rgb8).unwrap();
        }
        std::fs::write(path, out).unwrap();
    }

    fn media_box(doc: &Document, page: ObjectId) -> Vec<f32> {
        doc.get_dictionary(page).unwrap().get(b"MediaBox").unwrap().as_array().unwrap().iter().map(|o| o.as_float().unwrap()).collect()
    }

    #[test]
    fn jpeg_markers_report_components_and_precision() {
        let d = temp("jpeginfo");
        write_jpeg(&d.join("c.jpg"), 40, 30, false);
        write_jpeg(&d.join("g.jpg"), 40, 30, true);
        assert_eq!(jpeg_info(&std::fs::read(d.join("c.jpg")).unwrap()), Some((3, 8)));
        assert_eq!(jpeg_info(&std::fs::read(d.join("g.jpg")).unwrap()), Some((1, 8)));
        assert_eq!(jpeg_info(b"bukan jpeg"), None);
        assert_eq!(jpeg_info(&[0xFF, 0xD8]), None);
    }

    #[test]
    fn transparent_pixels_become_white() {
        let img = DynamicImage::ImageRgba8(ImageBuffer::from_fn(2, 1, |x, _| if x == 0 { Rgba([255, 0, 0, 0]) } else { Rgba([0, 0, 255, 255]) }));
        assert_eq!(flatten_on_white(&img), vec![255, 255, 255, 0, 0, 255]);
    }

    #[test]
    fn page_layout_follows_the_size_choice() {
        // mengikuti gambar: 300 px pada 150 dpi = 144 pt
        let ((w, h), (x, y, dw, dh)) = layout(300, 150, PageSize::Fit, false);
        assert_eq!(((w, h), (x, y, dw, dh)), ((144.0, 72.0), (0.0, 0.0, 144.0, 72.0)));
        // A4 tegak, gambar tegak, tanpa margin: mengisi lebar, dipusatkan
        let ((w, h), (x, _, dw, _)) = layout(1000, 2000, PageSize::A4, false);
        assert_eq!((w, h), (595.28, 841.89));
        assert!(x >= 0.0 && dw <= w + 0.01);
        // gambar mendatar membuat halaman mendatar
        let ((w, h), _) = layout(2000, 1000, PageSize::A4, true);
        assert!(w > h);
        // margin membuat gambar lebih kecil dari halaman
        let (_, (_, _, dw, dh)) = layout(1000, 1000, PageSize::Letter, true);
        assert!(dw <= 612.0 - 72.0 + 0.01 && dh <= 792.0 - 72.0 + 0.01);
    }

    #[test]
    fn images_become_one_page_each_and_jpegs_are_not_recoded() {
        let d = temp("img2pdf");
        write_png(&d.join("a.png"), 120, 80);
        write_jpeg(&d.join("b.jpg"), 90, 140, false);
        write_jpeg(&d.join("c.jpg"), 60, 60, true);
        let jpeg_len = std::fs::metadata(d.join("b.jpg")).unwrap().len() as usize;
        let out = d.join("hasil.pdf");
        let n = images_to_pdf(&[d.join("a.png"), d.join("b.jpg"), d.join("c.jpg")], PageSize::A4, true, &out).unwrap();
        assert_eq!(n, 3);

        let doc = Document::load(&out).unwrap();
        let pages = doc.get_pages();
        assert_eq!(pages.len(), 3);
        // gambar mendatar (120×80) → halaman A4 mendatar
        let first = media_box(&doc, pages[&1]);
        assert!(first[2] > first[3], "{first:?}");
        // JPEG disimpan apa adanya: aliran DCT sepanjang berkas asli, abu-abu memakai DeviceGray
        let mut found = Vec::new();
        for obj in doc.objects.values() {
            if let Object::Stream(s) = obj {
                if s.dict.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Image") {
                    let filter = s.dict.get(b"Filter").and_then(Object::as_name).map(|f| String::from_utf8_lossy(f).into_owned()).unwrap_or_default();
                    let cs = s.dict.get(b"ColorSpace").and_then(Object::as_name).map(|f| String::from_utf8_lossy(f).into_owned()).unwrap_or_default();
                    found.push((filter, cs, s.content.len()));
                }
            }
        }
        assert!(found.iter().any(|(f, _, len)| f == "DCTDecode" && *len == jpeg_len), "{found:?}");
        assert!(found.iter().any(|(f, c, _)| f == "DCTDecode" && c == "DeviceGray"), "{found:?}");
        assert!(found.iter().any(|(f, c, _)| f == "FlateDecode" && c == "DeviceRGB"), "PNG dimampatkan tanpa kehilangan: {found:?}");
    }

    #[test]
    fn bad_inputs_are_explained() {
        let d = temp("img2pdf-bad");
        let out = d.join("x.pdf");
        assert!(images_to_pdf(&[], PageSize::Fit, false, &out).is_err());
        std::fs::write(d.join("teks.png"), b"ini bukan gambar").unwrap();
        let err = images_to_pdf(&[d.join("teks.png")], PageSize::Fit, false, &out).unwrap_err();
        assert!(err.contains("teks.png") && err.contains("bukan gambar"), "{err}");
        assert!(images_to_pdf(&[d.join("tidak-ada.png")], PageSize::Fit, false, &out).is_err());
        assert!(!out.exists(), "tidak ada PDF setengah jadi");
    }

    /// PDF tiga halaman dengan ukuran berbeda-beda (100×50, 200×100, 300×150 piksel → poin berbeda), mudah dikenali urutannya.
    fn three_pages(d: &Path) -> PathBuf {
        for (i, (w, h)) in [(300u32, 150u32), (600, 300), (900, 450)].iter().enumerate() {
            write_png(&d.join(format!("p{}.png", i + 1)), *w, *h);
        }
        let out = d.join("tiga.pdf");
        images_to_pdf(&[d.join("p1.png"), d.join("p2.png"), d.join("p3.png")], PageSize::Fit, false, &out).unwrap();
        out
    }

    #[test]
    fn pages_can_be_dropped_reordered_rotated_and_duplicated() {
        let d = temp("organize");
        let src = three_pages(&d);
        let out = d.join("diatur.pdf");
        let ops = [PageOp { page: 3, rotate: 0 }, PageOp { page: 1, rotate: 90 }, PageOp { page: 1, rotate: -90 }];
        assert_eq!(organize(&src, &ops, &out).unwrap(), 3);

        let doc = Document::load(&out).unwrap();
        let pages = doc.get_pages();
        assert_eq!(pages.len(), 3);
        let widths: Vec<f32> = pages.values().map(|id| media_box(&doc, *id)[2]).collect();
        assert_eq!(widths, vec![432.0, 144.0, 144.0], "urutan baru: halaman 3, lalu halaman 1 dua kali");
        let rot = |n: u32| doc.get_dictionary(pages[&n]).unwrap().get(b"Rotate").and_then(Object::as_i64).unwrap_or(0);
        assert_eq!((rot(1), rot(2), rot(3)), (0, 90, 270), "salinan tidak ikut terputar dua kali");
        // halaman 2 asli (600 px) sudah dibuang dan tidak tersisa di berkas
        assert!(!widths.contains(&288.0));
    }

    #[test]
    fn organize_validates_and_keeps_the_source() {
        let d = temp("organize-bad");
        let src = three_pages(&d);
        let before = std::fs::read(&src).unwrap();
        let out = d.join("x.pdf");
        assert!(organize(&src, &[], &out).unwrap_err().contains("Tidak ada halaman"));
        assert!(organize(&src, &[PageOp { page: 9, rotate: 0 }], &out).unwrap_err().contains("Halaman 9"));
        assert!(organize(&src, &[PageOp { page: 1, rotate: 45 }], &out).unwrap_err().contains("90"));
        assert_eq!(std::fs::read(&src).unwrap(), before, "berkas asli tidak berubah");
    }

    #[test]
    fn rotation_accumulates_on_an_already_rotated_page() {
        let d = temp("organize-rot");
        let src = three_pages(&d);
        let once = d.join("once.pdf");
        organize(&src, &[PageOp { page: 1, rotate: 90 }], &once).unwrap();
        let twice = d.join("twice.pdf");
        organize(&once, &[PageOp { page: 1, rotate: 270 }], &twice).unwrap();
        let doc = Document::load(&twice).unwrap();
        let id = doc.get_pages()[&1];
        assert_eq!(doc.get_dictionary(id).unwrap().get(b"Rotate").and_then(Object::as_i64).unwrap(), 0);
    }

    fn text_pdf(path: &Path, pages: &[&str]) {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
        let mut kids = Vec::new();
        for text in pages {
            let content = format!("BT /F1 18 Tf 72 700 Td ({text}) Tj ET");
            let cid = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
            let page = doc.add_object(dictionary! {
                "Type" => "Page", "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
                "Contents" => cid,
            });
            kids.push(Object::from(page));
        }
        let n = kids.len() as i64;
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => n }));
        let cat = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", cat);
        doc.save(path).unwrap();
    }

    #[test]
    fn text_is_extracted_page_by_page_and_scans_are_flagged() {
        let d = temp("text");
        let src = d.join("teks.pdf");
        text_pdf(&src, &["Halo dunia", "Halaman kedua"]);
        let stats = extract_text(&src, &d.join("teks.txt")).unwrap();
        assert_eq!((stats.pages, stats.chars > 10), (2, true));
        let body = std::fs::read_to_string(d.join("teks.txt")).unwrap();
        assert!(body.contains("--- Halaman 1 ---") && body.contains("Halo dunia") && body.contains("Halaman kedua"), "{body}");

        // PDF dari gambar tidak punya teks: jumlah karakter 0 menandai "hasil pindai"
        let scan = three_pages(&d);
        let none = extract_text(&scan, &d.join("pindai.txt")).unwrap();
        assert_eq!(none.chars, 0);
    }
}
