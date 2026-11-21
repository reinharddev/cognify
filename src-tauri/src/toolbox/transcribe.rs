//! Transkrip dari audio atau video (berkas lokal atau URL yang diketik pengguna).
//!
//! Dua jalur:
//! - **whisper**: suara diurai ffmpeg ke PCM 16 kHz mono, lalu `cognify --transcribe` (proses anak,
//!   lihat `whisper_child.rs`) menjalankan whisper.cpp dengan model yang dipasang pengguna.
//!   Berjalan di proses terpisah dengan prioritas rendah dan separuh inti CPU, jadi bisa dibatalkan
//!   dengan mematikan prosesnya dan memorinya langsung kembali setelah selesai.
//! - **captions**: caption bawaan YouTube lewat yt-dlp; tanpa model, tanpa beban.
//!
//! Audio tidak pernah dikirim ke mana pun. Satu-satunya permintaan keluar: unduhan model (lewat
//! pemasang engine, hanya setelah tombol ditekan) dan URL yang diketik pengguna.

use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::toolbox::{engine, engine_install, ffmpeg, ffmpeg::Jobs, ytdlp};

/// Nama berkas model (`whisper-small` di `engines.json`).
pub const MODEL_FILE: &str = "ggml-small-q5_1.bin";

pub const SAMPLE_RATE: usize = 16_000;

// ------------------------------------------------------------------ types ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Satu baris protokol antara proses anak dan app (JSON per baris di stdout anak).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChildMsg {
    Progress { percent: f64 },
    Language { code: String },
    Segment { start: f64, end: f64, text: String },
    Done,
    Error { message: String },
}

pub fn parse_child_line(line: &str) -> Option<ChildMsg> {
    serde_json::from_str(line.trim()).ok()
}

/// Bahasa yang boleh dikirim ke whisper: "auto" atau kode ISO 2 sampai 3 huruf kecil.
pub fn valid_language(code: &str) -> bool {
    code == "auto" || ((2..=3).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase()))
}

// ------------------------------------------------------------- audio math ---

/// Potongan sepanjang ini diserahkan ke whisper sekali jalan. Memori tetap kecil walau videonya
/// berjam-jam, dan batas potongan dicari di titik paling sepi supaya kata tidak terbelah.
pub const CHUNK_SECS: usize = 600;
/// Seberapa jauh ke belakang dari batas potongan titik sepi dicari.
pub const CUT_SEARCH_SECS: usize = 15;

/// Indeks (relatif ke `window`) bingkai 100 ms dengan energi terkecil, di tengah bingkai itu.
pub fn quietest_point(window: &[i16]) -> usize {
    let frame = SAMPLE_RATE / 10;
    if window.len() <= frame {
        return window.len();
    }
    let mut best = (u128::MAX, 0usize);
    let mut at = 0;
    while at + frame <= window.len() {
        let energy: u128 = window[at..at + frame].iter().map(|&s| (s as i128 * s as i128) as u128).sum();
        if energy < best.0 {
            best = (energy, at);
        }
        at += frame;
    }
    best.1 + frame / 2
}

/// Titik potong untuk potongan yang mulai di `start` (indeks sampel) dari `total` sampel.
/// `read(a, b)` mengembalikan sampel [a, b). Bila sisanya muat dalam satu potongan, hasilnya `total`.
pub fn next_cut(start: usize, total: usize, read: impl Fn(usize, usize) -> Vec<i16>) -> usize {
    let target = CHUNK_SECS * SAMPLE_RATE;
    let search = CUT_SEARCH_SECS * SAMPLE_RATE;
    // Sisa yang tanggung (sedikit lewat dari satu potongan) digabung supaya tidak ada potongan sangat pendek.
    if total - start <= target + search {
        return total;
    }
    let end = start + target;
    let from = end - search;
    from + quietest_point(&read(from, end))
}

// ------------------------------------------------------------ VTT captions ---

fn vtt_time(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.trim().split(':').collect();
    let (h, m, sec) = match parts.as_slice() {
        [m, s] => (0.0, m.parse::<f64>().ok()?, s),
        [h, m, s] => (h.parse::<f64>().ok()?, m.parse::<f64>().ok()?, s),
        _ => return None,
    };
    Some(h * 3600.0 + m * 60.0 + sec.replace(',', ".").parse::<f64>().ok()?)
}

fn strip_cue_markup(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut in_tag = false;
    for c in line.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ")
}

/// WebVTT jadi segmen. Caption otomatis YouTube mengulang baris sebelumnya di tiap cue
/// ("bergulir"), jadi baris yang sama dengan baris terakhir yang sudah diambil dibuang.
pub fn parse_vtt(text: &str) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::new();
    let mut last_line = String::new();
    let mut lines = text.lines().peekable();
    while let Some(line) = lines.next() {
        let Some((a, b)) = line.split_once("-->") else { continue };
        let (Some(start), Some(end)) = (vtt_time(a), vtt_time(b.split_whitespace().next().unwrap_or(""))) else { continue };
        let mut kept: Vec<String> = Vec::new();
        while let Some(&next) = lines.peek() {
            if next.trim().is_empty() {
                break;
            }
            lines.next();
            let clean = strip_cue_markup(next).split_whitespace().collect::<Vec<_>>().join(" ");
            if clean.is_empty() || clean == last_line {
                continue;
            }
            last_line = clean.clone();
            kept.push(clean);
        }
        if kept.is_empty() {
            continue;
        }
        let text = kept.join(" ");
        // Cue yang berurutan tanpa jeda dan seteks ditempelkan ke sebelumnya.
        match out.last_mut() {
            Some(prev) if prev.text == text => prev.end = end,
            _ => out.push(Segment { start, end: end.max(start), text }),
        }
    }
    out
}

// ---------------------------------------------------------------- commands ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeStatus {
    pub model_installed: bool,
    pub ffmpeg: bool,
    pub ytdlp: bool,
    /// Perangkat ini bisa menjalankan whisper (desktop saja).
    pub supported: bool,
}

#[tauri::command]
pub fn transcribe_status(app: AppHandle) -> TranscribeStatus {
    let model = engine_install::engines_dir(&app).map(|d| d.join(MODEL_FILE).is_file()).unwrap_or(false);
    TranscribeStatus {
        model_installed: model,
        ffmpeg: engine::resolve(&app, "ffmpeg").is_some() && engine::resolve(&app, "ffprobe").is_some(),
        ytdlp: engine::resolve(&app, "yt-dlp").is_some(),
        supported: cfg!(desktop),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    pub job_id: String,
    /// Berkas lokal atau URL; tepat salah satu.
    pub path: Option<String>,
    pub url: Option<String>,
    /// "whisper" atau "captions" (hanya URL).
    pub mode: String,
    /// "auto" atau kode bahasa.
    pub language: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PhaseEvent {
    job_id: String,
    /// "download" | "decode" | "listen"
    phase: &'static str,
    percent: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SegmentEvent {
    job_id: String,
    segment: Segment,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptResult {
    pub segments: Vec<Segment>,
    pub language: Option<String>,
    /// "whisper" atau "captions"
    pub source: &'static str,
    pub title: String,
    pub duration_sec: Option<f64>,
}

fn phase(app: &AppHandle, job_id: &str, phase: &'static str, percent: f64) {
    let _ = app.emit("transcribe-phase", PhaseEvent { job_id: job_id.to_string(), phase, percent });
}

/// Folder sementara yang dihapus saat keluar dari lingkup, apa pun hasilnya.
struct TempDir(PathBuf);

impl TempDir {
    fn new(app: &AppHandle, job_id: &str) -> Result<Self, String> {
        let safe: String = job_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(64).collect();
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("transcribe").join(if safe.is_empty() { "job".into() } else { safe });
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(Self(dir))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn title_of(path: &Path) -> String {
    path.file_stem().and_then(|s| s.to_str()).unwrap_or("Transkrip").to_string()
}

/// Judul dari nama berkas hasil unduhan yt-dlp ("Judul [id].m4a" menjadi "Judul").
fn title_from_download(path: &Path) -> String {
    let stem = title_of(path);
    match stem.rfind(" [") {
        Some(i) if stem.ends_with(']') => stem[..i].to_string(),
        _ => stem,
    }
}

#[tauri::command]
pub async fn transcribe(app: AppHandle, jobs: State<'_, Jobs>, req: TranscribeRequest) -> Result<TranscriptResult, String> {
    if !cfg!(desktop) {
        return Err("unsupported|".into());
    }
    if !valid_language(&req.language) {
        return Err("failed|Bahasa tidak valid".into());
    }
    let tmp = TempDir::new(&app, &req.job_id)?;
    let mut cancel = jobs.register(&req.job_id);
    let result = run(&app, &req, &tmp.0, &mut cancel).await;
    jobs.finish(&req.job_id);
    result
}

async fn run(app: &AppHandle, req: &TranscribeRequest, tmp: &Path, cancel: &mut tokio::sync::oneshot::Receiver<()>) -> Result<TranscriptResult, String> {
    let job_id = req.job_id.as_str();
    match (req.mode.as_str(), &req.url, &req.path) {
        ("captions", Some(url), _) => captions(app, job_id, url, &req.language, tmp, cancel).await,
        ("captions", None, _) => Err("failed|Caption hanya untuk URL".into()),
        ("whisper", url, path) => {
            let model = engine_install::engines_dir(app)?.join(MODEL_FILE);
            if !model.is_file() {
                return Err("modelMissing|".into());
            }
            let (Some(ffmpeg_bin), Some(ffprobe_bin)) = (engine::resolve(app, "ffmpeg"), engine::resolve(app, "ffprobe")) else {
                return Err("ffmpegMissing|".into());
            };

            // 1. sumber: berkas lokal, atau audio dari URL
            let (input, title) = match (path, url) {
                (Some(p), _) => (PathBuf::from(p), title_of(Path::new(p))),
                (None, Some(u)) => {
                    let u = ytdlp::validate_url(u).map_err(|c| format!("{c}|"))?.to_string();
                    phase(app, job_id, "download", 0.0);
                    let file = download_audio(app, job_id, &u, tmp, cancel).await?;
                    let title = title_from_download(&file);
                    (file, title)
                }
                (None, None) => return Err("failed|Pilih berkas atau tempel URL".into()),
            };
            if !input.is_file() {
                return Err(format!("failed|Berkas tidak ditemukan: {}", input.display()));
            }

            // 2. urai ke PCM 16 kHz mono
            phase(app, job_id, "decode", 0.0);
            let info = ffmpeg::probe(&ffprobe_bin, &input).await;
            if info.as_ref().is_some_and(|i| !i.has_audio) {
                return Err("noAudio|".into());
            }
            let duration = info.and_then(|i| i.duration);
            let pcm = tmp.join("audio.pcm");
            decode_to_pcm(&ffmpeg_bin, &input, &pcm, duration, cancel, |p| phase(app, job_id, "decode", p.max(0.0))).await?;

            // 3. dengarkan (proses anak)
            phase(app, job_id, "listen", 0.0);
            let exe = std::env::current_exe().map_err(|e| format!("failed|{e}"))?;
            let args = child_args(&model, &pcm, &req.language, crate::toolbox::proc::worker_threads());
            let heard = run_child(&exe, &args, cancel, |msg| match msg {
                ChildMsg::Progress { percent } => phase(app, job_id, "listen", *percent),
                ChildMsg::Segment { start, end, text } => {
                    let segment = Segment { start: *start, end: *end, text: text.clone() };
                    let _ = app.emit("transcribe-segment", SegmentEvent { job_id: job_id.to_string(), segment });
                }
                _ => {}
            })
            .await?;
            let Heard { segments, language } = heard;
            phase(app, job_id, "listen", 100.0);
            Ok(TranscriptResult { segments, language, source: "whisper", title, duration_sec: duration })
        }
        _ => Err("failed|Mode tidak dikenal".into()),
    }
}

/// Urai `input` ke PCM 16-bit 16 kHz mono (bahan whisper). Berkas keluaran = 32 KB per detik suara.
pub async fn decode_to_pcm(
    ffmpeg_bin: &Path,
    input: &Path,
    out: &Path,
    duration: Option<f64>,
    cancel: &mut tokio::sync::oneshot::Receiver<()>,
    on_progress: impl FnMut(f64),
) -> Result<(), String> {
    let args: Vec<std::ffi::OsString> = vec![
        "-i".into(),
        input.as_os_str().to_owned(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        SAMPLE_RATE.to_string().into(),
        "-f".into(),
        "s16le".into(),
        out.as_os_str().to_owned(),
    ];
    ffmpeg::run(ffmpeg_bin, &args, duration, cancel, on_progress).await.map_err(|e| match e {
        ffmpeg::RunError::Cancelled => "cancelled".to_string(),
        ffmpeg::RunError::Failed(m) => format!("failed|{m}"),
    })
}

pub fn child_args(model: &Path, pcm: &Path, language: &str, threads: usize) -> Vec<String> {
    vec![
        "--transcribe".into(),
        "--model".into(),
        model.to_string_lossy().into_owned(),
        "--pcm".into(),
        pcm.to_string_lossy().into_owned(),
        "--lang".into(),
        language.to_string(),
        "--threads".into(),
        threads.to_string(),
    ]
}

#[derive(Debug, PartialEq)]
pub struct Heard {
    pub segments: Vec<Segment>,
    pub language: Option<String>,
}

/// Menjalankan proses anak dan mengumpulkan hasilnya. `on_msg` melihat setiap pesan (untuk progres
/// dan segmen langsung). Pembatalan mematikan seluruh pohon prosesnya.
pub async fn run_child(
    exe: &Path,
    args: &[String],
    cancel: &mut tokio::sync::oneshot::Receiver<()>,
    mut on_msg: impl FnMut(&ChildMsg),
) -> Result<Heard, String> {
    let mut segments: Vec<Segment> = Vec::new();
    let mut language: Option<String> = None;
    let mut child_error: Option<String> = None;
    let mut finished = false;
    let outcome = ytdlp::run_lines(exe, args, cancel, None, |line| {
        let Some(msg) = parse_child_line(line) else { return };
        on_msg(&msg);
        match msg {
            ChildMsg::Language { code } => language = Some(code),
            ChildMsg::Segment { start, end, text } => segments.push(Segment { start, end, text }),
            ChildMsg::Done => finished = true,
            ChildMsg::Error { message } => child_error = Some(message),
            ChildMsg::Progress { .. } => {}
        }
    })
    .await;
    match outcome {
        Ok(()) => {}
        Err(ytdlp::RunError::Cancelled) => return Err("cancelled".into()),
        Err(ytdlp::RunError::TimedOut) => return Err("timeout|".into()),
        Err(ytdlp::RunError::Failed { stderr }) => {
            let detail = child_error.unwrap_or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("proses transkripsi berhenti").to_string());
            return Err(format!("failed|{detail}"));
        }
    }
    if let Some(m) = child_error {
        return Err(format!("failed|{m}"));
    }
    if !finished {
        return Err("failed|Proses transkripsi berhenti sebelum selesai".into());
    }
    Ok(Heard { segments, language })
}

/// Mengunduh suaranya saja (m4a) dari URL yang diketik pengguna.
async fn download_audio(app: &AppHandle, job_id: &str, url: &str, out_dir: &Path, cancel: &mut tokio::sync::oneshot::Receiver<()>) -> Result<PathBuf, String> {
    let bin = ytdlp::ytdlp_bin(app)?;
    let ffmpeg_dir = engine::resolve(app, "ffmpeg").and_then(|p| p.parent().map(Path::to_path_buf));
    let spec = ytdlp::DownloadSpec { mode: ytdlp::Mode::Audio, max_height: None, audio_format: ytdlp::AudioFormat::M4a, playlist: false };
    let args = ytdlp::download_args(&spec, url, out_dir, ffmpeg_dir.as_deref());
    let mut file: Option<String> = None;
    ytdlp::run_lines(&bin, &args, cancel, None, |line| {
        if let Some(p) = ytdlp::parse_progress(line) {
            if let Some(pc) = p.percent {
                phase(app, job_id, "download", pc);
            }
        } else if let Some(path) = line.strip_prefix(ytdlp::FILE_PREFIX) {
            file = Some(path.trim().to_string());
        }
    })
    .await
    .map_err(ytdlp::error_message)?;
    file.map(PathBuf::from).filter(|p| p.is_file()).ok_or_else(|| "failed|Unduhan audio tidak menghasilkan berkas".to_string())
}

/// Caption bawaan YouTube (atau situs lain yang punya). Bahasa yang diminta dulu, lalu id, lalu en.
async fn captions(app: &AppHandle, job_id: &str, url: &str, language: &str, tmp: &Path, cancel: &mut tokio::sync::oneshot::Receiver<()>) -> Result<TranscriptResult, String> {
    let url = ytdlp::validate_url(url).map_err(|c| format!("{c}|"))?.to_string();
    let bin = ytdlp::ytdlp_bin(app)?;
    phase(app, job_id, "download", 0.0);
    let langs = if language == "auto" { "id.*,en.*".to_string() } else { format!("{language}.*,id.*,en.*") };
    let args: Vec<String> = [
        "--skip-download", "--write-subs", "--write-auto-subs", "--sub-format", "vtt", "--sub-langs", langs.as_str(), "--no-playlist", "--no-warnings", "--windows-filenames", "--print", "title", "-P",
        &tmp.to_string_lossy(), "-o", "%(id)s", "--", &url,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let mut title = String::new();
    ytdlp::run_lines(&bin, &args, cancel, Some(Duration::from_secs(120)), |line| {
        if title.is_empty() && !line.trim().is_empty() {
            title = line.trim().to_string();
        }
    })
    .await
    .map_err(ytdlp::error_message)?;

    let mut vtts: Vec<PathBuf> = std::fs::read_dir(tmp)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("vtt"))
        .collect();
    if vtts.is_empty() {
        return Err("noCaptions|".into());
    }
    // urutan keinginan: bahasa yang diminta, id, en
    let rank = |p: &PathBuf| -> usize {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        [language, "id", "en"].iter().position(|l| *l != "auto" && name.contains(&format!(".{l}"))).unwrap_or(9)
    };
    vtts.sort_by_key(|p| (rank(p), p.clone()));
    let chosen = &vtts[0];
    let code = chosen.file_name().and_then(|n| n.to_str()).and_then(|n| n.rsplit('.').nth(1)).map(|c| c.split('-').next().unwrap_or(c).to_string());
    let text = std::fs::read_to_string(chosen).map_err(|e| e.to_string())?;
    let segments = parse_vtt(&text);
    if segments.is_empty() {
        return Err("noCaptions|".into());
    }
    phase(app, job_id, "download", 100.0);
    let duration_sec = segments.last().map(|s| s.end);
    Ok(TranscriptResult { segments, language: code, source: "captions", title: if title.is_empty() { "Transkrip".into() } else { title }, duration_sec })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_lines_round_trip() {
        let seg = ChildMsg::Segment { start: 1.5, end: 3.0, text: "halo dunia".into() };
        let line = serde_json::to_string(&seg).unwrap();
        assert!(line.contains("\"type\":\"segment\""));
        assert_eq!(parse_child_line(&line), Some(seg));
        assert_eq!(parse_child_line(&serde_json::to_string(&ChildMsg::Done).unwrap()), Some(ChildMsg::Done));
        assert_eq!(parse_child_line("bukan json"), None);
        assert_eq!(parse_child_line(""), None);
    }

    #[test]
    fn language_codes_are_checked() {
        assert!(valid_language("auto"));
        assert!(valid_language("id"));
        assert!(valid_language("haw"));
        assert!(!valid_language(""));
        assert!(!valid_language("ID"));
        assert!(!valid_language("-x"));
        assert!(!valid_language("indonesian"));
    }

    fn loud(n: usize) -> Vec<i16> {
        (0..n).map(|i| if i % 2 == 0 { 8000 } else { -8000 }).collect()
    }

    #[test]
    fn the_cut_lands_in_the_quietest_stretch() {
        // 3 detik bising dengan jeda hening 200 ms di detik ke-2
        let mut audio = loud(3 * SAMPLE_RATE);
        let (a, b) = (2 * SAMPLE_RATE, 2 * SAMPLE_RATE + SAMPLE_RATE / 5);
        audio[a..b].iter_mut().for_each(|s| *s = 0);
        let cut = quietest_point(&audio);
        assert!(cut >= a && cut <= b, "cut {cut} outside {a}..{b}");
    }

    #[test]
    fn short_audio_is_one_chunk_and_long_audio_is_cut_in_silence() {
        let short = 5 * 60 * SAMPLE_RATE;
        assert_eq!(next_cut(0, short, |_, _| unreachable!()), short);

        // 25 menit; hening di menit ke-9 lebih 50 detik (dalam jendela 15 detik terakhir dari 10 menit)
        let total = 25 * 60 * SAMPLE_RATE;
        let quiet_at = 9 * 60 * SAMPLE_RATE + 50 * SAMPLE_RATE;
        let read = |a: usize, b: usize| -> Vec<i16> {
            (a..b).map(|i| if (quiet_at..quiet_at + SAMPLE_RATE / 5).contains(&i) { 0 } else if i % 2 == 0 { 6000 } else { -6000 }).collect()
        };
        let cut = next_cut(0, total, read);
        assert!(cut >= quiet_at && cut <= quiet_at + SAMPLE_RATE / 5, "cut {cut}");
        // sisa yang tanggung digabung, bukan dipotong tipis
        let almost = CHUNK_SECS * SAMPLE_RATE + SAMPLE_RATE;
        assert_eq!(next_cut(0, almost, |_, _| unreachable!()), almost);
    }

    #[test]
    fn plain_vtt_becomes_segments() {
        let vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHalo semuanya\n\n00:00:04.000 --> 00:00:06.000\nSelamat datang\ndi kanal ini\n";
        let s = parse_vtt(vtt);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0], Segment { start: 1.0, end: 3.5, text: "Halo semuanya".into() });
        assert_eq!(s[1].text, "Selamat datang di kanal ini");
    }

    #[test]
    fn rolling_youtube_captions_do_not_repeat_lines() {
        let vtt = "WEBVTT\nKind: captions\nLanguage: en\n\n00:00:00.000 --> 00:00:02.000 align:start position:0%\nhello <00:00:00.500><c>there</c>\n\n00:00:02.000 --> 00:00:02.010 align:start position:0%\nhello there\n\n00:00:02.010 --> 00:00:04.000 align:start position:0%\nhello there\nthis is <00:00:03.000><c>a test</c>\n";
        let s = parse_vtt(vtt);
        let all: Vec<&str> = s.iter().map(|x| x.text.as_str()).collect();
        assert_eq!(all, vec!["hello there", "this is a test"]);
    }

    #[test]
    fn vtt_entities_and_comma_times_are_handled() {
        let vtt = "00:01.500 --> 00:02,250\nTom &amp; Jerry &gt;&gt; ok\n";
        let s = parse_vtt(vtt);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].start, 1.5);
        assert_eq!(s[0].end, 2.25);
        assert_eq!(s[0].text, "Tom & Jerry >> ok");
    }

    #[test]
    fn download_titles_lose_the_video_id() {
        assert_eq!(title_from_download(Path::new("/x/Kuliah Fisika [dQw4w9WgXcQ].m4a")), "Kuliah Fisika");
        assert_eq!(title_from_download(Path::new("/x/rekaman.mp3")), "rekaman");
    }

    #[test]
    fn child_arguments_carry_every_value_as_its_own_argument() {
        let a = child_args(Path::new("/m dir/model.bin"), Path::new("/t/a b.pcm"), "id", 4);
        assert_eq!(a, ["--transcribe", "--model", "/m dir/model.bin", "--pcm", "/t/a b.pcm", "--lang", "id", "--threads", "4"]);
    }

    #[tokio::test]
    async fn real_ffmpeg_turns_any_audio_into_16khz_mono_pcm() {
        use crate::toolbox::ffmpeg::testutil;
        let Some((ffmpeg_bin, _)) = testutil::engines() else { return };
        let dir = testutil::workdir("transcribe-decode");
        let wav = dir.join("tone.wav");
        // 2 detik nada stereo 44,1 kHz
        let made = std::process::Command::new(&ffmpeg_bin)
            .args(["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=44100", "-ac", "2"])
            .arg(&wav)
            .status()
            .unwrap();
        assert!(made.success());
        let pcm = dir.join("out.pcm");
        let (_k, mut rx) = tokio::sync::oneshot::channel::<()>();
        decode_to_pcm(&ffmpeg_bin, &wav, &pcm, Some(2.0), &mut rx, |_| {}).await.unwrap();
        let bytes = std::fs::metadata(&pcm).unwrap().len();
        // 2 detik x 16000 sampel x 2 byte, dengan sedikit kelonggaran untuk pembulatan frame
        assert!((bytes as i64 - 64_000).abs() <= 2_000, "got {bytes} bytes");
    }

    #[cfg(unix)]
    mod fake {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        fn script(tag: &str, body: &str) -> PathBuf {
            let dir = std::env::temp_dir().join(format!("toolbox-transcribe-test-{}-{tag}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("fake-child");
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }

        #[tokio::test]
        async fn segments_language_and_progress_are_collected() {
            let bin = script(
                "ok",
                r#"echo '{"type":"progress","percent":10.0}'
echo '{"type":"language","code":"id"}'
echo '{"type":"segment","start":0.0,"end":2.5,"text":"Selamat pagi."}'
echo 'noise that is not json'
echo '{"type":"segment","start":2.5,"end":4.0,"text":"Mari mulai."}'
echo '{"type":"done"}'"#,
            );
            let (_k, mut rx) = tokio::sync::oneshot::channel::<()>();
            let mut seen = 0;
            let heard = run_child(&bin, &[], &mut rx, |_| seen += 1).await.unwrap();
            assert_eq!(seen, 5, "the noise line is not a message");
            assert_eq!(heard.language.as_deref(), Some("id"));
            assert_eq!(heard.segments.len(), 2);
            assert_eq!(heard.segments[1], Segment { start: 2.5, end: 4.0, text: "Mari mulai.".into() });
        }

        #[tokio::test]
        async fn the_childs_own_error_message_reaches_the_user() {
            let bin = script("err", r#"echo '{"type":"error","message":"Model tidak bisa dimuat: rusak"}'; exit 1"#);
            let (_k, mut rx) = tokio::sync::oneshot::channel::<()>();
            let err = run_child(&bin, &[], &mut rx, |_| {}).await.unwrap_err();
            assert_eq!(err, "failed|Model tidak bisa dimuat: rusak");
        }

        #[tokio::test]
        async fn a_crash_without_a_message_falls_back_to_stderr() {
            let bin = script("crash", "echo 'ggml: out of memory' >&2; exit 3");
            let (_k, mut rx) = tokio::sync::oneshot::channel::<()>();
            let err = run_child(&bin, &[], &mut rx, |_| {}).await.unwrap_err();
            assert_eq!(err, "failed|ggml: out of memory");
        }

        #[tokio::test]
        async fn exiting_cleanly_without_done_is_still_a_failure() {
            let bin = script("nodone", r#"echo '{"type":"segment","start":0.0,"end":1.0,"text":"setengah"}'"#);
            let (_k, mut rx) = tokio::sync::oneshot::channel::<()>();
            let err = run_child(&bin, &[], &mut rx, |_| {}).await.unwrap_err();
            assert!(err.starts_with("failed|"), "{err}");
        }

        #[tokio::test]
        async fn cancel_stops_a_long_running_child() {
            let bin = script("slow", r#"echo '{"type":"progress","percent":1.0}'; sleep 30"#);
            let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
            let started = std::time::Instant::now();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(300)).await;
                let _ = tx.send(());
            });
            let err = run_child(&bin, &[], &mut rx, |_| {}).await.unwrap_err();
            assert_eq!(err, "cancelled");
            assert!(started.elapsed() < Duration::from_secs(10));
        }
    }
}
