//! Shared plumbing for everything that runs ffmpeg: job registry (for cancel),
//! a runner that streams progress, and an ffprobe wrapper.

use std::{
    collections::HashMap,
    ffi::OsString,
    path::Path,
    process::Stdio,
    sync::Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::oneshot,
};

/// Running jobs, keyed by job id. Sending on the channel cancels the job.
#[derive(Default)]
pub struct Jobs(Mutex<HashMap<String, oneshot::Sender<()>>>);

impl Jobs {
    pub fn register(&self, id: &str) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        self.0.lock().unwrap().insert(id.to_string(), tx);
        rx
    }

    pub fn finish(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }

    fn cancel(&self, id: &str) {
        if let Some(tx) = self.0.lock().unwrap().remove(id) {
            let _ = tx.send(());
        }
    }
}

#[tauri::command]
pub fn cancel_job(jobs: State<'_, Jobs>, job_id: String) {
    jobs.cancel(&job_id);
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    job_id: String,
    /// 0-100, or -1 when the total duration is unknown (indeterminate).
    percent: f64,
}

pub fn emit_progress(app: &AppHandle, job_id: &str, percent: f64) {
    let _ = app.emit("job-progress", Progress { job_id: job_id.to_string(), percent });
}

#[derive(Debug, PartialEq, Eq)]
pub enum RunError {
    Cancelled,
    Failed(String),
}

impl RunError {
    /// The string handed to the frontend. "cancelled" is a sentinel it checks for.
    pub fn into_message(self) -> String {
        match self {
            RunError::Cancelled => "cancelled".into(),
            RunError::Failed(m) => m,
        }
    }
}

/// Adds `-threads n` for every input (decoding) and for the output (encoding), so one job
/// cannot take every core. Everything else in `args` is left as it was.
pub fn with_thread_limit(args: &[OsString], n: usize) -> Vec<OsString> {
    let n = n.to_string();
    let mut out: Vec<OsString> = Vec::with_capacity(args.len() + 6);
    for (i, a) in args.iter().enumerate() {
        let is_input = a == "-i";
        let is_output = i + 1 == args.len() && i > 0;
        if is_input || is_output {
            out.push("-threads".into());
            out.push(n.clone().into());
        }
        out.push(a.clone());
    }
    out
}

/// Runs ffmpeg with `args` (everything after the global options, including the
/// output). `duration` turns ffmpeg's progress output into a percentage;
/// `on_progress` receives 0-99, or -1 when the duration is unknown.
pub async fn run(
    ffmpeg: &Path,
    args: &[OsString],
    duration: Option<f64>,
    cancel: &mut oneshot::Receiver<()>,
    mut on_progress: impl FnMut(f64),
) -> Result<(), RunError> {
    let args = with_thread_limit(args, crate::toolbox::proc::worker_threads());
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"])
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::toolbox::proc::lower_priority(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| RunError::Failed(format!("Gagal menjalankan ffmpeg: {e}")))?;

    let stdout = child.stdout.take().ok_or_else(|| RunError::Failed("stdout tidak tersedia".into()))?;
    let mut stderr = child.stderr.take().ok_or_else(|| RunError::Failed("stderr tidak tersedia".into()))?;
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf).await;
        buf
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut cancelled = false;
    // A dropped sender is not a cancel request. Once the channel is closed we
    // stop watching it (a oneshot receiver must not be polled after it resolves).
    let mut cancel_open = true;
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(l)) => {
                    if let Some(us) = l.strip_prefix("out_time_us=").and_then(|v| v.trim().parse::<f64>().ok()) {
                        on_progress(match duration {
                            Some(d) => (us / 1_000_000.0 / d * 100.0).clamp(0.0, 99.0),
                            None => -1.0,
                        });
                    }
                }
                _ => break,
            },
            signal = &mut *cancel, if cancel_open => {
                if signal.is_ok() {
                    cancelled = true;
                    let _ = child.kill().await;
                    break;
                }
                cancel_open = false;
            }
        }
    }

    let status = child.wait().await.map_err(|e| RunError::Failed(e.to_string()))?;
    let stderr_text = stderr_task.await.unwrap_or_default();

    if cancelled {
        return Err(RunError::Cancelled);
    }
    if !status.success() {
        let tail: Vec<&str> = stderr_text.lines().rev().take(6).collect();
        let msg = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(RunError::Failed(if msg.is_empty() { "ffmpeg gagal".into() } else { msg }));
    }
    Ok(())
}

#[derive(Debug, Clone, Default)]
pub struct MediaInfo {
    pub duration: Option<f64>,
    pub has_audio: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub fps: Option<f64>,
    pub pix_fmt: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
}

/// "30000/1001" -> 29.97. `None` for "0/0" and anything unparsable.
fn parse_rate(rate: &str) -> Option<f64> {
    let (n, d) = rate.split_once('/')?;
    let (n, d) = (n.parse::<f64>().ok()?, d.parse::<f64>().ok()?);
    (d > 0.0 && n > 0.0).then(|| n / d)
}

/// One ffprobe call for the facts the tools need. `None` if ffprobe fails or
/// the file is not readable as media.
pub async fn probe(ffprobe: &Path, input: &Path) -> Option<MediaInfo> {
    let out = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels:format=duration",
            "-of",
            "json",
        ])
        .arg(input)
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_probe(&out.stdout)
}

fn parse_probe(json: &[u8]) -> Option<MediaInfo> {
    let value: serde_json::Value = serde_json::from_slice(json).ok()?;
    let mut info = MediaInfo::default();

    info.duration = value["format"]["duration"].as_str().and_then(|d| d.parse::<f64>().ok()).filter(|d| *d > 0.0);
    for stream in value["streams"].as_array()? {
        match stream["codec_type"].as_str() {
            Some("video") if info.width.is_none() => {
                info.width = stream["width"].as_u64().map(|v| v as u32);
                info.height = stream["height"].as_u64().map(|v| v as u32);
                info.video_codec = stream["codec_name"].as_str().map(str::to_owned);
                info.fps = stream["r_frame_rate"].as_str().and_then(parse_rate);
                info.pix_fmt = stream["pix_fmt"].as_str().map(str::to_owned);
            }
            Some("audio") if !info.has_audio => {
                info.has_audio = true;
                info.audio_codec = stream["codec_name"].as_str().map(str::to_owned);
                // ffprobe prints these two numbers as strings (sample_rate) and ints (channels)
                info.sample_rate = stream["sample_rate"].as_str().and_then(|s| s.parse().ok());
                info.channels = stream["channels"].as_u64().map(|v| v as u32);
            }
            _ => {}
        }
    }
    Some(info)
}

#[cfg(test)]
pub mod testutil {
    use std::path::PathBuf;

    /// ffmpeg + ffprobe for tests: the bundled sidecars if present, else the
    /// Homebrew ones. None (and the test skips) when neither exists, e.g. in a
    /// checkout that has not run `pnpm engines`.
    pub fn engines() -> Option<(PathBuf, PathBuf)> {
        let bin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let triple = std::fs::read_dir(&bin).ok()?.filter_map(|e| e.ok()).find_map(|e| {
            e.file_name().to_str()?.strip_prefix("ffmpeg-").map(str::to_owned)
        });
        let pair = |dir: PathBuf, suffix: String| (dir.join(format!("ffmpeg{suffix}")), dir.join(format!("ffprobe{suffix}")));
        let candidates = [
            triple.map(|t| pair(bin.clone(), format!("-{t}"))),
            Some(pair(PathBuf::from("/opt/homebrew/bin"), String::new())),
            Some(pair(PathBuf::from("/usr/local/bin"), String::new())),
        ];
        candidates.into_iter().flatten().find(|(a, b)| a.is_file() && b.is_file())
    }

    pub fn workdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("toolbox-ff-test-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_limit_goes_before_each_input_and_the_output() {
        let a: Vec<OsString> = ["-i", "a.mp4", "-c:v", "libx264", "out.mp4"].iter().map(OsString::from).collect();
        let got: Vec<String> = with_thread_limit(&a, 3).iter().map(|s| s.to_string_lossy().into_owned()).collect();
        assert_eq!(got, ["-threads", "3", "-i", "a.mp4", "-c:v", "libx264", "-threads", "3", "out.mp4"]);
        let two: Vec<OsString> = ["-i", "a", "-i", "b", "o"].iter().map(OsString::from).collect();
        assert_eq!(with_thread_limit(&two, 2).iter().filter(|s| *s == "-threads").count(), 3);
        assert!(with_thread_limit(&[], 2).is_empty());
    }

    #[test]
    fn worker_threads_stay_between_two_and_eight() {
        assert!((2..=8).contains(&crate::toolbox::proc::worker_threads()));
    }

    #[test]
    fn parses_probe_json() {
        let json = br#"{"streams":[{"codec_type":"video","codec_name":"h264","width":1280,"height":720,"r_frame_rate":"30000/1001","pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac","sample_rate":"44100","channels":2}],"format":{"duration":"12.500000"}}"#;
        let info = parse_probe(json).unwrap();
        assert_eq!((info.width, info.height, info.has_audio), (Some(1280), Some(720), true));
        assert_eq!(info.duration, Some(12.5));
        assert_eq!((info.video_codec.as_deref(), info.audio_codec.as_deref()), (Some("h264"), Some("aac")));
        assert_eq!((info.sample_rate, info.channels, info.pix_fmt.as_deref()), (Some(44100), Some(2), Some("yuv420p")));
        assert!((info.fps.unwrap() - 29.97).abs() < 0.01);
        assert_eq!(parse_rate("0/0"), None);
        assert_eq!(parse_rate("24/1"), Some(24.0));

        // an image: no audio, no duration worth using
        let img = parse_probe(br#"{"streams":[{"codec_type":"video","width":10,"height":20}],"format":{}}"#).unwrap();
        assert!(!img.has_audio && img.duration.is_none());
        assert!(parse_probe(b"not json").is_none());
    }

    #[tokio::test]
    async fn runs_reports_progress_and_surfaces_errors() {
        let Some((ffmpeg, ffprobe)) = testutil::engines() else {
            eprintln!("skipped: no ffmpeg available");
            return;
        };
        let dir = testutil::workdir("run");
        let out = dir.join("t.mp4");
        let jobs = Jobs::default();

        let args: Vec<OsString> = ["-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=24", "-f", "lavfi", "-i", "sine=duration=3", "-shortest", "-c:v", "libx264", "-c:a", "aac"]
            .iter().map(OsString::from).chain([out.clone().into_os_string()]).collect();
        let mut rx = jobs.register("a");
        let mut seen = Vec::new();
        run(&ffmpeg, &args, Some(3.0), &mut rx, |p| seen.push(p)).await.unwrap();
        jobs.finish("a");
        assert!(out.is_file());
        assert!(seen.iter().all(|p| (0.0..=99.0).contains(p)));

        let info = probe(&ffprobe, &out).await.unwrap();
        assert!(info.has_audio && info.width == Some(320));
        assert!((info.duration.unwrap() - 3.0).abs() < 0.2);

        // a failing run returns ffmpeg's own message, not a generic one
        let mut rx = jobs.register("b");
        let bad: Vec<OsString> = ["-i", "/definitely/missing.mp4", "/tmp/x.mp4"].iter().map(OsString::from).collect();
        match run(&ffmpeg, &bad, None, &mut rx, |_| {}).await {
            Err(RunError::Failed(m)) => assert!(m.contains("missing.mp4"), "{m}"),
            other => panic!("expected failure, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_dropped_cancel_sender_does_not_cancel_the_job() {
        let Some((ffmpeg, _)) = testutil::engines() else {
            eprintln!("skipped: no ffmpeg available");
            return;
        };
        let out = testutil::workdir("dropped").join("t.mp4");
        let args: Vec<OsString> = ["-f", "lavfi", "-i", "testsrc=duration=1:size=160x120:rate=10", "-c:v", "libx264"]
            .iter().map(OsString::from).chain([out.clone().into_os_string()]).collect();
        // e.g. the same job id registered twice replaces (drops) the first sender
        let jobs = Jobs::default();
        let mut rx = jobs.register("same");
        let _second = jobs.register("same");
        run(&ffmpeg, &args, Some(1.0), &mut rx, |_| {}).await.unwrap();
        assert!(out.is_file());
    }

    #[tokio::test]
    async fn cancel_stops_a_long_job() {
        let Some((ffmpeg, _)) = testutil::engines() else {
            eprintln!("skipped: no ffmpeg available");
            return;
        };
        let dir = testutil::workdir("cancel");
        let out = dir.join("long.mp4");
        let jobs = Jobs::default();
        let args: Vec<OsString> = ["-f", "lavfi", "-i", "testsrc=duration=600:size=1280x720:rate=30", "-c:v", "libx264", "-preset", "veryslow"]
            .iter().map(OsString::from).chain([out.into_os_string()]).collect();

        let mut rx = jobs.register("long");
        let started = std::time::Instant::now();
        let (result, _) = tokio::join!(run(&ffmpeg, &args, Some(600.0), &mut rx, |_| {}), async {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            jobs.cancel("long");
        });
        assert_eq!(result, Err(RunError::Cancelled));
        assert!(started.elapsed().as_secs() < 10, "cancel must be prompt");
    }
}
