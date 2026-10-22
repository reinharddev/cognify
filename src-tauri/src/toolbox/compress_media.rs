//! Image and video compression on the bundled ffmpeg.
//!
//! Both tools only keep their output when it is actually smaller than the
//! input, so "compress" never silently makes a file bigger.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::sync::oneshot;

use crate::toolbox::{
    convert::MISSING_FFMPEG,
    engine, ffmpeg,
    ffmpeg::{Jobs, RunError},
    fsutil,
};

fn os(items: &[&str]) -> Vec<OsString> {
    items.iter().map(OsString::from).collect()
}

fn check_out_dir(dir: &Option<String>) -> Result<(), String> {
    match dir {
        Some(d) if !Path::new(d).is_dir() => Err(format!("Folder tujuan tidak ada: {d}")),
        _ => Ok(()),
    }
}

fn size_of(path: &Path) -> Result<u64, String> {
    std::fs::metadata(path).map(|m| m.len()).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- images ---

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSpec {
    /// "same", "jpg", "webp" or "png"
    pub format: String,
    /// 1-100, ignored for PNG (lossless)
    pub quality: u8,
    /// Cap for the longer side in pixels; None keeps the original size.
    pub max_side: Option<u32>,
    pub strip_metadata: bool,
}

/// "same" keeps JPEG/PNG/WebP as they are; other inputs (BMP, TIFF) become JPEG.
fn resolve_format(requested: &str, input_ext: &str) -> Option<&'static str> {
    Some(match requested {
        "jpg" => "jpg",
        "webp" => "webp",
        "png" => "png",
        "same" => match input_ext {
            "png" => "png",
            "webp" => "webp",
            _ => "jpg",
        },
        _ => return None,
    })
}

/// ffmpeg arguments (after global options) for one image.
fn image_args(input: &Path, output: &Path, format: &str, input_ext: &str, spec: &ImageSpec) -> Vec<OsString> {
    let mut filters: Vec<String> = Vec::new();
    if let Some(m) = spec.max_side {
        // long side capped at m, aspect ratio kept, never upscaled
        filters.push(format!(
            "scale=w='if(gt(iw,ih),min({m},iw),-1)':h='if(gt(iw,ih),-1,min({m},ih))':flags=lanczos"
        ));
    }
    let mut vf = filters.join(",");
    // JPEG has no alpha: composite transparent areas onto white instead of black.
    if format == "jpg" && matches!(input_ext, "png" | "webp") {
        if !vf.is_empty() {
            vf.push(',');
        }
        vf.push_str("split[a][b];[a]drawbox=c=white:t=fill[bg];[bg][b]overlay=format=auto");
    }

    let mut args: Vec<OsString> = vec!["-i".into(), input.into()];
    if !vf.is_empty() {
        args.push("-vf".into());
        args.push(vf.into());
    }
    args.extend(os(&["-frames:v", "1"]));

    let q = spec.quality.clamp(1, 100);
    match format {
        // mjpeg's qscale runs 2 (best) to 31 (worst)
        "jpg" => args.extend(os(&["-q:v", &(2 + (100 - u32::from(q)) * 29 / 100).to_string()])),
        "webp" => args.extend(os(&["-quality", &q.to_string(), "-compression_level", "6"])),
        _ => args.extend(os(&["-compression_level", "9", "-pred", "mixed"])),
    }
    if spec.strip_metadata {
        args.extend(os(&["-map_metadata", "-1"]));
    }
    args.push(output.into());
    args
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressImageRequest {
    pub job_id: String,
    pub input: String,
    pub out_dir: Option<String>,
    #[serde(flatten)]
    pub spec: ImageSpec,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressImageResult {
    pub before: u64,
    pub after: u64,
    /// None when the result was not smaller than the original.
    pub output: Option<String>,
}

#[tauri::command]
pub async fn compress_image(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    req: CompressImageRequest,
) -> Result<CompressImageResult, String> {
    let input = PathBuf::from(&req.input);
    if !input.is_file() {
        return Err(format!("File tidak ditemukan: {}", req.input));
    }
    check_out_dir(&req.out_dir)?;
    if req.spec.max_side.is_some_and(|m| !(16..=16384).contains(&m)) {
        return Err("Ukuran maksimal harus antara 16 dan 16384 piksel".into());
    }
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let format = resolve_format(&req.spec.format, &ext).ok_or_else(|| format!("Format tidak didukung: {}", req.spec.format))?;
    let ffmpeg_bin = engine::resolve(&app, "ffmpeg").ok_or_else(|| MISSING_FFMPEG.to_string())?;

    let dir = fsutil::output_dir(&input, req.out_dir.as_deref());
    let output = fsutil::unique_path(&dir, &format!("{}_compressed", fsutil::stem_of(&input)), format);
    let args = image_args(&input, &output, format, &ext, &req.spec);

    let mut cancel = jobs.register(&req.job_id);
    let result = ffmpeg::run(&ffmpeg_bin, &args, None, &mut cancel, |_| {}).await;
    jobs.finish(&req.job_id);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&output);
        return Err(e.into_message());
    }

    let (before, after) = (size_of(&input)?, size_of(&output)?);
    let kept = after < before;
    if !kept {
        let _ = std::fs::remove_file(&output);
    }
    Ok(CompressImageResult { before, after, output: kept.then(|| output.to_string_lossy().into_owned()) })
}

// ----------------------------------------------------------------- video ---

/// Container overhead (headers, index) we leave room for.
const OVERHEAD: f64 = 0.97;
/// Below this the picture is not watchable, so refuse instead of pretending.
const MIN_VIDEO_KBPS: f64 = 80.0;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub duration_sec: f64,
    pub source_bytes: u64,
    pub target_bytes: u64,
    pub audio_kbps: u32,
    pub video_kbps: u32,
    pub source_short_side: u32,
    /// Short-side cap that will be applied; None keeps the original resolution.
    pub cap_short_side: Option<u32>,
    pub feasible: bool,
    /// Smallest target (bytes) that still leaves a usable picture.
    pub min_target_bytes: u64,
    pub already_smaller: bool,
}

/// Resolution that a given video bitrate can sustain without turning to mush.
/// A rule of thumb, not a measurement.
fn auto_cap(video_kbps: f64) -> u32 {
    match video_kbps {
        k if k >= 3000.0 => 1080,
        k if k >= 1500.0 => 720,
        k if k >= 600.0 => 480,
        _ => 360,
    }
}

fn audio_kbps_for(total_kbps: f64) -> f64 {
    (total_kbps * 0.12).round().clamp(48.0, 128.0).min(total_kbps / 2.0)
}

/// `resolution`: "auto", "original", or a short-side size such as "720".
pub fn plan(
    duration_sec: f64,
    source_bytes: u64,
    has_audio: bool,
    source_short_side: u32,
    target_bytes: u64,
    resolution: &str,
) -> Plan {
    let total_kbps = target_bytes as f64 * 8.0 / 1000.0 / duration_sec;
    let audio = if has_audio { audio_kbps_for(total_kbps) } else { 0.0 };
    let video = total_kbps * OVERHEAD - audio;

    let min_audio = if has_audio { 48.0 } else { 0.0 };
    let min_total_kbps = (MIN_VIDEO_KBPS + min_audio) / OVERHEAD;
    let min_target = (min_total_kbps * 1000.0 / 8.0 * duration_sec).ceil() as u64;

    let wanted = match resolution {
        "original" => None,
        "auto" => Some(auto_cap(video)),
        n => n.parse::<u32>().ok().map(|v| v.clamp(144, 2160)),
    };
    // never upscale: only cap when the source is larger
    let cap_short_side = wanted.filter(|c| source_short_side > *c);

    Plan {
        duration_sec,
        source_bytes,
        target_bytes,
        audio_kbps: audio.round() as u32,
        video_kbps: video.max(0.0).round() as u32,
        source_short_side,
        cap_short_side,
        feasible: video >= MIN_VIDEO_KBPS,
        min_target_bytes: min_target,
        already_smaller: source_bytes <= target_bytes,
    }
}

fn video_filter(cap: Option<u32>) -> String {
    match cap {
        // short side capped at c, other side follows (and stays even for x264)
        Some(c) => format!("scale=w='if(lt(iw,ih),min({c},iw),-2)':h='if(lt(iw,ih),-2,min({c},ih))':flags=lanczos"),
        None => "scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string(),
    }
}

fn null_device() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
}

/// Two-pass H.264 so the file lands close to the requested size. Progress is
/// reported as 0-50 for the analysis pass and 50-99 for the encode.
#[allow(clippy::too_many_arguments)]
async fn encode_two_pass(
    ffmpeg_bin: &Path,
    input: &Path,
    output: &Path,
    plan: &Plan,
    has_audio: bool,
    pass_dir: &Path,
    cancel: &mut oneshot::Receiver<()>,
    mut on_progress: impl FnMut(f64),
) -> Result<(), RunError> {
    std::fs::create_dir_all(pass_dir).map_err(|e| RunError::Failed(e.to_string()))?;
    let log = pass_dir.join("ff2pass");
    let vf = video_filter(plan.cap_short_side);
    let vkbps = format!("{}k", plan.video_kbps);

    let video_args = |pass: &str| -> Vec<OsString> {
        let mut a = os(&["-i"]);
        a.push(input.into());
        a.extend(os(&["-map", "0:v:0"]));
        if pass == "2" && has_audio {
            a.extend(os(&["-map", "0:a:0"]));
        }
        a.extend(os(&["-vf", &vf, "-c:v", "libx264", "-b:v", &vkbps, "-preset", "medium", "-pix_fmt", "yuv420p", "-pass", pass, "-passlogfile"]));
        a.push(log.clone().into());
        a
    };

    let mut pass1 = video_args("1");
    pass1.extend(os(&["-an", "-f", "null", null_device()]));
    let first = ffmpeg::run(ffmpeg_bin, &pass1, Some(plan.duration_sec), cancel, |p| on_progress(p / 2.0)).await;

    let result = match first {
        Err(e) => Err(e),
        Ok(()) => {
            let mut pass2 = video_args("2");
            if has_audio {
                pass2.extend(os(&["-c:a", "aac", "-b:a", &format!("{}k", plan.audio_kbps)]));
            } else {
                pass2.push("-an".into());
            }
            pass2.extend(os(&["-movflags", "+faststart"]));
            pass2.push(output.into());
            ffmpeg::run(ffmpeg_bin, &pass2, Some(plan.duration_sec), cancel, |p| on_progress(50.0 + p / 2.0)).await
        }
    };
    let _ = std::fs::remove_dir_all(pass_dir);
    result
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPlanRequest {
    pub input: String,
    pub target_mb: f64,
    pub resolution: String,
}

fn target_bytes(mb: f64) -> Result<u64, String> {
    if !mb.is_finite() || mb < 0.1 {
        return Err("Ukuran target minimal 0,1 MB".into());
    }
    Ok((mb * 1024.0 * 1024.0) as u64)
}

async fn probe_for_plan(app: &AppHandle, input: &Path, target: u64, resolution: &str) -> Result<(Plan, bool), String> {
    if !input.is_file() {
        return Err(format!("File tidak ditemukan: {}", input.display()));
    }
    let ffprobe = engine::resolve(app, "ffprobe").ok_or_else(|| MISSING_FFMPEG.to_string())?;
    let info = ffmpeg::probe(&ffprobe, input).await.ok_or("File ini tidak terbaca sebagai video")?;
    let duration = info.duration.ok_or("Durasi video tidak terbaca")?;
    let short = info.width.zip(info.height).map(|(w, h)| w.min(h)).ok_or("Ini bukan file video")?;
    Ok((plan(duration, size_of(input)?, info.has_audio, short, target, resolution), info.has_audio))
}

/// What a compression would do, without doing it. Lets the UI show the
/// resulting bitrate and resolution (and warn when the target is too small).
#[tauri::command]
pub async fn video_plan(app: AppHandle, req: VideoPlanRequest) -> Result<Plan, String> {
    let target = target_bytes(req.target_mb)?;
    Ok(probe_for_plan(&app, Path::new(&req.input), target, &req.resolution).await?.0)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressVideoRequest {
    pub job_id: String,
    pub input: String,
    pub out_dir: Option<String>,
    pub target_mb: f64,
    pub resolution: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressVideoResult {
    pub before: u64,
    pub after: u64,
    pub target: u64,
    /// None when no file was produced; see `reason`.
    pub output: Option<String>,
    /// "alreadySmaller" (input is already under the target) or "notSmaller".
    pub reason: Option<&'static str>,
    pub video_kbps: u32,
    pub cap_short_side: Option<u32>,
}

#[tauri::command]
pub async fn compress_video(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    req: CompressVideoRequest,
) -> Result<CompressVideoResult, String> {
    check_out_dir(&req.out_dir)?;
    let input = PathBuf::from(&req.input);
    let target = target_bytes(req.target_mb)?;
    let ffmpeg_bin = engine::resolve(&app, "ffmpeg").ok_or_else(|| MISSING_FFMPEG.to_string())?;
    let (plan, has_audio) = probe_for_plan(&app, &input, target, &req.resolution).await?;

    let result = |output: Option<String>, after: u64, reason| CompressVideoResult {
        before: plan.source_bytes,
        after,
        target,
        output,
        reason,
        video_kbps: plan.video_kbps,
        cap_short_side: plan.cap_short_side,
    };

    if plan.already_smaller {
        return Ok(result(None, plan.source_bytes, Some("alreadySmaller")));
    }
    if !plan.feasible {
        return Err(format!(
            "Target terlalu kecil untuk video sepanjang {} detik. Minimal sekitar {:.1} MB.",
            plan.duration_sec.round(),
            plan.min_target_bytes as f64 / 1024.0 / 1024.0
        ));
    }

    let dir = fsutil::output_dir(&input, req.out_dir.as_deref());
    let output = fsutil::unique_path(&dir, &format!("{}_compressed", fsutil::stem_of(&input)), "mp4");
    let pass_dir = std::env::temp_dir().join(format!("toolbox-pass-{}", req.job_id));

    let mut cancel = jobs.register(&req.job_id);
    let run = encode_two_pass(&ffmpeg_bin, &input, &output, &plan, has_audio, &pass_dir, &mut cancel, |p| {
        ffmpeg::emit_progress(&app, &req.job_id, p)
    })
    .await;
    jobs.finish(&req.job_id);

    if let Err(e) = run {
        let _ = std::fs::remove_file(&output);
        return Err(e.into_message());
    }
    ffmpeg::emit_progress(&app, &req.job_id, 100.0);

    let after = size_of(&output)?;
    if after >= plan.source_bytes {
        let _ = std::fs::remove_file(&output);
        return Ok(result(None, after, Some("notSmaller")));
    }
    Ok(result(Some(output.to_string_lossy().into_owned()), after, None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::toolbox::ffmpeg::testutil;
    use std::process::Command;

    const MB: u64 = 1024 * 1024;

    // ---- pure planning math

    #[test]
    fn plan_budget_and_resolution_follow_the_target() {
        // 60 s, 16 MB -> ~2.2 Mbit/s total: fits 720p, not 1080p
        let p = plan(60.0, 200 * MB, true, 1080, 16 * MB, "auto");
        assert!(p.feasible && !p.already_smaller);
        assert_eq!(p.audio_kbps, 128);
        assert!((1800..2100).contains(&p.video_kbps), "{}", p.video_kbps);
        assert_eq!(p.cap_short_side, Some(720));

        // generous budget keeps the original resolution
        let p = plan(30.0, 500 * MB, true, 1080, 100 * MB, "auto");
        assert_eq!(p.cap_short_side, None);

        // never upscales: a 480p source asked for 720p stays as is
        assert_eq!(plan(30.0, 50 * MB, true, 480, 10 * MB, "720").cap_short_side, None);
        // explicit choice is honoured, and "original" never caps
        assert_eq!(plan(30.0, 500 * MB, true, 1080, 100 * MB, "480").cap_short_side, Some(480));
        assert_eq!(plan(30.0, 500 * MB, true, 1080, 1 * MB, "original").cap_short_side, None);
    }

    #[test]
    fn plan_flags_impossible_and_trivial_targets() {
        // 10 minutes into 1 MB is ~13 kbit/s: not feasible, and it says how much is needed
        let p = plan(600.0, 300 * MB, true, 1080, MB, "auto");
        assert!(!p.feasible);
        let again = plan(600.0, 300 * MB, true, 1080, p.min_target_bytes, "auto");
        assert!(again.feasible, "min_target_bytes must itself be feasible");

        assert!(plan(30.0, 5 * MB, true, 720, 10 * MB, "auto").already_smaller);
        // no audio track: the whole budget goes to the picture
        let silent = plan(60.0, 200 * MB, false, 1080, 16 * MB, "auto");
        assert_eq!(silent.audio_kbps, 0);
        assert!(silent.video_kbps > plan(60.0, 200 * MB, true, 1080, 16 * MB, "auto").video_kbps);
    }

    #[test]
    fn image_args_resize_flatten_and_quality() {
        let spec = |format: &str, q, max| ImageSpec { format: format.into(), quality: q, max_side: max, strip_metadata: true };
        let text = |a: Vec<OsString>| a.iter().map(|s| s.to_string_lossy().into_owned()).collect::<Vec<_>>().join(" ");

        let jpg = text(image_args(Path::new("a.png"), Path::new("o.jpg"), "jpg", "png", &spec("jpg", 80, Some(1200))));
        assert!(jpg.contains("min(1200,iw)") && jpg.contains("overlay=format=auto") && jpg.contains("-map_metadata -1"));
        assert!(jpg.contains("-q:v 7"), "{jpg}"); // quality 80 -> 2 + 20*29/100 = 7 (integer math)
        assert!(text(image_args(Path::new("a.jpg"), Path::new("o.jpg"), "jpg", "jpg", &spec("jpg", 100, None))).contains("-q:v 2"));
        assert!(text(image_args(Path::new("a.jpg"), Path::new("o.jpg"), "jpg", "jpg", &spec("jpg", 1, None))).contains("-q:v 30"));
        // jpg->jpg needs no alpha flattening
        assert!(!text(image_args(Path::new("a.jpg"), Path::new("o.jpg"), "jpg", "jpg", &spec("jpg", 80, None))).contains("overlay"));
        assert!(text(image_args(Path::new("a.png"), Path::new("o.webp"), "webp", "png", &spec("webp", 70, None))).contains("-quality 70"));

        assert_eq!(resolve_format("same", "bmp"), Some("jpg"));
        assert_eq!(resolve_format("same", "png"), Some("png"));
        assert_eq!(resolve_format("nope", "png"), None);
    }

    // ---- real ffmpeg

    fn ff(args: &[&str]) -> Vec<u8> {
        let (ffmpeg, _) = testutil::engines().unwrap();
        let out = Command::new(ffmpeg).args(["-hide_banner", "-loglevel", "error", "-y"]).args(args).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        out.stdout
    }

    async fn dims_of(path: &Path) -> (u32, u32) {
        let (_, ffprobe) = testutil::engines().unwrap();
        let i = ffmpeg::probe(&ffprobe, path).await.unwrap();
        (i.width.unwrap(), i.height.unwrap())
    }

    #[tokio::test]
    async fn images_shrink_keep_aspect_and_flatten_alpha_on_white() {
        let Some((ffmpeg_bin, _)) = testutil::engines() else { return eprintln!("skipped: no ffmpeg") };
        let dir = testutil::workdir("img");

        // photo-like source
        let photo = dir.join("photo.jpg");
        ff(&["-f", "lavfi", "-i", "testsrc2=size=2400x1600", "-frames:v", "1", "-q:v", "2", photo.to_str().unwrap()]);
        let spec = ImageSpec { format: "same".into(), quality: 60, max_side: Some(1200), strip_metadata: true };
        let out = dir.join("photo_out.jpg");
        let (_keep, mut rx) = oneshot::channel::<()>();
        ffmpeg::run(&ffmpeg_bin, &image_args(&photo, &out, "jpg", "jpg", &spec), None, &mut rx, |_| {}).await.unwrap();
        assert_eq!(dims_of(&out).await, (1200, 800));
        assert!(size_of(&out).unwrap() < size_of(&photo).unwrap() / 2);

        // never upscales
        let small = ImageSpec { max_side: Some(4000), ..spec.clone() };
        let same = dir.join("photo_same.jpg");
        ffmpeg::run(&ffmpeg_bin, &image_args(&photo, &same, "jpg", "jpg", &small), None, &mut rx, |_| {}).await.unwrap();
        assert_eq!(dims_of(&same).await, (2400, 1600));

        // fully transparent PNG -> JPG must come out white, not black
        let clear = dir.join("clear.png");
        ff(&["-f", "lavfi", "-i", "color=c=red@0.0:s=400x300,format=rgba", "-frames:v", "1", clear.to_str().unwrap()]);
        let flat = dir.join("clear.jpg");
        ffmpeg::run(&ffmpeg_bin, &image_args(&clear, &flat, "jpg", "png", &spec), None, &mut rx, |_| {}).await.unwrap();
        let px = ff(&["-i", flat.to_str().unwrap(), "-vf", "crop=1:1:10:10", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
        assert!(px.len() == 3 && px.iter().all(|c| *c >= 245), "expected near-white, got {px:?}");
    }

    /// Real-world smoke test, skipped unless asked for:
    ///   TOOLBOX_VIDEO=in.mp4 TOOLBOX_TARGET_MB=5 TOOLBOX_OUT=/some/dir cargo test real_world_video -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn real_world_video() {
        let (ffmpeg_bin, ffprobe) = testutil::engines().expect("no ffmpeg");
        let input = PathBuf::from(std::env::var("TOOLBOX_VIDEO").expect("TOOLBOX_VIDEO"));
        let mb: f64 = std::env::var("TOOLBOX_TARGET_MB").expect("TOOLBOX_TARGET_MB").parse().unwrap();
        let out_dir = PathBuf::from(std::env::var("TOOLBOX_OUT").expect("TOOLBOX_OUT"));

        let info = ffmpeg::probe(&ffprobe, &input).await.unwrap();
        let short = info.width.unwrap().min(info.height.unwrap());
        let target = target_bytes(mb).unwrap();
        let p = plan(info.duration.unwrap(), size_of(&input).unwrap(), info.has_audio, short, target, "auto");
        println!("plan: {p:?}");

        let output = out_dir.join("out.mp4");
        let (_keep, mut rx) = oneshot::channel::<()>();
        let started = std::time::Instant::now();
        encode_two_pass(&ffmpeg_bin, &input, &output, &p, info.has_audio, &out_dir.join("pass"), &mut rx, |_| {}).await.unwrap();
        let after = size_of(&output).unwrap();
        let o = ffmpeg::probe(&ffprobe, &output).await.unwrap();
        println!(
            "{:.1} MB -> {:.2} MB (target {mb} MB, {:.0}% of target) in {:.1}s; {}x{} -> {}x{}; audio {}",
            p.source_bytes as f64 / 1048576.0, after as f64 / 1048576.0, after as f64 / target as f64 * 100.0,
            started.elapsed().as_secs_f64(), info.width.unwrap(), info.height.unwrap(), o.width.unwrap(), o.height.unwrap(), o.has_audio
        );
    }

    #[tokio::test]
    async fn video_lands_near_the_target_size_and_keeps_audio() {
        let Some((ffmpeg_bin, ffprobe)) = testutil::engines() else { return eprintln!("skipped: no ffmpeg") };
        let dir = testutil::workdir("vid");

        let src = dir.join("src.mp4");
        ff(&["-f", "lavfi", "-i", "testsrc2=duration=20:size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=duration=20", "-shortest",
             "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-c:a", "aac", src.to_str().unwrap()]);
        let source_bytes = size_of(&src).unwrap();
        let target = 2 * MB;
        assert!(source_bytes > target * 2, "fixture must be much larger than the target ({source_bytes})");

        let info = ffmpeg::probe(&ffprobe, &src).await.unwrap();
        let p = plan(info.duration.unwrap(), source_bytes, info.has_audio, 720, target, "auto");
        assert!(p.feasible);

        let out = dir.join("out.mp4");
        let pass_dir = dir.join("pass");
        let (_keep, mut rx) = oneshot::channel::<()>();
        let mut seen = Vec::new();
        encode_two_pass(&ffmpeg_bin, &src, &out, &p, true, &pass_dir, &mut rx, |x| seen.push(x)).await.unwrap();

        let actual = size_of(&out).unwrap();
        let ratio = actual as f64 / target as f64;
        assert!((0.80..=1.05).contains(&ratio), "size {actual} is {ratio:.2}x the target");
        let o = ffmpeg::probe(&ffprobe, &out).await.unwrap();
        assert!(o.has_audio, "audio track must survive");
        assert!((o.duration.unwrap() - info.duration.unwrap()).abs() < 0.5);
        assert_eq!(o.width.unwrap().min(o.height.unwrap()), p.cap_short_side.unwrap_or(720));
        assert!(!pass_dir.exists(), "pass log directory must be cleaned up");
        assert!(seen.windows(2).filter(|w| w[1] + 0.001 < w[0]).count() <= 1, "progress runs 0-50 then 50-99: {seen:?}");
    }
}
