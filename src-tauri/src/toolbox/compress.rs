//! PDF compression on permissive libraries only (lopdf + image, both MIT/Apache).
//!
//! Two layers:
//! - **Always, lossless:** drop unreferenced objects and page thumbnails,
//!   deflate uncompressed streams, write object + xref streams.
//! - **Balanced / Strong, lossy, images only:** JPEG images and Flate RGB/Gray
//!   images are re-encoded as JPEG at a lower quality and capped in pixel size.
//!   Text, fonts and vector drawings are never touched.
//!
//! An image is only replaced when the result is at least 15% smaller, so flat
//! graphics (which Flate stores better than JPEG) are left alone. Skipped on
//! purpose: palette (Indexed) images, stencil masks, images with a /Mask or
//! /Decode entry, 16-bit images, and the soft masks (/SMask) that carry alpha,
//! since JPEG artefacts on a mask show up as halos around cut-out edges.

use std::{
    collections::HashSet,
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
};

use image::{
    codecs::jpeg::JpegEncoder, imageops, ExtendedColorType, ImageBuffer, ImageFormat, Luma, Rgb,
};
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::{Deserialize, Serialize};

use crate::toolbox::{fsutil, pdf};

/// Streams smaller than this are not worth the quality loss.
const MIN_STREAM_BYTES: usize = 30_000;
/// An image must shrink to at most this fraction of its size to be replaced.
const REQUIRED_RATIO: f64 = 0.85;
/// Refuse absurd dimensions instead of allocating gigabytes.
const MAX_PIXELS: u64 = 120_000_000;

#[derive(Clone, Copy, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    /// Structure only. Pixel-identical result.
    Lossless,
    /// JPEG quality 75, images capped at 2000 px on the long side.
    Balanced,
    /// JPEG quality 55, images capped at 1400 px on the long side.
    Strong,
}

struct ImageParams {
    quality: u8,
    max_side: u32,
}

fn image_params(level: Level) -> Option<ImageParams> {
    match level {
        Level::Lossless => None,
        Level::Balanced => Some(ImageParams { quality: 75, max_side: 2000 }),
        Level::Strong => Some(ImageParams { quality: 55, max_side: 1400 }),
    }
}

#[derive(Default, Debug, Clone, Copy)]
pub struct ImageStats {
    /// Images that were eligible for recompression.
    pub considered: u32,
    /// Images actually replaced.
    pub replaced: u32,
}

#[derive(Debug)]
pub struct Outcome {
    pub before: u64,
    pub after: u64,
    pub images: ImageStats,
    /// False when the result was not smaller; no file is left behind then.
    pub kept: bool,
}

fn int(doc: &Document, obj: &Object) -> Option<i64> {
    doc.dereference(obj).ok()?.1.as_i64().ok()
}

/// 1 (gray) or 3 (RGB) when the image's colour space is one we re-encode as
/// JPEG without changing its meaning. Anything else (Indexed, CMYK, Lab, ...)
/// returns None and the image is left alone.
fn components(doc: &Document, dict: &Dictionary) -> Option<u8> {
    let (_, cs) = doc.dereference(dict.get(b"ColorSpace").ok()?).ok()?;
    match cs {
        Object::Name(name) => match name.as_slice() {
            b"DeviceRGB" => Some(3),
            b"DeviceGray" => Some(1),
            _ => None,
        },
        Object::Array(items) => {
            if items.first()?.as_name().ok()? != b"ICCBased" {
                return None;
            }
            let (_, profile) = doc.dereference(items.get(1)?).ok()?;
            match int(doc, profile.as_stream().ok()?.dict.get(b"N").ok()?)? {
                1 => Some(1),
                3 => Some(3),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Object ids used as /SMask or /Mask by some image. They are never recompressed.
fn mask_ids(doc: &Document) -> HashSet<ObjectId> {
    let mut ids = HashSet::new();
    for object in doc.objects.values() {
        if let Object::Stream(stream) = object {
            for key in [b"SMask".as_slice(), b"Mask".as_slice()] {
                if let Ok(Object::Reference(id)) = stream.dict.get(key) {
                    ids.insert(*id);
                }
            }
        }
    }
    ids
}

enum Pixels {
    Rgb(ImageBuffer<Rgb<u8>, Vec<u8>>),
    Gray(ImageBuffer<Luma<u8>, Vec<u8>>),
}

struct Replacement {
    jpeg: Vec<u8>,
    width: u32,
    height: u32,
}

/// Decides whether to recompress one image and, if so, produces the new JPEG.
/// `None` means "leave it as it is" (either not eligible or not worth it).
fn recompress(
    doc: &Document,
    id: ObjectId,
    masks: &HashSet<ObjectId>,
    params: &ImageParams,
    stats: &mut ImageStats,
) -> Option<Replacement> {
    if masks.contains(&id) {
        return None;
    }
    let stream = doc.get_object(id).ok()?.as_stream().ok()?;
    let dict = &stream.dict;
    if dict.get(b"Subtype").ok()?.as_name().ok()? != b"Image" {
        return None;
    }
    if dict.get(b"ImageMask").and_then(Object::as_bool).unwrap_or(false)
        || dict.has(b"Mask")
        || dict.has(b"Decode")
        || int(doc, dict.get(b"BitsPerComponent").ok()?)? != 8
        || stream.content.len() < MIN_STREAM_BYTES
    {
        return None;
    }

    let comps = components(doc, dict)?;
    let width = u32::try_from(int(doc, dict.get(b"Width").ok()?)?).ok()?;
    let height = u32::try_from(int(doc, dict.get(b"Height").ok()?)?).ok()?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return None;
    }

    let filters = stream.filters().ok()?;
    let pixels = match filters.as_slice() {
        [b"DCTDecode"] => {
            let img = image::load_from_memory_with_format(&stream.content, ImageFormat::Jpeg).ok()?;
            if img.width() != width || img.height() != height {
                return None;
            }
            if comps == 3 { Pixels::Rgb(img.to_rgb8()) } else { Pixels::Gray(img.to_luma8()) }
        }
        [b"FlateDecode"] => {
            let expected = width as usize * height as usize * comps as usize;
            // bounded: a stream claiming to inflate beyond its own header is rejected
            let raw = stream.decompressed_content_with_limit(expected).ok()?;
            if raw.len() != expected {
                return None;
            }
            if comps == 3 {
                Pixels::Rgb(ImageBuffer::from_raw(width, height, raw)?)
            } else {
                Pixels::Gray(ImageBuffer::from_raw(width, height, raw)?)
            }
        }
        _ => return None,
    };
    stats.considered += 1;

    let longest = width.max(height);
    let (nw, nh) = if longest > params.max_side {
        let scale = f64::from(params.max_side) / f64::from(longest);
        (
            ((f64::from(width) * scale).round() as u32).max(1),
            ((f64::from(height) * scale).round() as u32).max(1),
        )
    } else {
        (width, height)
    };

    let mut jpeg = Vec::new();
    let encoder = &mut JpegEncoder::new_with_quality(&mut jpeg, params.quality);
    match pixels {
        Pixels::Rgb(buf) => {
            let buf = if (nw, nh) != (width, height) {
                imageops::resize(&buf, nw, nh, imageops::FilterType::Lanczos3)
            } else {
                buf
            };
            encoder.encode(buf.as_raw(), nw, nh, ExtendedColorType::Rgb8).ok()?;
        }
        Pixels::Gray(buf) => {
            let buf = if (nw, nh) != (width, height) {
                imageops::resize(&buf, nw, nh, imageops::FilterType::Lanczos3)
            } else {
                buf
            };
            encoder.encode(buf.as_raw(), nw, nh, ExtendedColorType::L8).ok()?;
        }
    }

    if (jpeg.len() as f64) > stream.content.len() as f64 * REQUIRED_RATIO {
        return None;
    }
    Some(Replacement { jpeg, width: nw, height: nh })
}

fn recompress_images(doc: &mut Document, params: &ImageParams) -> ImageStats {
    let masks = mask_ids(doc);
    let candidates: Vec<ObjectId> = doc
        .objects
        .iter()
        .filter(|(_, o)| matches!(o, Object::Stream(s) if s.dict.has(b"Width")))
        .map(|(id, _)| *id)
        .collect();

    let mut stats = ImageStats::default();
    for id in candidates {
        let Some(new) = recompress(doc, id, &masks, params, &mut stats) else { continue };
        if let Some(Object::Stream(stream)) = doc.objects.get_mut(&id) {
            stream.dict.set("Filter", "DCTDecode");
            stream.dict.remove(b"DecodeParms");
            stream.dict.set("Width", i64::from(new.width));
            stream.dict.set("Height", i64::from(new.height));
            stream.set_content(new.jpeg);
            stream.allows_compression = false;
            stats.replaced += 1;
        }
    }
    stats
}

fn strip_thumbnails(doc: &mut Document) {
    for object in doc.objects.values_mut() {
        if let Object::Dictionary(dict) = object {
            if dict.get(b"Type").and_then(Object::as_name).ok() == Some(b"Page".as_slice()) {
                dict.remove(b"Thumb");
            }
        }
    }
}

/// Compresses `input` into `output`. If the result is not smaller than the
/// input, `output` is removed again and `kept` is false.
pub fn compress(input: &Path, output: &Path, level: Level) -> Result<Outcome, String> {
    let mut outcome = write_compressed(input, output, level)?;
    outcome.kept = outcome.after < outcome.before;
    if !outcome.kept {
        let _ = fs::remove_file(output);
    }
    Ok(outcome)
}

/// Writes the compressed file unconditionally; `kept` is left false for the
/// caller to decide.
fn write_compressed(input: &Path, output: &Path, level: Level) -> Result<Outcome, String> {
    let before = fs::metadata(input).map_err(|e| e.to_string())?.len();
    let mut doc = pdf::load(input)?;

    let images = match image_params(level) {
        Some(params) => recompress_images(&mut doc, &params),
        None => ImageStats::default(),
    };
    strip_thumbnails(&mut doc);
    doc.prune_objects();
    doc.delete_zero_length_streams();
    doc.renumber_objects();
    doc.compress();
    if doc.version.as_str() < "1.5" {
        doc.version = "1.5".to_string(); // object streams need 1.5
    }

    let mut writer = BufWriter::new(File::create(output).map_err(|e| e.to_string())?);
    doc.save_modern(&mut writer).map_err(|e| format!("Gagal menyimpan: {e}"))?;
    writer.flush().map_err(|e| e.to_string())?;
    drop(writer);

    let after = fs::metadata(output).map_err(|e| e.to_string())?.len();
    Ok(Outcome { before, after, images, kept: false })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressRequest {
    pub input: String,
    pub out_dir: Option<String>,
    pub level: Level,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressResult {
    pub before: u64,
    pub after: u64,
    /// Path of the new file, or null when compression did not make it smaller.
    pub output: Option<String>,
    pub images_considered: u32,
    pub images_replaced: u32,
}

#[tauri::command]
pub async fn pdf_compress(req: CompressRequest) -> Result<CompressResult, String> {
    if let Some(dir) = &req.out_dir {
        if !Path::new(dir).is_dir() {
            return Err(format!("Folder tujuan tidak ada: {dir}"));
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let input = PathBuf::from(&req.input);
        let dir = fsutil::output_dir(&input, req.out_dir.as_deref());
        let output = fsutil::unique_path(&dir, &format!("{}_compressed", fsutil::stem_of(&input)), "pdf");
        let outcome = compress(&input, &output, req.level)?;
        Ok(CompressResult {
            before: outcome.before,
            after: outcome.after,
            output: outcome.kept.then(|| output.to_string_lossy().into_owned()),
            images_considered: outcome.images.considered,
            images_replaced: outcome.images.replaced,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    /// Smooth gradient + a little noise: compresses badly with Flate and well
    /// with JPEG, like a photo does.
    fn photo(w: u32, h: u32, comps: usize) -> Vec<u8> {
        let mut seed: u32 = 12345;
        let mut out = Vec::with_capacity(w as usize * h as usize * comps);
        for y in 0..h {
            for x in 0..w {
                for c in 0..comps {
                    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                    let noise = ((seed >> 24) % 13) as i32 - 6;
                    let wave = (((x + y) as f32 * 0.02 + c as f32).sin() * 25.0) as i32;
                    let base = (x * 200 / w) as i32 + (y * 50 / h) as i32 + wave + 20;
                    out.push((base + noise).clamp(0, 255) as u8);
                }
            }
        }
        out
    }

    fn image_dict(tag: &str, w: u32, h: u32, cs: Object) -> Dictionary {
        dictionary! {
            "Type" => "XObject", "Subtype" => "Image", "Tag" => Object::string_literal(tag),
            "Width" => i64::from(w), "Height" => i64::from(h),
            "ColorSpace" => cs, "BitsPerComponent" => 8,
        }
    }

    fn flate_image(tag: &str, w: u32, h: u32, cs: Object, raw: Vec<u8>) -> Stream {
        let mut s = Stream::new(image_dict(tag, w, h, cs), raw);
        s.compress().unwrap();
        s
    }

    fn jpeg_image(tag: &str, w: u32, h: u32, jpeg: Vec<u8>) -> Stream {
        let mut dict = image_dict(tag, w, h, "DeviceRGB".into());
        dict.set("Filter", "DCTDecode");
        let mut s = Stream::new(dict, jpeg);
        s.allows_compression = false;
        s
    }

    fn encode_jpeg(raw: &[u8], w: u32, h: u32, quality: u8) -> Vec<u8> {
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, quality)
            .encode(raw, w, h, ExtendedColorType::Rgb8)
            .unwrap();
        out
    }

    /// One-page PDF that draws every given image.
    fn make_pdf(dir: &Path, name: &str, images: Vec<Stream>) -> PathBuf {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let mut xobjects = Dictionary::new();
        let mut content = String::new();
        for (i, s) in images.into_iter().enumerate() {
            let id = doc.add_object(s);
            xobjects.set(format!("Im{i}"), id);
            content.push_str(&format!("q 200 0 0 150 0 0 cm /Im{i} Do Q\n"));
        }
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => content_id,
            "MediaBox" => vec![0.into(), 0.into(), 600.into(), 800.into()],
            "Resources" => dictionary! { "XObject" => xobjects },
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1,
            }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let path = dir.join(name);
        doc.save(&path).unwrap();
        path
    }

    fn workdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("toolbox-compress-test-{}-{tag}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// (filter, width, height, stream length) of the image carrying `tag`.
    fn image_info(path: &Path, tag: &str) -> (String, i64, i64, usize) {
        let doc = Document::load(path).unwrap();
        for object in doc.objects.values() {
            if let Object::Stream(s) = object {
                if s.dict.get(b"Tag").and_then(Object::as_str).ok() == Some(tag.as_bytes()) {
                    let filter = s.filters().ok().and_then(|f| f.first().map(|n| String::from_utf8_lossy(n).into_owned()));
                    return (
                        filter.unwrap_or_default(),
                        s.dict.get(b"Width").unwrap().as_i64().unwrap(),
                        s.dict.get(b"Height").unwrap().as_i64().unwrap(),
                        s.content.len(),
                    );
                }
            }
        }
        panic!("no image tagged {tag}");
    }

    fn run(input: &Path, level: Level) -> (Outcome, PathBuf) {
        let output = input.with_extension(format!("{level:?}.pdf"));
        (compress(input, &output, level).unwrap(), output)
    }

    #[test]
    fn balanced_turns_a_flate_photo_into_a_much_smaller_valid_jpeg() {
        let dir = workdir("photo");
        let (w, h) = (1800, 1200);
        let src = make_pdf(&dir, "photo.pdf", vec![flate_image("p", w, h, "DeviceRGB".into(), photo(w, h, 3))]);

        let (out, path) = run(&src, Level::Balanced);
        assert!(out.kept);
        assert_eq!((out.images.considered, out.images.replaced), (1, 1));
        assert!(out.after * 2 < out.before, "{} -> {}", out.before, out.after);

        let (filter, nw, nh, _) = image_info(&path, "p");
        assert_eq!((filter.as_str(), nw, nh), ("DCTDecode", 1800, 1200)); // under the 2000px cap: not resized
        assert_eq!(Document::load(&path).unwrap().get_pages().len(), 1);

        // the stored JPEG really decodes to the declared size
        let doc = Document::load(&path).unwrap();
        let jpeg = doc.objects.values().find_map(|o| match o {
            Object::Stream(s) if s.dict.has(b"Tag") => Some(s.content.clone()),
            _ => None,
        });
        let img = image::load_from_memory_with_format(&jpeg.unwrap(), ImageFormat::Jpeg).unwrap();
        assert_eq!((img.width(), img.height()), (1800, 1200));
    }

    #[test]
    fn strong_also_caps_the_pixel_size_and_keeps_the_aspect_ratio() {
        let dir = workdir("strong");
        let (w, h) = (1800, 1200);
        let src = make_pdf(&dir, "photo.pdf", vec![flate_image("p", w, h, "DeviceRGB".into(), photo(w, h, 3))]);

        let (out, path) = run(&src, Level::Strong);
        let (filter, nw, nh, _) = image_info(&path, "p");
        assert_eq!(filter, "DCTDecode");
        assert_eq!((nw, nh), (1400, 933));
        let (balanced, _) = run(&src, Level::Balanced);
        assert!(out.after < balanced.after, "strong must be smaller than balanced");
    }

    #[test]
    fn lossless_never_touches_pixels() {
        let dir = workdir("lossless");
        let (w, h) = (1800, 1200);
        let raw = photo(w, h, 3);
        let src = make_pdf(&dir, "photo.pdf", vec![flate_image("p", w, h, "DeviceRGB".into(), raw.clone())]);

        // write_compressed, not compress: a lossless pass over an already
        // well-formed file may not shrink it, and compress() would then delete it
        let path = src.with_extension("lossless.pdf");
        let out = write_compressed(&src, &path, Level::Lossless).unwrap();
        assert_eq!(out.images.replaced, 0);
        let (filter, nw, nh, _) = image_info(&path, "p");
        assert_eq!((filter.as_str(), nw, nh), ("FlateDecode", 1800, 1200));

        let doc = Document::load(&path).unwrap();
        let bytes = doc.objects.values().find_map(|o| match o {
            Object::Stream(s) if s.dict.has(b"Tag") => Some(s.decompressed_content().unwrap()),
            _ => None,
        });
        assert_eq!(bytes.unwrap(), raw, "lossless output must decode to identical pixels");
    }

    #[test]
    fn jpeg_sources_are_recompressed_too() {
        let dir = workdir("dct");
        let (w, h) = (2400, 1600);
        let jpeg = encode_jpeg(&photo(w, h, 3), w, h, 98);
        let src = make_pdf(&dir, "dct.pdf", vec![jpeg_image("j", w, h, jpeg.clone())]);

        let (out, path) = run(&src, Level::Balanced);
        assert_eq!(out.images.replaced, 1);
        let (filter, nw, nh, len) = image_info(&path, "j");
        assert_eq!((filter.as_str(), nw, nh), ("DCTDecode", 2000, 1333));
        assert!(len < jpeg.len() / 2);
    }

    #[test]
    fn palette_flat_and_mask_images_are_left_alone() {
        let dir = workdir("skip");
        let (w, h) = (1800, 1200);

        // big palette image: skipped because of its colour space, not its size
        let palette: Vec<u8> = (0..=255u32).flat_map(|i| [i as u8, (255 - i) as u8, (i / 2) as u8]).collect();
        let indexed_cs = Object::Array(vec!["Indexed".into(), "DeviceRGB".into(), 255.into(), Object::string_literal(palette)]);
        let indices: Vec<u8> = photo(w, h, 1);
        let indexed = flate_image("indexed", w, h, indexed_cs, indices);

        // flat graphic: Flate stores it in a few KB, below the size floor
        let flat = flate_image("flat", 1600, 1200, "DeviceRGB".into(), vec![200u8; 1600 * 1200 * 3]);

        // photo with an alpha mask: the photo shrinks, the mask must not change
        let alpha = flate_image("alpha", w, h, "DeviceGray".into(), photo(w, h, 1));
        let alpha_len = alpha.content.len();
        let mut base = flate_image("base", w, h, "DeviceRGB".into(), photo(w, h, 3));

        let mut doc = Document::with_version("1.5");
        let alpha_id = doc.add_object(alpha);
        base.dict.set("SMask", alpha_id);
        let base_id = doc.add_object(base);
        let indexed_id = doc.add_object(indexed);
        let flat_id = doc.add_object(flat);

        // assemble a page referencing all of them
        let pages_id = doc.new_object_id();
        let xobjects = dictionary! { "A" => base_id, "B" => indexed_id, "C" => flat_id };
        let content_id = doc.add_object(Stream::new(dictionary! {}, b"q 100 0 0 100 0 0 cm /A Do /B Do /C Do Q".to_vec()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => content_id,
            "MediaBox" => vec![0.into(), 0.into(), 600.into(), 800.into()],
            "Resources" => dictionary! { "XObject" => xobjects },
        });
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! {
            "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1,
        }));
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let src = dir.join("mixed.pdf");
        doc.save(&src).unwrap();

        let (out, path) = run(&src, Level::Strong);
        assert_eq!(out.images.replaced, 1, "only the photo should be replaced");

        assert_eq!(image_info(&path, "base").0, "DCTDecode");
        let (f, nw, nh, len) = image_info(&path, "alpha");
        assert_eq!((f.as_str(), nw, nh, len), ("FlateDecode", 1800, 1200, alpha_len), "SMask must be untouched");
        assert_eq!(image_info(&path, "indexed").0, "FlateDecode");
        assert_eq!(image_info(&path, "flat").0, "FlateDecode");
    }

    /// Real-world smoke test, skipped unless asked for:
    ///   TOOLBOX_SAMPLE_PDFS=a.pdf:b.pdf TOOLBOX_OUT=/some/dir cargo test real_world_compress -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_world_compress() {
        let (Ok(samples), Ok(out)) = (std::env::var("TOOLBOX_SAMPLE_PDFS"), std::env::var("TOOLBOX_OUT")) else {
            panic!("set TOOLBOX_SAMPLE_PDFS (colon separated) and TOOLBOX_OUT");
        };
        for sample in samples.split(':') {
            let input = PathBuf::from(sample);
            let stem = input.file_stem().unwrap().to_string_lossy().into_owned();
            for level in [Level::Lossless, Level::Balanced, Level::Strong] {
                let output = PathBuf::from(&out).join(format!("{stem}.{level:?}.pdf"));
                let started = std::time::Instant::now();
                let o = compress(&input, &output, level).unwrap();
                println!(
                    "{stem} {level:?}: {} -> {} KB ({:+.1}%) images {}/{} kept={} in {:.1}s",
                    o.before / 1024,
                    o.after / 1024,
                    (o.after as f64 / o.before as f64 - 1.0) * 100.0,
                    o.images.replaced,
                    o.images.considered,
                    o.kept,
                    started.elapsed().as_secs_f64()
                );
            }
        }
    }

    #[test]
    fn output_exists_exactly_when_it_is_smaller() {
        let dir = workdir("keep");
        let (w, h) = (1800, 1200);
        let src = make_pdf(&dir, "photo.pdf", vec![flate_image("p", w, h, "DeviceRGB".into(), photo(w, h, 3))]);

        let (first, first_path) = run(&src, Level::Balanced);
        assert!(first.kept && first_path.exists());

        // squeezing an already squeezed file: whatever happens, state must be consistent
        let (second, second_path) = run(&first_path, Level::Balanced);
        assert_eq!(second.kept, second.after < second.before);
        assert_eq!(second_path.exists(), second.kept);
    }
}
