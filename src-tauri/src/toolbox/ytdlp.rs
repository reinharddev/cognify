//! Media download through yt-dlp, which the user installs on demand (see
//! engine_install.rs). Nothing here circumvents DRM, logins or access
//! controls: when a site refuses, the error is passed on with an explanation.

use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::oneshot,
};

use crate::toolbox::{engine, ffmpeg::Jobs, proc};

// ------------------------------------------------------------- url + args ---

/// Only plain http(s) URLs. In particular a value starting with "-" must never
/// reach yt-dlp, where it would be read as an option.
pub fn validate_url(url: &str) -> Result<&str, &'static str> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    let scheme_ok = lower.starts_with("https://") || lower.starts_with("http://");
    let host_part = url.split("://").nth(1).unwrap_or("");
    if !scheme_ok || host_part.is_empty() || url.chars().any(|c| c.is_whitespace() || c.is_control()) || url.len() > 2048 {
        return Err("invalidUrl");
    }
    Ok(url)
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Video,
    Audio,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AudioFormat {
    Mp3,
    M4a,
    Opus,
}

impl AudioFormat {
    fn name(self) -> &'static str {
        match self {
            AudioFormat::Mp3 => "mp3",
            AudioFormat::M4a => "m4a",
            AudioFormat::Opus => "opus",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DownloadSpec {
    pub mode: Mode,
    pub max_height: Option<u32>,
    pub audio_format: AudioFormat,
    pub playlist: bool,
}

const PROGRESS_PREFIX: &str = "toolbox-dl:";
const FILE_PREFIX: &str = "toolbox-file:";

/// Everything after the binary name. The URL goes last, after `--`.
pub fn download_args(spec: &DownloadSpec, url: &str, out_dir: &Path, ffmpeg_dir: Option<&Path>) -> Vec<String> {
    let s = |v: &str| v.to_string();
    let mut a: Vec<String> = vec![
        s("--newline"),
        s("--progress"),
        s("--no-mtime"),
        s("--windows-filenames"),
        s("--progress-template"),
        format!(
            "download:{PROGRESS_PREFIX}%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s"
        ),
        s("--print"),
        format!("after_move:{FILE_PREFIX}%(filepath)s"),
        s("--no-simulate"),
        s("-P"),
        out_dir.to_string_lossy().into_owned(),
        s("-o"),
        s(if spec.playlist {
            "%(playlist_title).100B/%(playlist_index)03d - %(title).150B [%(id)s].%(ext)s"
        } else {
            "%(title).150B [%(id)s].%(ext)s"
        }),
        s(if spec.playlist { "--yes-playlist" } else { "--no-playlist" }),
    ];
    if let Some(dir) = ffmpeg_dir {
        a.push(s("--ffmpeg-location"));
        a.push(dir.to_string_lossy().into_owned());
    }
    match spec.mode {
        Mode::Video => {
            let format = match spec.max_height {
                Some(h) => format!("bv*[height<={h}]+ba/b[height<={h}]/bv*+ba/b"),
                None => s("bv*+ba/b"),
            };
            // biggest picture that fits, H.264/AAC when the sizes tie (plays everywhere)
            a.extend([s("-f"), format, s("-S"), s("res,vcodec:h264,acodec:aac"), s("--merge-output-format"), s("mp4")]);
        }
        Mode::Audio => {
            a.extend([s("-f"), s("ba/b"), s("-x"), s("--audio-format"), s(spec.audio_format.name())]);
            if spec.audio_format == AudioFormat::Mp3 {
                a.extend([s("--audio-quality"), s("2")]);
            }
        }
    }
    a.push(s("--"));
    a.push(url.to_string());
    a
}

pub fn info_args(url: &str, allow_playlist: bool) -> Vec<String> {
    let mut a: Vec<String> = ["-J", "--no-warnings", "--skip-download"].iter().map(|v| v.to_string()).collect();
    if allow_playlist {
        a.push("--flat-playlist".into());
    } else {
        a.push("--no-playlist".into());
    }
    a.push("--".into());
    a.push(url.to_string());
    a
}

// ----------------------------------------------------------------- parsing ---

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub uploader: Option<String>,
    pub duration_sec: Option<f64>,
    pub thumbnail: Option<String>,
    pub site: String,
    pub is_playlist: bool,
    pub entry_count: Option<u32>,
    /// Picture heights on offer, tallest first.
    pub heights: Vec<u32>,
}

pub fn summarize_info(v: &Value) -> Option<MediaInfo> {
    let title = v["title"].as_str()?.to_string();
    let is_playlist = v["_type"].as_str() == Some("playlist");
    let mut heights: Vec<u32> = v["formats"]
        .as_array()
        .map(|f| {
            f.iter()
                .filter(|x| x["vcodec"].as_str() != Some("none"))
                .filter_map(|x| x["height"].as_u64().map(|h| h as u32))
                .collect()
        })
        .unwrap_or_default();
    heights.sort_unstable_by(|a, b| b.cmp(a));
    heights.dedup();

    Some(MediaInfo {
        title,
        uploader: v["uploader"].as_str().or_else(|| v["channel"].as_str()).map(str::to_owned),
        duration_sec: v["duration"].as_f64(),
        thumbnail: v["thumbnail"].as_str().filter(|t| t.starts_with("https://") || t.starts_with("http://")).map(str::to_owned),
        site: v["extractor_key"].as_str().or_else(|| v["extractor"].as_str()).unwrap_or("").to_string(),
        is_playlist,
        entry_count: is_playlist.then(|| v["entries"].as_array().map(|e| e.len() as u32)).flatten(),
        heights,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProgressLine {
    pub status: String,
    pub percent: Option<f64>,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
}

fn number(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok().filter(|n| n.is_finite())
}

/// "downloading|1234|5678|NA|1.5e6|12" -> progress. Fields yt-dlp does not know are "NA".
pub fn parse_progress(line: &str) -> Option<ProgressLine> {
    let rest = line.strip_prefix(PROGRESS_PREFIX)?;
    let f: Vec<&str> = rest.split('|').collect();
    if f.len() < 6 {
        return None;
    }
    let done = number(f[1]);
    let total = number(f[2]).or_else(|| number(f[3])).filter(|t| *t > 0.0);
    let percent = match (done, total) {
        (Some(d), Some(t)) => Some((d / t * 100.0).clamp(0.0, 100.0)),
        _ => None,
    };
    Some(ProgressLine { status: f[0].to_string(), percent, speed: number(f[4]), eta: number(f[5]) })
}

/// A human-readable reason code for a failed run, from the end of stderr.
pub fn classify_error(stderr: &str) -> &'static str {
    let s = stderr.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| s.contains(n));
    // Order matters: "Sign in to confirm your age" must not be read as a bot check.
    if has(&["confirm your age", "age-restricted", "age restricted"]) {
        "ageGate"
    } else if has(&["not a bot", "cookies-from-browser"]) {
        "botCheck"
    } else if has(&["private video", "this video is private"]) {
        "private"
    } else if has(&["members-only", "members only", "join this channel"]) {
        "members"
    } else if has(&["drm protected", "drm-protected", "has drm"]) {
        "drm"
    } else if has(&["video unavailable", "this video is not available", "has been removed", "no longer available", "does not exist", "http error 404", "http error 410"]) {
        "unavailable"
    } else if has(&["unsupported url"]) {
        "unsupported"
    } else if has(&["http error 403", "403: forbidden"]) {
        "forbidden"
    } else if has(&["ffmpeg not found", "ffprobe not found", "ffmpeg is not installed", "postprocessing: ffmpeg"]) {
        "noFfmpeg"
    } else if has(&["unable to download", "name or service not known", "timed out", "connection refused", "network is unreachable", "temporary failure in name resolution", "urlopen error", "nodename nor servname"]) {
        "network"
    } else {
        "failed"
    }
}

fn tail(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

// ------------------------------------------------------------------ runner ---

#[derive(Debug, PartialEq, Eq)]
pub enum RunError {
    Cancelled,
    TimedOut,
    Failed { stderr: String },
}

/// Runs yt-dlp, handing each stdout line to `on_line`. Cancel and timeout kill
/// the whole process tree (yt-dlp's launcher runs the real program, and ffmpeg,
/// as children).
async fn run_lines(
    bin: &Path,
    args: &[String],
    cancel: &mut oneshot::Receiver<()>,
    timeout: Option<Duration>,
    mut on_line: impl FnMut(&str),
) -> Result<(), RunError> {
    let mut command = Command::new(bin);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    proc::own_group(&mut command); // so kill_tree can reach every descendant
    proc::lower_priority(&mut command); // its ffmpeg merge step inherits this
    let mut child = command
        .spawn()
        .map_err(|e| RunError::Failed { stderr: format!("Gagal menjalankan yt-dlp: {e}") })?;
    let pid = child.id();

    let stdout = child.stdout.take().expect("piped");
    let mut stderr = child.stderr.take().expect("piped");
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf).await;
        buf
    });

    let deadline = timeout.map(|t| tokio::time::Instant::now() + t);
    let mut lines = BufReader::new(stdout).lines();
    let mut cancel_open = true;
    let mut ended: Option<RunError> = None;
    loop {
        let timed_out = async {
            match deadline {
                Some(d) => tokio::time::sleep_until(d).await,
                None => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(l)) => on_line(&l),
                _ => break,
            },
            signal = &mut *cancel, if cancel_open => {
                if signal.is_ok() {
                    ended = Some(RunError::Cancelled);
                    if let Some(pid) = pid { proc::kill_tree(pid); }
                    let _ = child.kill().await;
                    break;
                }
                cancel_open = false;
            }
            _ = timed_out => {
                ended = Some(RunError::TimedOut);
                if let Some(pid) = pid { proc::kill_tree(pid); }
                let _ = child.kill().await;
                break;
            }
        }
    }

    let status = child.wait().await.map_err(|e| RunError::Failed { stderr: e.to_string() })?;
    // Never wait indefinitely for stderr: a stray descendant could keep the pipe open.
    let stderr_text = tokio::time::timeout(Duration::from_secs(2), stderr_task).await.ok().and_then(Result::ok).unwrap_or_default();
    if let Some(e) = ended {
        return Err(e);
    }
    if !status.success() {
        return Err(RunError::Failed { stderr: stderr_text });
    }
    Ok(())
}

fn error_message(e: RunError) -> String {
    match e {
        RunError::Cancelled => "cancelled".into(),
        RunError::TimedOut => "timeout|".into(),
        RunError::Failed { stderr } => format!("{}|{}", classify_error(&stderr), tail(&stderr, 6)),
    }
}

// ---------------------------------------------------------------- commands ---

fn ytdlp_bin(app: &AppHandle) -> Result<PathBuf, String> {
    engine::resolve(app, "yt-dlp").ok_or_else(|| "engineMissing|".to_string())
}

#[tauri::command]
pub async fn ytdlp_version(app: AppHandle) -> Result<Option<String>, String> {
    let Some(bin) = engine::resolve(&app, "yt-dlp") else { return Ok(None) };
    let out = tokio::time::timeout(Duration::from_secs(10), Command::new(bin).arg("--version").output())
        .await
        .map_err(|_| "timeout|".to_string())?
        .map_err(|e| e.to_string())?;
    Ok(out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoRequest {
    pub url: String,
    pub allow_playlist: bool,
}

#[tauri::command]
pub async fn media_info(app: AppHandle, jobs: State<'_, Jobs>, job_id: String, req: InfoRequest) -> Result<MediaInfo, String> {
    let url = validate_url(&req.url).map_err(|c| format!("{c}|"))?.to_string();
    let bin = ytdlp_bin(&app)?;

    let mut json = String::new();
    let mut cancel = jobs.register(&job_id);
    let result = run_lines(&bin, &info_args(&url, req.allow_playlist), &mut cancel, Some(Duration::from_secs(90)), |l| {
        json.push_str(l);
        json.push('\n');
    })
    .await;
    jobs.finish(&job_id);
    result.map_err(error_message)?;

    let value: Value = serde_json::from_str(&json).map_err(|_| "failed|Jawaban yt-dlp tidak bisa dibaca".to_string())?;
    summarize_info(&value).ok_or_else(|| "failed|Info video tidak lengkap".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub job_id: String,
    pub url: String,
    pub out_dir: Option<String>,
    pub mode: Mode,
    pub max_height: Option<u32>,
    pub audio_format: AudioFormat,
    pub playlist: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MediaProgress {
    job_id: String,
    percent: Option<f64>,
    speed: Option<f64>,
    eta: Option<f64>,
    /// "download" while fetching, "process" while merging or converting.
    phase: &'static str,
    /// How many streams finished so far (video and audio come separately).
    stream: u32,
}

#[derive(Serialize)]
pub struct DownloadResult {
    pub files: Vec<String>,
}

/// Runs one yt-dlp download and reports progress as `media-progress` events.
async fn run_download(app: &AppHandle, jobs: &Jobs, job_id: &str, url: &str, out_dir: &Path, spec: &DownloadSpec) -> Result<Vec<String>, String> {
    let bin = ytdlp_bin(app)?;
    let ffmpeg_dir = engine::resolve(app, "ffmpeg").and_then(|p| p.parent().map(Path::to_path_buf));
    let args = download_args(spec, url, out_dir, ffmpeg_dir.as_deref());

    let mut files: Vec<String> = Vec::new();
    let mut stream = 0u32;
    let mut phase = "download";
    let emit = |percent: Option<f64>, speed: Option<f64>, eta: Option<f64>, phase: &'static str, stream: u32| {
        let _ = app.emit("media-progress", MediaProgress { job_id: job_id.to_string(), percent, speed, eta, phase, stream });
    };

    let mut cancel = jobs.register(job_id);
    let result = run_lines(&bin, &args, &mut cancel, None, |line| {
        if let Some(p) = parse_progress(line) {
            if p.status == "finished" {
                stream += 1;
            }
            emit(p.percent, p.speed, p.eta, phase, stream);
        } else if let Some(path) = line.strip_prefix(FILE_PREFIX) {
            files.push(path.trim().to_string());
        } else if line.starts_with("[Merger]") || line.starts_with("[ExtractAudio]") || line.starts_with("[VideoConvertor]") || line.starts_with("[FixupM4a]") {
            phase = "process";
            emit(None, None, None, phase, stream);
        }
    })
    .await;
    jobs.finish(job_id);
    result.map_err(error_message)?;
    Ok(files)
}

#[tauri::command]
pub async fn media_download(app: AppHandle, jobs: State<'_, Jobs>, req: DownloadRequest) -> Result<DownloadResult, String> {
    let url = validate_url(&req.url).map_err(|c| format!("{c}|"))?.to_string();
    ytdlp_bin(&app)?;
    if req.max_height.is_some_and(|h| !(100..=4320).contains(&h)) {
        return Err("failed|Resolusi tidak valid".into());
    }
    let out_dir = match &req.out_dir {
        Some(d) => PathBuf::from(d),
        None => app.path().download_dir().map_err(|e| e.to_string())?,
    };
    if !out_dir.is_dir() {
        return Err(format!("failed|Folder tujuan tidak ada: {}", out_dir.display()));
    }
    let spec = DownloadSpec { mode: req.mode, max_height: req.max_height, audio_format: req.audio_format, playlist: req.playlist };
    let files = run_download(&app, &jobs, &req.job_id, &url, &out_dir, &spec).await?;
    Ok(DownloadResult { files })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec(mode: Mode) -> DownloadSpec {
        DownloadSpec { mode, max_height: Some(720), audio_format: AudioFormat::Mp3, playlist: false }
    }

    fn pos(args: &[String], needle: &str) -> usize {
        args.iter().position(|a| a == needle).unwrap_or_else(|| panic!("{needle} not in {args:?}"))
    }

    #[test]
    fn urls_are_checked_before_they_can_become_options() {
        for ok in ["https://example.com/watch?v=abc", "http://a.b/c", "  https://example.com/x  ", "HTTPS://EXAMPLE.COM"] {
            assert!(validate_url(ok).is_ok(), "{ok}");
        }
        for bad in ["", "-o /etc/passwd", "--exec", "file:///etc/passwd", "ftp://x/y", "https://", "javascript:alert(1)", "https://a b", "https://a\nb", "example.com", &format!("https://{}", "a".repeat(3000))] {
            assert_eq!(validate_url(bad), Err("invalidUrl"), "{bad:?}");
        }
        assert_eq!(validate_url("  https://example.com/x  ").unwrap(), "https://example.com/x", "trimmed");
    }

    #[test]
    fn the_url_always_comes_last_after_a_double_dash() {
        let a = download_args(&spec(Mode::Video), "https://example.com/v", Path::new("/out"), None);
        assert_eq!(a[a.len() - 2..], ["--".to_string(), "https://example.com/v".to_string()]);
        let i = info_args("https://example.com/v", false);
        assert_eq!(i[i.len() - 2..], ["--".to_string(), "https://example.com/v".to_string()]);
    }

    #[test]
    fn video_arguments_cap_the_height_and_prefer_compatible_codecs() {
        let a = download_args(&spec(Mode::Video), "https://x/y", Path::new("/out dir"), Some(Path::new("/app/bin")));
        assert_eq!(a[pos(&a, "-f") + 1], "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b");
        assert_eq!(a[pos(&a, "-S") + 1], "res,vcodec:h264,acodec:aac");
        assert_eq!(a[pos(&a, "--merge-output-format") + 1], "mp4");
        assert_eq!(a[pos(&a, "-P") + 1], "/out dir", "paths with spaces stay one argument");
        assert_eq!(a[pos(&a, "--ffmpeg-location") + 1], "/app/bin");
        assert!(a.contains(&"--no-playlist".to_string()) && a.contains(&"--no-mtime".to_string()));
        assert!(!a.contains(&"-x".to_string()));

        let none = download_args(&DownloadSpec { max_height: None, ..spec(Mode::Video) }, "https://x/y", Path::new("/o"), None);
        assert_eq!(none[pos(&none, "-f") + 1], "bv*+ba/b");
        assert!(!none.contains(&"--ffmpeg-location".to_string()));
    }

    #[test]
    fn audio_arguments_extract_in_the_chosen_format() {
        let mp3 = download_args(&spec(Mode::Audio), "https://x/y", Path::new("/o"), None);
        assert!(mp3.contains(&"-x".to_string()));
        assert_eq!(mp3[pos(&mp3, "--audio-format") + 1], "mp3");
        assert_eq!(mp3[pos(&mp3, "--audio-quality") + 1], "2");
        assert!(!mp3.contains(&"--merge-output-format".to_string()));

        let opus = download_args(&DownloadSpec { audio_format: AudioFormat::Opus, ..spec(Mode::Audio) }, "https://x/y", Path::new("/o"), None);
        assert_eq!(opus[pos(&opus, "--audio-format") + 1], "opus");
        assert!(!opus.contains(&"--audio-quality".to_string()), "no re-encode quality knob for a remux");
    }

    #[test]
    fn playlists_get_their_own_folder_and_numbering() {
        let a = download_args(&DownloadSpec { playlist: true, ..spec(Mode::Video) }, "https://x/y", Path::new("/o"), None);
        assert!(a.contains(&"--yes-playlist".to_string()));
        assert!(a[pos(&a, "-o") + 1].starts_with("%(playlist_title)"));
        assert!(a[pos(&a, "-o") + 1].contains("%(playlist_index)03d"));
        assert!(info_args("https://x/y", true).contains(&"--flat-playlist".to_string()));
        assert!(info_args("https://x/y", false).contains(&"--no-playlist".to_string()));
    }

    #[test]
    fn progress_lines_become_percentages() {
        let p = parse_progress("toolbox-dl:downloading|2500000|10000000|NA|1572864.5|12").unwrap();
        assert_eq!((p.status.as_str(), p.percent, p.speed, p.eta), ("downloading", Some(25.0), Some(1572864.5), Some(12.0)));
        // total unknown: fall back to the estimate
        assert_eq!(parse_progress("toolbox-dl:downloading|500|NA|1000|NA|NA").unwrap().percent, Some(50.0));
        // nothing known: no percentage, but still a valid line
        let unknown = parse_progress("toolbox-dl:downloading|NA|NA|NA|NA|NA").unwrap();
        assert_eq!((unknown.percent, unknown.speed, unknown.eta), (None, None, None));
        assert_eq!(parse_progress("toolbox-dl:finished|10|10|NA|NA|NA").unwrap().percent, Some(100.0));
        assert!(parse_progress("toolbox-dl:downloading|1|2").is_none(), "short lines are ignored");
        assert!(parse_progress("[download] 12.0% of 3MiB").is_none());
    }

    #[test]
    fn info_is_summarised_for_videos_and_playlists() {
        let video = json!({
            "title": "Demo", "uploader": "Someone", "duration": 61.5, "thumbnail": "https://img/x.jpg",
            "extractor_key": "Youtube",
            "formats": [{"height": 360, "vcodec": "avc1"}, {"height": 1080, "vcodec": "avc1"}, {"height": 1080, "vcodec": "vp9"},
                        {"height": null, "vcodec": "none"}, {"height": 720, "vcodec": "none"}, {"height": 720, "vcodec": "avc1"}]
        });
        let info = summarize_info(&video).unwrap();
        assert_eq!((info.title.as_str(), info.site.as_str(), info.heights.as_slice()), ("Demo", "Youtube", [1080, 720, 360].as_slice()));
        assert_eq!((info.duration_sec, info.is_playlist, info.entry_count), (Some(61.5), false, None));

        let list = summarize_info(&json!({"_type": "playlist", "title": "Mix", "entries": [{}, {}, {}], "channel": "Chan"})).unwrap();
        assert_eq!((list.is_playlist, list.entry_count, list.uploader.as_deref()), (true, Some(3), Some("Chan")));

        // a non-web thumbnail is not passed to the UI
        assert_eq!(summarize_info(&json!({"title": "t", "thumbnail": "file:///etc/passwd"})).unwrap().thumbnail, None);
        assert!(summarize_info(&json!({"no": "title"})).is_none());
    }

    #[test]
    fn failures_are_explained_not_just_dumped() {
        let cases = [
            ("ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser", "botCheck"),
            ("ERROR: Private video. Sign in if you've been granted access", "private"),
            ("ERROR: Video unavailable. This video has been removed by the uploader", "unavailable"),
            ("ERROR: Unsupported URL: https://example.com/page", "unsupported"),
            // seen from the real yt-dlp: a missing page is "unavailable", not a network fault
            ("ERROR: [generic] nope: Unable to download webpage: HTTP Error 404: File not found", "unavailable"),
            ("ERROR: unable to download video data: HTTP Error 403: Forbidden", "forbidden"),
            ("ERROR: Postprocessing: ffmpeg not found. Please install or provide the path using --ffmpeg-location", "noFfmpeg"),
            ("ERROR: [Errno 8] nodename nor servname provided, or not known", "network"),
            ("ERROR: This video is DRM protected", "drm"),
            ("ERROR: Join this channel to get access to members-only content", "members"),
            ("ERROR: Sign in to confirm your age. This video may be inappropriate", "ageGate"),
            ("ERROR: something nobody has seen before", "failed"),
        ];
        for (text, code) in cases {
            assert_eq!(classify_error(text), code, "{text}");
        }
        assert_eq!(tail("a\n\nb\nc\nd\n", 2), "c\nd");
    }

    /// The real yt-dlp against a throwaway local web server (never a real site).
    /// Skipped unless asked for:
    ///   TOOLBOX_YTDLP=/path/to/yt-dlp cargo test real_ytdlp -- --ignored --nocapture
    #[cfg(unix)]
    #[tokio::test]
    #[ignore]
    async fn real_ytdlp_against_a_local_server() {
        use crate::toolbox::ffmpeg::{self, testutil};
        let ytdlp = PathBuf::from(std::env::var("TOOLBOX_YTDLP").expect("TOOLBOX_YTDLP"));
        let (ffmpeg_bin, ffprobe) = testutil::engines().expect("no ffmpeg");

        let root = std::env::temp_dir().join(format!("toolbox-real-ytdlp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (site, out, tools) = (root.join("site"), root.join("out"), root.join("tools"));
        for d in [&site, &out, &tools] {
            std::fs::create_dir_all(d).unwrap();
        }
        // yt-dlp finds ffmpeg + ffprobe in one folder, as in the app's bundle
        std::os::unix::fs::symlink(&ffmpeg_bin, tools.join("ffmpeg")).unwrap();
        std::os::unix::fs::symlink(&ffprobe, tools.join("ffprobe")).unwrap();

        let clip = site.join("clip.mp4");
        let made = std::process::Command::new(&ffmpeg_bin)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=duration=3:size=640x360:rate=24", "-f", "lavfi", "-i", "sine=duration=3", "-shortest", "-c:v", "libx264", "-c:a", "aac"])
            .arg(&clip)
            .status()
            .unwrap();
        assert!(made.success());

        let port = 20000 + (std::process::id() % 20000);
        let mut server = std::process::Command::new("python3")
            .args(["-I", "-m", "http.server", &port.to_string(), "--bind", "127.0.0.1", "--directory"])
            .arg(&site)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        tokio::time::sleep(Duration::from_millis(1200)).await;
        let url = format!("http://127.0.0.1:{port}/clip.mp4");
        let (_k, mut rx) = oneshot::channel::<()>();

        // 1. info
        let mut json = String::new();
        run_lines(&ytdlp, &info_args(&url, false), &mut rx, Some(Duration::from_secs(60)), |l| json.push_str(l)).await.expect("info");
        let info = summarize_info(&serde_json::from_str(&json).expect("yt-dlp printed JSON")).expect("summary");
        println!("info: {info:?}");
        // a plain file link goes through the "Generic" extractor, which does not inspect the
        // file: no heights or duration here, unlike real sites. The UI copes with an empty list.
        assert_eq!((info.title.as_str(), info.site.as_str()), ("clip", "Generic"));
        assert!(!info.is_playlist);

        // 2. video download with the real flags
        let spec = DownloadSpec { mode: Mode::Video, max_height: Some(720), audio_format: AudioFormat::Mp3, playlist: false };
        let (mut files, mut progress) = (Vec::new(), Vec::new());
        run_lines(&ytdlp, &download_args(&spec, &url, &out, Some(&tools)), &mut rx, Some(Duration::from_secs(120)), |l| {
            if let Some(p) = parse_progress(l) {
                progress.push(p);
            } else if let Some(f) = l.strip_prefix(FILE_PREFIX) {
                files.push(f.trim().to_string());
            }
        })
        .await
        .expect("video download");
        println!("video files: {files:?}; {} progress lines, last {:?}", progress.len(), progress.last());
        assert_eq!(files.len(), 1, "the final path is reported exactly once");
        let video = PathBuf::from(&files[0]);
        assert!(video.is_file() && video.starts_with(&out), "{video:?}");
        assert!(!progress.is_empty(), "the progress template must produce lines we can parse");
        assert!(progress.iter().any(|p| p.status == "finished" && p.percent == Some(100.0)));
        let probed = ffmpeg::probe(&ffprobe, &video).await.unwrap();
        assert!(probed.has_audio && probed.width == Some(640));

        // 3. audio only, as mp3
        let audio_spec = DownloadSpec { mode: Mode::Audio, ..spec.clone() };
        let mut audio_files = Vec::new();
        run_lines(&ytdlp, &download_args(&audio_spec, &url, &out, Some(&tools)), &mut rx, Some(Duration::from_secs(120)), |l| {
            if let Some(f) = l.strip_prefix(FILE_PREFIX) {
                audio_files.push(f.trim().to_string());
            }
        })
        .await
        .expect("audio download");
        println!("audio files: {audio_files:?}");
        let mp3 = PathBuf::from(audio_files.last().expect("a path was printed"));
        assert_eq!(mp3.extension().and_then(|e| e.to_str()), Some("mp3"));
        let probed = ffmpeg::probe(&ffprobe, &mp3).await.unwrap();
        assert!(probed.has_audio && probed.width.is_none(), "audio only, no picture");

        // 4. a missing file fails, with something to show the user
        let mut cancel2 = oneshot::channel::<()>().1;
        let err = run_lines(&ytdlp, &download_args(&spec, &format!("http://127.0.0.1:{port}/nope.mp4"), &out, Some(&tools)), &mut cancel2, Some(Duration::from_secs(60)), |_| {})
            .await
            .unwrap_err();
        match err {
            RunError::Failed { stderr } => {
                println!("404 error -> {} | {}", classify_error(&stderr), tail(&stderr, 2));
                assert!(!stderr.trim().is_empty());
            }
            other => panic!("{other:?}"),
        }

        let _ = server.kill();
        let _ = server.wait();
    }

    // ---- the runner, against a stand-in for yt-dlp (unix shell script)

    #[cfg(unix)]
    mod fake {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        fn script(tag: &str, body: &str) -> PathBuf {
            let dir = std::env::temp_dir().join(format!("toolbox-ytdlp-test-{}-{tag}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("fake-yt-dlp");
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }

        #[tokio::test]
        async fn lines_are_streamed_and_success_is_reported() {
            let bin = script("ok", "echo 'toolbox-dl:downloading|50|100|NA|10|5'\necho '[Merger] Merging formats'\necho 'toolbox-file:/out/a.mp4'");
            let (_k, mut rx) = oneshot::channel::<()>();
            let mut seen = Vec::new();
            run_lines(&bin, &[], &mut rx, None, |l| seen.push(l.to_string())).await.unwrap();
            assert_eq!(seen, ["toolbox-dl:downloading|50|100|NA|10|5", "[Merger] Merging formats", "toolbox-file:/out/a.mp4"]);
        }

        #[tokio::test]
        async fn arguments_arrive_intact_even_with_spaces_and_odd_characters() {
            let log = std::env::temp_dir().join(format!("toolbox-ytdlp-args-{}", std::process::id()));
            let bin = script("args", &format!("for a in \"$@\"; do printf '%s\\n' \"$a\"; done > '{}'", log.display()));
            let args = download_args(&spec(Mode::Video), "https://example.com/v?x=1&y=2;rm -rf", Path::new("/tmp/my out"), None);
            let (_k, mut rx) = oneshot::channel::<()>();
            run_lines(&bin, &args, &mut rx, None, |_| {}).await.unwrap();
            let got: Vec<String> = std::fs::read_to_string(&log).unwrap().lines().map(str::to_owned).collect();
            assert_eq!(got, args, "no shell is involved, so every argument survives byte for byte");
        }

        #[tokio::test]
        async fn a_failing_run_returns_stderr_and_a_reason() {
            let bin = script("fail", "echo 'ERROR: Private video. Sign in if you have access' >&2\nexit 1");
            let (_k, mut rx) = oneshot::channel::<()>();
            match run_lines(&bin, &[], &mut rx, None, |_| {}).await {
                Err(RunError::Failed { stderr }) => assert_eq!(classify_error(&stderr), "private"),
                other => panic!("{other:?}"),
            }
            assert_eq!(error_message(RunError::Failed { stderr: "ERROR: Video unavailable".into() }), "unavailable|ERROR: Video unavailable");
        }

        fn alive(pid: i32) -> bool {
            // signal 0 only checks that the process exists
            unsafe { libc::kill(pid, 0) == 0 }
        }

        fn grandchild_pid(file: &Path) -> i32 {
            for _ in 0..40 {
                if let Ok(text) = std::fs::read_to_string(file) {
                    if let Ok(pid) = text.trim().parse() {
                        return pid;
                    }
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            panic!("the stand-in never reported its child pid");
        }

        /// Like the real launcher: a parent that starts a long-running child.
        fn launcher(tag: &str) -> (PathBuf, PathBuf) {
            let pidfile = std::env::temp_dir().join(format!("toolbox-ytdlp-pid-{}-{tag}", std::process::id()));
            let _ = std::fs::remove_file(&pidfile);
            let bin = script(tag, &format!("echo started\nsleep 60 &\necho $! > '{}'\nwait", pidfile.display()));
            (bin, pidfile)
        }

        #[tokio::test]
        async fn cancel_stops_the_launcher_and_the_process_it_started() {
            let (bin, pidfile) = launcher("cancel");
            let (tx, mut rx) = oneshot::channel::<()>();
            let t0 = std::time::Instant::now();
            let (r, child_pid) = tokio::join!(run_lines(&bin, &[], &mut rx, None, |_| {}), async {
                let pid = tokio::task::spawn_blocking(move || grandchild_pid(&pidfile)).await.unwrap();
                assert!(alive(pid), "the child should be running before we cancel");
                let _ = tx.send(());
                pid
            });
            assert_eq!(r, Err(RunError::Cancelled));
            assert!(t0.elapsed() < Duration::from_secs(8), "cancel must not wait for the child");
            tokio::time::sleep(Duration::from_millis(300)).await;
            assert!(!alive(child_pid), "the launcher's child must be killed too, or the download would continue in the background");
        }

        #[tokio::test]
        async fn a_timeout_also_kills_the_whole_tree() {
            let (bin, pidfile) = launcher("timeout");
            let (_k, mut rx) = oneshot::channel::<()>();
            let t0 = std::time::Instant::now();
            let r = run_lines(&bin, &[], &mut rx, Some(Duration::from_millis(1200)), |_| {}).await;
            assert_eq!(r, Err(RunError::TimedOut));
            assert!(t0.elapsed() < Duration::from_secs(8));
            let pid = grandchild_pid(&pidfile);
            tokio::time::sleep(Duration::from_millis(300)).await;
            assert!(!alive(pid));
        }

        #[tokio::test]
        async fn a_missing_binary_is_a_clean_error() {
            let (_k, mut rx) = oneshot::channel::<()>();
            let r = run_lines(Path::new("/definitely/not/yt-dlp"), &[], &mut rx, None, |_| {}).await;
            assert!(matches!(r, Err(RunError::Failed { stderr }) if stderr.contains("yt-dlp")));
        }
    }
}
