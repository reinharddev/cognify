//! Trim, join and frame preview for video, on the bundled ffmpeg.
//!
//! Both edits have a fast path that copies the streams without re-encoding
//! (no quality loss, near-instant) and a slower path that re-encodes:
//! - trim: "fast" cuts at keyframes, so the cut can land a few seconds early;
//!   "precise" re-encodes and is frame-accurate.
//! - join: copies only when every clip has identical codec parameters, and
//!   re-encodes (normalised to the first clip) when they differ.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::{process::Command, sync::oneshot};

use crate::toolbox::{
    convert::MISSING_FFMPEG,
    engine, ffmpeg,
    ffmpeg::{Jobs, MediaInfo},
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

fn ext_of(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).unwrap_or_else(|| "mp4".into())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub has_audio: bool,
    pub video_codec: String,
    pub audio_codec: Option<String>,
    pub fps: Option<f64>,
}

fn to_dto(info: &MediaInfo) -> Option<VideoInfo> {
    Some(VideoInfo {
        duration_sec: info.duration?,
        width: info.width?,
        height: info.height?,
        has_audio: info.has_audio,
        video_codec: info.video_codec.clone()?,
        audio_codec: info.audio_codec.clone(),
        fps: info.fps,
    })
}

async fn probe_video(app: &AppHandle, path: &Path) -> Result<MediaInfo, String> {
    if !path.is_file() {
        return Err(format!("File tidak ditemukan: {}", path.display()));
    }
    let ffprobe = engine::resolve(app, "ffprobe").ok_or_else(|| MISSING_FFMPEG.to_string())?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("?");
    let info = ffmpeg::probe(&ffprobe, path).await.ok_or_else(|| format!("{name}: tidak terbaca sebagai video"))?;
    if info.width.is_none() || info.duration.is_none() {
        return Err(format!("{name}: bukan file video"));
    }
    Ok(info)
}

#[tauri::command]
pub async fn video_info(app: AppHandle, path: String) -> Result<VideoInfo, String> {
    let info = probe_video(&app, Path::new(&path)).await?;
    to_dto(&info).ok_or_else(|| "Info video tidak lengkap".into())
}

// ------------------------------------------------------------------ trim ---

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrimMode {
    /// Stream copy: instant and lossless, but cuts at keyframes.
    Fast,
    /// Re-encode: frame-accurate, slower.
    Precise,
}

/// Clamps `end` to the video length and rejects ranges that are empty,
/// negative or entirely past the end.
pub fn validate_range(start: f64, end: f64, duration: f64) -> Result<(f64, f64), String> {
    if !start.is_finite() || !end.is_finite() || start < 0.0 {
        return Err("Waktu tidak valid".into());
    }
    let end = end.min(duration);
    if end - start < 0.1 {
        return Err(format!("Rentang terlalu pendek atau di luar durasi video ({:.1} detik)", duration));
    }
    Ok((start, end))
}

fn trim_args(input: &Path, output: &Path, start: f64, end: f64, mode: TrimMode) -> Vec<OsString> {
    let mut args = os(&["-ss", &format!("{start:.3}"), "-i"]);
    args.push(input.into());
    args.extend(os(&["-t", &format!("{:.3}", end - start)]));
    match mode {
        TrimMode::Fast => args.extend(os(&["-map", "0:v?", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero"])),
        TrimMode::Precise => args.extend(os(&[
            "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        ])),
    }
    args.push(output.into());
    args
}

async fn run_trim(
    ffmpeg_bin: &Path,
    input: &Path,
    output: &Path,
    start: f64,
    end: f64,
    mode: TrimMode,
    cancel: &mut oneshot::Receiver<()>,
    on_progress: impl FnMut(f64),
) -> Result<(), ffmpeg::RunError> {
    ffmpeg::run(ffmpeg_bin, &trim_args(input, output, start, end, mode), Some(end - start), cancel, on_progress).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimRequest {
    pub job_id: String,
    pub input: String,
    pub out_dir: Option<String>,
    pub start: f64,
    pub end: f64,
    pub mode: TrimMode,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditResult {
    pub output: String,
    /// Length the user asked for / expects, in seconds.
    pub expected_sec: f64,
    /// Length of the file that was actually written.
    pub actual_sec: f64,
    /// "copy" or "reencode"
    pub method: &'static str,
}

#[tauri::command]
pub async fn trim_video(app: AppHandle, jobs: State<'_, Jobs>, req: TrimRequest) -> Result<EditResult, String> {
    check_out_dir(&req.out_dir)?;
    let input = PathBuf::from(&req.input);
    let ffmpeg_bin = engine::resolve(&app, "ffmpeg").ok_or_else(|| MISSING_FFMPEG.to_string())?;
    let info = probe_video(&app, &input).await?;
    let (start, end) = validate_range(req.start, req.end, info.duration.unwrap())?;

    let ext = if req.mode == TrimMode::Fast { ext_of(&input) } else { "mp4".into() };
    let dir = fsutil::output_dir(&input, req.out_dir.as_deref());
    let output = fsutil::unique_path(&dir, &format!("{}_trim", fsutil::stem_of(&input)), &ext);

    let mut cancel = jobs.register(&req.job_id);
    let result = run_trim(&ffmpeg_bin, &input, &output, start, end, req.mode, &mut cancel, |p| {
        ffmpeg::emit_progress(&app, &req.job_id, p)
    })
    .await;
    jobs.finish(&req.job_id);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&output);
        return Err(e.into_message());
    }
    ffmpeg::emit_progress(&app, &req.job_id, 100.0);

    let actual = match engine::resolve(&app, "ffprobe") {
        Some(p) => ffmpeg::probe(&p, &output).await.and_then(|i| i.duration).unwrap_or(end - start),
        None => end - start,
    };
    Ok(EditResult {
        output: output.to_string_lossy().into_owned(),
        expected_sec: end - start,
        actual_sec: actual,
        method: if req.mode == TrimMode::Fast { "copy" } else { "reencode" },
    })
}

// ------------------------------------------------------------------ join ---

/// Why clips cannot simply be copied together. Empty means they can. The
/// strings are codes the frontend translates.
pub fn incompatibilities(infos: &[MediaInfo]) -> Vec<&'static str> {
    let mut reasons: Vec<&'static str> = Vec::new();
    let Some(first) = infos.first() else { return reasons };
    let mut add = |code: &'static str| {
        if !reasons.contains(&code) {
            reasons.push(code);
        }
    };
    for other in &infos[1..] {
        if other.video_codec != first.video_codec {
            add("videoCodec");
        }
        if (other.width, other.height) != (first.width, first.height) {
            add("resolution");
        }
        if other.pix_fmt != first.pix_fmt {
            add("pixFmt");
        }
        let fps_differs = match (first.fps, other.fps) {
            (Some(a), Some(b)) => (a - b).abs() > 0.01,
            _ => true,
        };
        if fps_differs {
            add("fps");
        }
        if other.has_audio != first.has_audio {
            add("audioMissing");
        } else if other.has_audio
            && (other.audio_codec != first.audio_codec || other.sample_rate != first.sample_rate || other.channels != first.channels)
        {
            add("audio");
        }
    }
    reasons
}

fn even(v: u32) -> u32 {
    (v & !1).max(2)
}

/// filter_complex that scales every clip into the first clip's frame (letterboxed),
/// matches the frame rate, gives silent clips a silent track, and concatenates.
fn join_filter(infos: &[MediaInfo]) -> String {
    let first = &infos[0];
    let (w, h) = (even(first.width.unwrap_or(1280)), even(first.height.unwrap_or(720)));
    let fps = first.fps.filter(|f| (1.0..=60.0).contains(f)).unwrap_or(30.0);
    let any_audio = infos.iter().any(|i| i.has_audio);

    let mut parts: Vec<String> = Vec::new();
    let mut concat_inputs = String::new();
    for (i, info) in infos.iter().enumerate() {
        parts.push(format!(
            "[{i}:v:0]scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps:.3},format=yuv420p[v{i}]"
        ));
        concat_inputs.push_str(&format!("[v{i}]"));
        if any_audio {
            if info.has_audio {
                parts.push(format!("[{i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a{i}]"));
            } else {
                parts.push(format!(
                    "anullsrc=r=48000:cl=stereo,atrim=duration={:.3},asetpts=PTS-STARTPTS[a{i}]",
                    info.duration.unwrap_or(0.0)
                ));
            }
            concat_inputs.push_str(&format!("[a{i}]"));
        }
    }
    let n = infos.len();
    let outs = if any_audio { "v=1:a=1[v][a]" } else { "v=1:a=0[v]" };
    parts.push(format!("{concat_inputs}concat=n={n}:{outs}"));
    parts.join(";")
}

/// `file 'path'` lines for ffmpeg's concat demuxer; single quotes are escaped.
fn concat_list(inputs: &[PathBuf]) -> String {
    inputs
        .iter()
        .map(|p| format!("file '{}'\n", p.to_string_lossy().replace('\'', "'\\''")))
        .collect()
}

#[allow(clippy::too_many_arguments)]
async fn run_join(
    ffmpeg_bin: &Path,
    inputs: &[PathBuf],
    infos: &[MediaInfo],
    output: &Path,
    copy: bool,
    work_dir: &Path,
    cancel: &mut oneshot::Receiver<()>,
    on_progress: impl FnMut(f64),
) -> Result<(), ffmpeg::RunError> {
    let total: f64 = infos.iter().filter_map(|i| i.duration).sum();
    let args: Vec<OsString> = if copy {
        std::fs::create_dir_all(work_dir).map_err(|e| ffmpeg::RunError::Failed(e.to_string()))?;
        let list = work_dir.join("list.txt");
        std::fs::write(&list, concat_list(inputs)).map_err(|e| ffmpeg::RunError::Failed(e.to_string()))?;
        let mut a = os(&["-f", "concat", "-safe", "0", "-i"]);
        a.push(list.into());
        a.extend(os(&["-map", "0:v?", "-map", "0:a?", "-c", "copy"]));
        if output.extension().is_some_and(|e| e == "mp4" || e == "mov" || e == "m4v") {
            a.extend(os(&["-movflags", "+faststart"]));
        }
        a.push(output.into());
        a
    } else {
        let mut a: Vec<OsString> = Vec::new();
        for input in inputs {
            a.push("-i".into());
            a.push(input.into());
        }
        let any_audio = infos.iter().any(|i| i.has_audio);
        a.extend(os(&["-filter_complex", &join_filter(infos), "-map", "[v]"]));
        if any_audio {
            a.extend(os(&["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]));
        }
        a.extend(os(&["-c:v", "libx264", "-crf", "20", "-preset", "medium", "-movflags", "+faststart"]));
        a.push(output.into());
        a
    };
    let result = ffmpeg::run(ffmpeg_bin, &args, Some(total), cancel, on_progress).await;
    if copy {
        let _ = std::fs::remove_dir_all(work_dir);
    }
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinPlan {
    pub items: Vec<VideoInfo>,
    pub compatible: bool,
    pub reasons: Vec<&'static str>,
    pub total_sec: f64,
}

async fn probe_all(app: &AppHandle, inputs: &[String]) -> Result<Vec<MediaInfo>, String> {
    if inputs.len() < 2 {
        return Err("Pilih minimal 2 video".into());
    }
    let mut infos = Vec::with_capacity(inputs.len());
    for input in inputs {
        infos.push(probe_video(app, Path::new(input)).await?);
    }
    Ok(infos)
}

#[tauri::command]
pub async fn join_plan(app: AppHandle, inputs: Vec<String>) -> Result<JoinPlan, String> {
    let infos = probe_all(&app, &inputs).await?;
    let reasons = incompatibilities(&infos);
    Ok(JoinPlan {
        items: infos.iter().filter_map(to_dto).collect(),
        compatible: reasons.is_empty(),
        reasons,
        total_sec: infos.iter().filter_map(|i| i.duration).sum(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequest {
    pub job_id: String,
    pub inputs: Vec<String>,
    pub out_dir: Option<String>,
}

#[tauri::command]
pub async fn join_videos(app: AppHandle, jobs: State<'_, Jobs>, req: JoinRequest) -> Result<EditResult, String> {
    check_out_dir(&req.out_dir)?;
    let ffmpeg_bin = engine::resolve(&app, "ffmpeg").ok_or_else(|| MISSING_FFMPEG.to_string())?;
    let infos = probe_all(&app, &req.inputs).await?;
    let copy = incompatibilities(&infos).is_empty();
    let expected: f64 = infos.iter().filter_map(|i| i.duration).sum();

    let inputs: Vec<PathBuf> = req.inputs.iter().map(PathBuf::from).collect();
    let first = &inputs[0];
    let ext = if copy { ext_of(first) } else { "mp4".into() };
    let dir = fsutil::output_dir(first, req.out_dir.as_deref());
    let output = fsutil::unique_path(&dir, &format!("{}_joined", fsutil::stem_of(first)), &ext);
    let work_dir = std::env::temp_dir().join(format!("toolbox-join-{}", req.job_id));

    let mut cancel = jobs.register(&req.job_id);
    let result = run_join(&ffmpeg_bin, &inputs, &infos, &output, copy, &work_dir, &mut cancel, |p| {
        ffmpeg::emit_progress(&app, &req.job_id, p)
    })
    .await;
    jobs.finish(&req.job_id);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&output);
        return Err(e.into_message());
    }
    ffmpeg::emit_progress(&app, &req.job_id, 100.0);

    let actual = match engine::resolve(&app, "ffprobe") {
        Some(p) => ffmpeg::probe(&p, &output).await.and_then(|i| i.duration).unwrap_or(expected),
        None => expected,
    };
    Ok(EditResult {
        output: output.to_string_lossy().into_owned(),
        expected_sec: expected,
        actual_sec: actual,
        method: if copy { "copy" } else { "reencode" },
    })
}

// --------------------------------------------------------- frame preview ---

async fn grab_frame(ffmpeg_bin: &Path, input: &Path, time: f64, width: u32) -> Result<String, String> {
    let out = Command::new(ffmpeg_bin)
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", &format!("{:.3}", time.max(0.0)), "-i"])
        .arg(input)
        .args(["-frames:v", "1", "-vf", &format!("scale={}:-2", width.clamp(64, 640)), "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "5", "-"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if out.stdout.is_empty() {
        return Err("Tidak ada frame pada waktu itu".into());
    }
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(&out.stdout)))
}

/// One frame as a data URL, so the UI can show what a cut point looks like.
#[tauri::command]
pub async fn video_frame(app: AppHandle, path: String, time: f64, width: u32) -> Result<String, String> {
    let ffmpeg_bin = engine::resolve(&app, "ffmpeg").ok_or_else(|| MISSING_FFMPEG.to_string())?;
    grab_frame(&ffmpeg_bin, Path::new(&path), time, width).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::toolbox::ffmpeg::testutil;
    use std::process::Command as StdCommand;

    fn info(codec: &str, w: u32, h: u32, fps: f64, audio: Option<(&str, u32, u32)>) -> MediaInfo {
        MediaInfo {
            duration: Some(4.0),
            has_audio: audio.is_some(),
            width: Some(w),
            height: Some(h),
            video_codec: Some(codec.into()),
            audio_codec: audio.map(|a| a.0.into()),
            fps: Some(fps),
            pix_fmt: Some("yuv420p".into()),
            sample_rate: audio.map(|a| a.1),
            channels: audio.map(|a| a.2),
        }
    }

    #[test]
    fn range_validation() {
        assert_eq!(validate_range(2.0, 8.0, 10.0).unwrap(), (2.0, 8.0));
        assert_eq!(validate_range(2.0, 99.0, 10.0).unwrap(), (2.0, 10.0), "end is clamped to the length");
        assert!(validate_range(-1.0, 5.0, 10.0).is_err());
        assert!(validate_range(5.0, 5.0, 10.0).is_err());
        assert!(validate_range(9.99, 10.0, 10.0).is_err(), "under 0.1 s");
        assert!(validate_range(11.0, 20.0, 10.0).is_err(), "starts after the end");
        assert!(validate_range(f64::NAN, 5.0, 10.0).is_err());
    }

    #[test]
    fn compatibility_reasons() {
        let a = info("h264", 1280, 720, 30.0, Some(("aac", 44100, 2)));
        assert!(incompatibilities(&[a.clone(), a.clone()]).is_empty());
        assert!(incompatibilities(&[a.clone()]).is_empty());

        let diff = incompatibilities(&[a.clone(), info("hevc", 1920, 1080, 25.0, Some(("aac", 48000, 2)))]);
        for code in ["videoCodec", "resolution", "fps", "audio"] {
            assert!(diff.contains(&code), "{code} in {diff:?}");
        }
        assert_eq!(incompatibilities(&[a.clone(), info("h264", 1280, 720, 30.0, None)]), vec!["audioMissing"]);
        // 29.97 vs 30 is a real mismatch for stream copy
        assert!(incompatibilities(&[a.clone(), info("h264", 1280, 720, 29.97, Some(("aac", 44100, 2)))]).contains(&"fps"));
    }

    #[test]
    fn join_filter_pads_normalises_and_fills_silence() {
        let with_audio = info("h264", 640, 361, 29.97, Some(("aac", 44100, 2)));
        let silent = info("h264", 1920, 1080, 30.0, None);
        let f = join_filter(&[with_audio.clone(), silent]);
        assert!(f.contains("scale=640:360"), "dimensions are made even: {f}");
        assert!(f.contains("pad=640:360") && f.contains("fps=29.970"));
        assert!(f.contains("[0:a:0]aresample=48000") && f.contains("anullsrc") && f.contains("atrim=duration=4.000"));
        assert!(f.ends_with("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"), "{f}");

        let no_audio = join_filter(&[info("h264", 640, 360, 30.0, None), info("h264", 640, 360, 30.0, None)]);
        assert!(!no_audio.contains("aresample") && !no_audio.contains("anullsrc"));
        assert!(no_audio.ends_with("concat=n=2:v=1:a=0[v]"), "{no_audio}");
    }

    #[test]
    fn concat_list_escapes_quotes() {
        let list = concat_list(&[PathBuf::from("/a/it's.mp4"), PathBuf::from("/b/plain.mp4")]);
        assert_eq!(list, "file '/a/it'\\''s.mp4'\nfile '/b/plain.mp4'\n");
    }

    // ---- real ffmpeg

    fn ff(args: &[&str]) {
        let (ffmpeg_bin, _) = testutil::engines().unwrap();
        let out = StdCommand::new(ffmpeg_bin).args(["-hide_banner", "-loglevel", "error", "-y"]).args(args).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }

    /// Test clip. Keyframes every 5 s at 24 fps, so fast trims have to snap.
    fn clip(dir: &Path, name: &str, size: &str, rate: u32, secs: u32, audio: bool) -> PathBuf {
        let path = dir.join(name);
        let video = format!("testsrc2=duration={secs}:size={size}:rate={rate}");
        let sine = format!("sine=frequency=440:duration={secs}");
        let g = (rate * 5).to_string();
        let mut args = vec!["-f", "lavfi", "-i", &video];
        if audio {
            args.extend(["-f", "lavfi", "-i", &sine, "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest"]);
        }
        args.extend(["-c:v", "libx264", "-g", &g, "-pix_fmt", "yuv420p", path.to_str().unwrap()]);
        ff(&args);
        path
    }

    async fn probe_of(path: &Path) -> MediaInfo {
        let (_, ffprobe) = testutil::engines().unwrap();
        ffmpeg::probe(&ffprobe, path).await.unwrap()
    }

    #[tokio::test]
    async fn trim_fast_snaps_to_a_keyframe_and_precise_does_not() {
        let Some((ffmpeg_bin, _)) = testutil::engines() else { return eprintln!("skipped: no ffmpeg") };
        let dir = testutil::workdir("trim");
        let src = clip(&dir, "src.mp4", "320x240", 24, 20, true);
        let (_keep, mut rx) = oneshot::channel::<()>();

        // ask for 7s -> 12s (5 s long); the nearest keyframe before 7 s is at 5 s
        let fast = dir.join("fast.mp4");
        run_trim(&ffmpeg_bin, &src, &fast, 7.0, 12.0, TrimMode::Fast, &mut rx, |_| {}).await.unwrap();
        let fast_len = probe_of(&fast).await.duration.unwrap();
        println!("fast trim: asked 5.00 s, got {fast_len:.2} s");
        assert!((4.5..=8.0).contains(&fast_len), "fast trim length {fast_len}");
        assert_eq!(probe_of(&fast).await.video_codec.as_deref(), Some("h264"));

        let precise = dir.join("precise.mp4");
        run_trim(&ffmpeg_bin, &src, &precise, 7.0, 12.0, TrimMode::Precise, &mut rx, |_| {}).await.unwrap();
        let p = probe_of(&precise).await;
        println!("precise trim: asked 5.00 s, got {:.2} s", p.duration.unwrap());
        assert!((p.duration.unwrap() - 5.0).abs() < 0.25, "precise trim length {:?}", p.duration);
        assert!(p.has_audio);
    }

    #[tokio::test]
    async fn join_copies_matching_clips_without_re_encoding() {
        let Some((ffmpeg_bin, _)) = testutil::engines() else { return eprintln!("skipped: no ffmpeg") };
        let dir = testutil::workdir("join-copy");
        let a = clip(&dir, "a.mp4", "320x240", 24, 4, true);
        let b = clip(&dir, "b.mp4", "320x240", 24, 4, true);
        let infos = vec![probe_of(&a).await, probe_of(&b).await];
        assert!(incompatibilities(&infos).is_empty(), "{:?}", incompatibilities(&infos));

        let out = dir.join("out.mp4");
        let (_keep, mut rx) = oneshot::channel::<()>();
        run_join(&ffmpeg_bin, &[a.clone(), b.clone()], &infos, &out, true, &dir.join("work"), &mut rx, |_| {}).await.unwrap();

        let o = probe_of(&out).await;
        assert!((o.duration.unwrap() - 8.0).abs() < 0.3, "{:?}", o.duration);
        assert!(o.has_audio);
        // a copy keeps the byte count close to the sum of the inputs; a re-encode would not
        let (sa, sb, so) = (std::fs::metadata(&a).unwrap().len(), std::fs::metadata(&b).unwrap().len(), std::fs::metadata(&out).unwrap().len());
        let ratio = so as f64 / (sa + sb) as f64;
        assert!((0.9..=1.1).contains(&ratio), "size ratio {ratio:.2}");
        assert!(!dir.join("work").exists(), "list file directory must be cleaned up");
    }

    #[tokio::test]
    async fn join_re_encodes_mismatched_clips_into_the_first_clips_frame() {
        let Some((ffmpeg_bin, _)) = testutil::engines() else { return eprintln!("skipped: no ffmpeg") };
        let dir = testutil::workdir("join-mix");
        let a = clip(&dir, "a.mp4", "320x240", 24, 4, true);
        let b = clip(&dir, "b.mp4", "640x360", 30, 3, false); // other size, other fps, no audio
        let infos = vec![probe_of(&a).await, probe_of(&b).await];
        let reasons = incompatibilities(&infos);
        for code in ["resolution", "fps", "audioMissing"] {
            assert!(reasons.contains(&code), "{code} in {reasons:?}");
        }

        let out = dir.join("out.mp4");
        let (_keep, mut rx) = oneshot::channel::<()>();
        run_join(&ffmpeg_bin, &[a, b], &infos, &out, false, &dir.join("work"), &mut rx, |_| {}).await.unwrap();

        let o = probe_of(&out).await;
        assert_eq!((o.width, o.height), (Some(320), Some(240)), "normalised to the first clip");
        assert!((o.duration.unwrap() - 7.0).abs() < 0.4, "{:?}", o.duration);
        assert!(o.has_audio, "the silent clip must get a silent track so audio spans the whole file");
    }

    #[tokio::test]
    async fn frame_preview_is_a_decodable_jpeg_data_url() {
        let Some((ffmpeg_bin, _)) = testutil::engines() else { return eprintln!("skipped: no ffmpeg") };
        let dir = testutil::workdir("frame");
        let src = clip(&dir, "src.mp4", "640x360", 24, 4, false);

        let url = grab_frame(&ffmpeg_bin, &src, 2.0, 320).await.unwrap();
        let b64 = url.strip_prefix("data:image/jpeg;base64,").expect("data url prefix");
        let bytes = STANDARD.decode(b64).unwrap();
        let img = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg).unwrap();
        assert_eq!((img.width(), img.height()), (320, 180));

        // past the end there is no frame, and it says so
        assert!(grab_frame(&ffmpeg_bin, &src, 60.0, 320).await.is_err());
    }
}
