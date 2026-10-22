use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use tauri::{AppHandle, State};
use tokio::process::Command;

use crate::toolbox::{
    engine, ffmpeg,
    ffmpeg::{Jobs, RunError},
    fsutil,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
    pub job_id: String,
    pub input: String,
    pub out_dir: Option<String>,
    pub format: String,
}

/// ffmpeg arguments per output format. The frontend only ever sends a format
/// name, never raw arguments.
fn args_for(format: &str) -> Option<&'static [&'static str]> {
    Some(match format {
        "mp4" => &["-c:v", "libx264", "-crf", "23", "-preset", "medium", "-c:a", "aac", "-movflags", "+faststart"],
        "mkv" => &["-c:v", "libx264", "-crf", "23", "-preset", "medium", "-c:a", "aac"],
        "webm" => &["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-c:a", "libopus"],
        "gif" => &["-an", "-vf", "fps=12,scale=480:-1:flags=lanczos"],
        "mp3" => &["-vn", "-c:a", "libmp3lame", "-q:a", "2"],
        "m4a" => &["-vn", "-c:a", "aac", "-b:a", "192k"],
        "wav" => &["-vn", "-c:a", "pcm_s16le"],
        "flac" => &["-vn", "-c:a", "flac"],
        "jpg" => &["-frames:v", "1", "-q:v", "2"],
        "png" => &["-frames:v", "1"],
        "webp" => &["-frames:v", "1", "-q:v", "80"],
        _ => return None,
    })
}

/// Encoders each output format needs. A format is offered only when every one
/// of them exists in the ffmpeg being used, since builds differ (the Homebrew
/// build, for one, ships without libwebp).
const REQUIRED_ENCODERS: &[(&str, &[&str])] = &[
    ("mp4", &["libx264", "aac"]),
    ("mkv", &["libx264", "aac"]),
    ("webm", &["libvpx-vp9", "libopus"]),
    ("gif", &["gif"]),
    ("mp3", &["libmp3lame"]),
    ("m4a", &["aac"]),
    ("wav", &["pcm_s16le"]),
    ("flac", &["flac"]),
    ("jpg", &["mjpeg"]),
    ("png", &["png"]),
    ("webp", &["libwebp"]),
];

#[tauri::command]
pub async fn available_formats(app: AppHandle) -> Result<Vec<String>, String> {
    let ffmpeg = engine::resolve(&app, "ffmpeg").ok_or("ffmpeg tidak ditemukan")?;
    let out = Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    // Lines look like " V....D libx264   H.264 ..." -> second column is the name.
    let have: Vec<&str> = text
        .lines()
        .filter_map(|l| l.split_whitespace().nth(1))
        .collect();

    Ok(REQUIRED_ENCODERS
        .iter()
        .filter(|(_, needs)| needs.iter().all(|n| have.contains(n)))
        .map(|(format, _)| format.to_string())
        .collect())
}

fn unique_output(input: &Path, out_dir: Option<&str>, ext: &str) -> PathBuf {
    fsutil::unique_path(&fsutil::output_dir(input, out_dir), fsutil::stem_of(input), ext)
}

pub(crate) const MISSING_FFMPEG: &str =
    "ffmpeg tidak ditemukan. Jalankan \"pnpm engines\" (atau brew install ffmpeg) untuk development.";

#[tauri::command]
pub async fn convert_media(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    req: ConvertRequest,
) -> Result<String, String> {
    let input = PathBuf::from(&req.input);
    if !input.is_file() {
        return Err(format!("File tidak ditemukan: {}", req.input));
    }
    let preset = args_for(&req.format).ok_or_else(|| format!("Format tidak didukung: {}", req.format))?;
    if let Some(dir) = &req.out_dir {
        if !Path::new(dir).is_dir() {
            return Err(format!("Folder tujuan tidak ada: {dir}"));
        }
    }
    let ffmpeg_bin = engine::resolve(&app, "ffmpeg").ok_or_else(|| MISSING_FFMPEG.to_string())?;

    let output = unique_output(&input, req.out_dir.as_deref(), &req.format);
    let duration = match engine::resolve(&app, "ffprobe") {
        Some(p) => ffmpeg::probe(&p, &input).await.and_then(|i| i.duration),
        None => None,
    };

    let mut args: Vec<OsString> = vec!["-i".into(), input.into_os_string()];
    args.extend(preset.iter().map(OsString::from));
    args.push(output.clone().into_os_string());

    let mut cancel = jobs.register(&req.job_id);
    let result = ffmpeg::run(&ffmpeg_bin, &args, duration, &mut cancel, |p| {
        ffmpeg::emit_progress(&app, &req.job_id, p)
    })
    .await;
    jobs.finish(&req.job_id);

    match result {
        Ok(()) => {
            ffmpeg::emit_progress(&app, &req.job_id, 100.0);
            Ok(output.to_string_lossy().into_owned())
        }
        Err(e @ (RunError::Cancelled | RunError::Failed(_))) => {
            let _ = std::fs::remove_file(&output);
            Err(e.into_message())
        }
    }
}
