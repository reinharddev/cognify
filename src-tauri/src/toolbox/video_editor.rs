//! Editor video sederhana: beberapa klip yang dipotong sendiri-sendiri, disambung, dengan musik opsional (mengganti
//! atau dicampur dengan suara video, lengkap dengan volume dan pudar), lalu diekspor ke satu berkas MP4.
//!
//! Semuanya satu perintah ffmpeg dengan filter_complex, di perangkat ini. Setiap klip dibaca mulai dari titik potongnya
//! (`-ss` sebelum `-i`, yang tetap tepat ke bingkai karena videonya dikodekan ulang), disamakan ke ukuran dan laju
//! bingkai yang sama (klip yang bentuknya berbeda diberi bingkai hitam di sisi), dan klip tanpa suara diberi suara
//! kosong supaya sambungan suaranya tidak bergeser.

use std::{ffi::OsString, path::{Path, PathBuf}};

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::toolbox::{
    convert::MISSING_FFMPEG,
    engine, ffmpeg,
    ffmpeg::{Jobs, MediaInfo},
    fsutil,
    video_edit::{check_out_dir, even, os, probe_video, validate_range, EditResult},
};

const MAX_CLIPS: usize = 50;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorClip {
    pub path: String,
    /// Detik di dalam klip.
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MusicMode {
    /// Suara asli video dibuang, hanya musik.
    Replace,
    /// Suara video dan musik terdengar bersamaan.
    Mix,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorMusic {
    pub path: String,
    pub mode: MusicMode,
    /// 1.0 = volume asli; 0 sampai 2.
    pub music_volume: f64,
    pub video_volume: f64,
    /// Ulangi musik bila lebih pendek dari video.
    #[serde(default)]
    pub loop_music: bool,
    /// Suara mengecil pelan di akhir video.
    #[serde(default)]
    pub fade_out: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutSize {
    /// Ukuran klip pertama.
    First,
    P1080,
    P720,
    P480,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorRequest {
    pub job_id: String,
    pub clips: Vec<EditorClip>,
    pub music: Option<EditorMusic>,
    pub size: OutSize,
    pub out_dir: Option<String>,
}

/// Satu potongan yang sudah diperiksa.
#[derive(Debug, Clone)]
pub struct Segment {
    pub path: PathBuf,
    pub start: f64,
    pub duration: f64,
    pub has_audio: bool,
}

#[derive(Debug, Clone)]
pub struct MusicPlan {
    pub path: PathBuf,
    pub mode: MusicMode,
    pub music_volume: f64,
    pub video_volume: f64,
    pub looped: bool,
    pub fade_out: bool,
}

#[derive(Debug, Clone)]
pub struct Plan {
    pub segments: Vec<Segment>,
    pub music: Option<MusicPlan>,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

impl Plan {
    pub fn total(&self) -> f64 {
        self.segments.iter().map(|s| s.duration).sum()
    }
}

/// Ukuran hasil: sisi pendek ke target (480, 720, 1080) dengan bentuk klip pertama, selalu genap.
pub fn target_size(first_w: u32, first_h: u32, size: OutSize) -> (u32, u32) {
    let target = match size {
        OutSize::First => return (even(first_w), even(first_h)),
        OutSize::P1080 => 1080.0,
        OutSize::P720 => 720.0,
        OutSize::P480 => 480.0,
    };
    let (w, h) = (f64::from(first_w.max(2)), f64::from(first_h.max(2)));
    if w >= h {
        (even((target * w / h).round() as u32), even(target as u32))
    } else {
        (even(target as u32), even((target * h / w).round() as u32))
    }
}

fn clamp_volume(v: f64) -> f64 {
    if v.is_finite() { v.clamp(0.0, 2.0) } else { 1.0 }
}

/// Membangun filter_complex. Masukan 0..N-1 adalah klip (dalam urutan), masukan N adalah musik bila ada.
pub fn build_filter(plan: &Plan) -> String {
    let (w, h) = (plan.width, plan.height);
    let fps = plan.fps;
    let n = plan.segments.len();
    let total = plan.total();
    let any_clip_audio = plan.segments.iter().any(|s| s.has_audio);
    let music = plan.music.as_ref();
    // Mode "campur" tanpa suara video sama saja dengan musik saja.
    let replace = music.is_some_and(|m| m.mode == MusicMode::Replace || !any_clip_audio);
    let want_audio = music.is_some() || any_clip_audio;
    // Suara klip hanya dipakai bila ada yang membutuhkannya (tanpa musik, atau musik dicampur).
    let use_clip_audio = want_audio && !replace;

    let mut parts: Vec<String> = Vec::new();
    let mut cat = String::new();
    for (i, seg) in plan.segments.iter().enumerate() {
        parts.push(format!(
            "[{i}:v:0]scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps:.3},format=yuv420p[v{i}]"
        ));
        cat.push_str(&format!("[v{i}]"));
        if use_clip_audio {
            if seg.has_audio {
                parts.push(format!("[{i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a{i}]"));
            } else {
                parts.push(format!("anullsrc=r=48000:cl=stereo,atrim=duration={:.3},asetpts=PTS-STARTPTS[a{i}]", seg.duration));
            }
            cat.push_str(&format!("[a{i}]"));
        }
    }
    let outs = if use_clip_audio { "v=1:a=1[v][ac]" } else { "v=1:a=0[v]" };
    parts.push(format!("{cat}concat=n={n}:{outs}"));

    if let Some(m) = music {
        let mv = clamp_volume(m.music_volume);
        // musik: samakan format, atur volume, perpanjang dengan hening bila pendek, potong tepat sepanjang video
        parts.push(format!(
            "[{n}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={mv:.3},apad=whole_dur={total:.3},atrim=duration={total:.3},asetpts=PTS-STARTPTS[am]"
        ));
        let mixed = if replace {
            "[am]".to_string()
        } else {
            let vv = clamp_volume(m.video_volume);
            parts.push(format!("[ac]volume={vv:.3}[av]"));
            parts.push("[av][am]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mx]".into());
            "[mx]".to_string()
        };
        parts.push(if m.fade_out {
            let fade = (total / 2.0).min(3.0);
            format!("{mixed}afade=t=out:st={:.3}:d={fade:.3}[aout]", (total - fade).max(0.0))
        } else {
            format!("{mixed}anull[aout]")
        });
    } else if use_clip_audio {
        parts.push("[ac]anull[aout]".into());
    }
    parts.join(";")
}

/// Semua argumen ffmpeg (setelah opsi global), termasuk berkas keluaran.
pub fn build_args(plan: &Plan, output: &Path) -> Vec<OsString> {
    let mut a: Vec<OsString> = Vec::new();
    for seg in &plan.segments {
        a.extend(os(&["-ss", &format!("{:.3}", seg.start), "-t", &format!("{:.3}", seg.duration), "-i"]));
        a.push(seg.path.clone().into());
    }
    if let Some(m) = &plan.music {
        if m.looped {
            a.extend(os(&["-stream_loop", "-1"]));
        }
        a.push("-i".into());
        a.push(m.path.clone().into());
    }
    let filter = build_filter(plan);
    let has_audio_out = filter.contains("[aout]");
    a.extend(os(&["-filter_complex", &filter, "-map", "[v]"]));
    if has_audio_out {
        a.extend(os(&["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]));
    }
    a.extend(os(&["-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]));
    // Batas pengaman: tidak pernah lebih panjang dari jumlah potongan.
    a.extend(os(&["-t", &format!("{:.3}", plan.total())]));
    a.push(output.into());
    a
}

fn explain(name: &str, e: &str) -> String {
    format!("{name}: {e}")
}

fn file_name(p: &Path) -> String {
    p.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string()
}

/// Memeriksa semua masukan dan menyusun rencana. `video_probe` dan `audio_probe` diberikan agar tidak terikat pada AppHandle.
pub fn make_plan(
    clips: &[EditorClip],
    infos: &[MediaInfo],
    music: Option<(&EditorMusic, &MediaInfo)>,
    size: OutSize,
) -> Result<Plan, String> {
    if clips.is_empty() {
        return Err("Tambahkan minimal satu klip video".into());
    }
    if clips.len() > MAX_CLIPS {
        return Err(format!("Terlalu banyak klip (maksimal {MAX_CLIPS})"));
    }
    let mut segments = Vec::with_capacity(clips.len());
    for (clip, info) in clips.iter().zip(infos) {
        let path = PathBuf::from(&clip.path);
        let duration = info.duration.ok_or_else(|| explain(&file_name(&path), "durasi tidak terbaca"))?;
        let (start, end) = validate_range(clip.start, clip.end, duration).map_err(|e| explain(&file_name(&path), &e))?;
        segments.push(Segment { path, start, duration: end - start, has_audio: info.has_audio });
    }
    let first = &infos[0];
    let (width, height) = target_size(first.width.unwrap_or(1280), first.height.unwrap_or(720), size);
    let fps = first.fps.filter(|f| (1.0..=60.0).contains(f)).unwrap_or(30.0);

    let music = match music {
        None => None,
        Some((m, info)) => {
            let name = file_name(Path::new(&m.path));
            if !info.has_audio {
                return Err(explain(&name, "tidak berisi suara"));
            }
            Some(MusicPlan {
                path: PathBuf::from(&m.path),
                mode: m.mode,
                music_volume: m.music_volume,
                video_volume: m.video_volume,
                looped: m.loop_music,
                fade_out: m.fade_out,
            })
        }
    };
    Ok(Plan { segments, music, width, height, fps })
}

async fn probe_music(app: &AppHandle, path: &Path) -> Result<MediaInfo, String> {
    if !path.is_file() {
        return Err(format!("File tidak ditemukan: {}", path.display()));
    }
    let ffprobe = engine::resolve(app, "ffprobe").ok_or_else(|| MISSING_FFMPEG.to_string())?;
    ffmpeg::probe(&ffprobe, path).await.ok_or_else(|| format!("{}: tidak terbaca sebagai audio", file_name(path)))
}

/// Durasi sebuah berkas suara (detik); galat bila tidak berisi suara.
#[tauri::command]
pub async fn audio_info(app: AppHandle, path: String) -> Result<f64, String> {
    let p = Path::new(&path);
    let info = probe_music(&app, p).await?;
    if !info.has_audio {
        return Err(explain(&file_name(p), "tidak berisi suara"));
    }
    info.duration.ok_or_else(|| explain(&file_name(p), "durasi tidak terbaca"))
}

#[tauri::command]
pub async fn export_video_project(app: AppHandle, jobs: State<'_, Jobs>, req: EditorRequest) -> Result<EditResult, String> {
    check_out_dir(&req.out_dir)?;
    let ffmpeg_bin = engine::resolve(&app, "ffmpeg").ok_or_else(|| MISSING_FFMPEG.to_string())?;
    let mut infos = Vec::with_capacity(req.clips.len());
    for clip in &req.clips {
        infos.push(probe_video(&app, Path::new(&clip.path)).await?);
    }
    let music_info = match &req.music {
        Some(m) => Some(probe_music(&app, Path::new(&m.path)).await?),
        None => None,
    };
    let plan = make_plan(&req.clips, &infos, req.music.as_ref().zip(music_info.as_ref()), req.size)?;

    let first = &plan.segments[0].path;
    let dir = fsutil::output_dir(first, req.out_dir.as_deref());
    let output = fsutil::unique_path(&dir, &format!("{}_edit", fsutil::stem_of(first)), "mp4");
    let total = plan.total();

    let mut cancel = jobs.register(&req.job_id);
    let result = ffmpeg::run(&ffmpeg_bin, &build_args(&plan, &output), Some(total), &mut cancel, |p| ffmpeg::emit_progress(&app, &req.job_id, p)).await;
    jobs.finish(&req.job_id);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&output);
        return Err(e.into_message());
    }
    ffmpeg::emit_progress(&app, &req.job_id, 100.0);

    let actual = match engine::resolve(&app, "ffprobe") {
        Some(p) => ffmpeg::probe(&p, &output).await.and_then(|i| i.duration).unwrap_or(total),
        None => total,
    };
    Ok(EditResult { output: output.to_string_lossy().into_owned(), expected_sec: total, actual_sec: actual, method: "reencode" })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(name: &str, start: f64, duration: f64, audio: bool) -> Segment {
        Segment { path: PathBuf::from(name), start, duration, has_audio: audio }
    }

    fn plan(segments: Vec<Segment>, music: Option<MusicPlan>) -> Plan {
        Plan { segments, music, width: 640, height: 360, fps: 30.0 }
    }

    fn music(mode: MusicMode) -> MusicPlan {
        MusicPlan { path: PathBuf::from("lagu.mp3"), mode, music_volume: 0.5, video_volume: 1.0, looped: false, fade_out: false }
    }

    #[test]
    fn output_size_keeps_the_shape_and_is_even() {
        assert_eq!(target_size(1921, 1081, OutSize::First), (1920, 1080));
        assert_eq!(target_size(1920, 1080, OutSize::P720), (1280, 720));
        assert_eq!(target_size(1440, 1080, OutSize::P480), (640, 480));
        // vertikal: sisi pendek yang menjadi target
        assert_eq!(target_size(1080, 1920, OutSize::P720), (720, 1280));
        assert_eq!(target_size(1000, 1000, OutSize::P480), (480, 480));
        assert!(target_size(333, 777, OutSize::P1080).0 % 2 == 0);
    }

    #[test]
    fn silent_video_without_music_has_no_audio_at_all() {
        let f = build_filter(&plan(vec![seg("a.mp4", 0.0, 2.0, false)], None));
        assert!(!f.contains("[aout]") && !f.contains("anullsrc") && f.contains("concat=n=1:v=1:a=0[v]"), "{f}");
    }

    #[test]
    fn clips_without_sound_get_silence_so_the_sound_stays_in_sync() {
        let f = build_filter(&plan(vec![seg("a.mp4", 0.0, 2.0, true), seg("b.mp4", 1.0, 3.0, false)], None));
        assert!(f.contains("[0:a:0]aresample") && f.contains("anullsrc=r=48000:cl=stereo,atrim=duration=3.000"), "{f}");
        assert!(f.contains("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][ac]") && f.ends_with("[ac]anull[aout]"), "{f}");
    }

    #[test]
    fn replace_mode_drops_the_video_sound() {
        let f = build_filter(&plan(vec![seg("a.mp4", 0.0, 4.0, true)], Some(music(MusicMode::Replace))));
        assert!(!f.contains("[0:a:0]") && !f.contains("amix") && f.contains("concat=n=1:v=1:a=0[v]"), "{f}");
        assert!(f.contains("[1:a:0]aresample") && f.contains("volume=0.500") && f.contains("apad=whole_dur=4.000,atrim=duration=4.000"), "{f}");
        assert!(f.ends_with("[am]anull[aout]"), "{f}");
    }

    #[test]
    fn mix_mode_blends_both_with_their_own_volumes() {
        let mut m = music(MusicMode::Mix);
        m.video_volume = 0.8;
        let f = build_filter(&plan(vec![seg("a.mp4", 0.0, 4.0, true), seg("b.mp4", 0.0, 2.0, true)], Some(m)));
        assert!(f.contains("[ac]volume=0.800[av]") && f.contains("[2:a:0]aresample"), "music is input 2 after two clips: {f}");
        assert!(f.contains("[av][am]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mx]"), "{f}");
        assert!(f.ends_with("[mx]anull[aout]"), "{f}");
    }

    #[test]
    fn mix_with_only_silent_clips_is_just_the_music() {
        let f = build_filter(&plan(vec![seg("a.mp4", 0.0, 4.0, false)], Some(music(MusicMode::Mix))));
        assert!(!f.contains("amix") && f.contains("[am]anull[aout]"), "{f}");
    }

    #[test]
    fn fade_out_lasts_at_most_three_seconds_and_half_of_a_short_video() {
        let mut m = music(MusicMode::Replace);
        m.fade_out = true;
        let long = build_filter(&plan(vec![seg("a.mp4", 0.0, 20.0, true)], Some(m.clone())));
        assert!(long.ends_with("afade=t=out:st=17.000:d=3.000[aout]"), "{long}");
        let short = build_filter(&plan(vec![seg("a.mp4", 0.0, 2.0, true)], Some(m)));
        assert!(short.ends_with("afade=t=out:st=1.000:d=1.000[aout]"), "{short}");
    }

    #[test]
    fn volumes_are_clamped_to_a_sane_range() {
        let mut m = music(MusicMode::Replace);
        m.music_volume = 99.0;
        assert!(build_filter(&plan(vec![seg("a.mp4", 0.0, 2.0, true)], Some(m.clone()))).contains("volume=2.000"));
        m.music_volume = f64::NAN;
        assert!(build_filter(&plan(vec![seg("a.mp4", 0.0, 2.0, true)], Some(m.clone()))).contains("volume=1.000"));
        m.music_volume = -3.0;
        assert!(build_filter(&plan(vec![seg("a.mp4", 0.0, 2.0, true)], Some(m))).contains("volume=0.000"));
    }

    #[test]
    fn arguments_seek_each_clip_and_loop_the_music_when_asked() {
        let mut m = music(MusicMode::Mix);
        m.looped = true;
        let a: Vec<String> = build_args(&plan(vec![seg("a.mp4", 1.5, 2.0, true), seg("b.mp4", 0.0, 3.0, true)], Some(m)), Path::new("/o/out.mp4"))
            .iter()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        let at = |needle: &str| a.iter().position(|x| x == needle).unwrap_or_else(|| panic!("{needle} not in {a:?}"));
        assert_eq!(&a[at("-ss")..at("-ss") + 5], ["-ss", "1.500", "-t", "2.000", "-i"]);
        assert_eq!(a[at("a.mp4") - 1], "-i");
        assert_eq!(&a[at("-stream_loop")..at("-stream_loop") + 4], ["-stream_loop", "-1", "-i", "lagu.mp3"]);
        assert_eq!(a[at("-map") + 1], "[v]");
        assert!(a.contains(&"[aout]".to_string()) && a.contains(&"aac".to_string()) && a.contains(&"libx264".to_string()));
        assert_eq!(a.last().unwrap(), "/o/out.mp4");
        assert_eq!(a[at("-t") + 1], "2.000", "durasi klip pertama muncul lebih dulu; batas total ada sebelum berkas keluaran");
        assert_eq!(a[a.len() - 3], "-t");
        assert_eq!(a[a.len() - 2], "5.000");
    }

    fn info(duration: f64, w: u32, h: u32, audio: bool) -> MediaInfo {
        MediaInfo {
            duration: Some(duration),
            has_audio: audio,
            width: Some(w),
            height: Some(h),
            video_codec: Some("h264".into()),
            audio_codec: audio.then(|| "aac".into()),
            fps: Some(25.0),
            pix_fmt: Some("yuv420p".into()),
            sample_rate: audio.then_some(44100),
            channels: audio.then_some(2),
        }
    }

    fn clip(path: &str, start: f64, end: f64) -> EditorClip {
        EditorClip { path: path.into(), start, end }
    }

    #[test]
    fn the_plan_is_checked_before_anything_runs() {
        let ok = make_plan(&[clip("a.mp4", 1.0, 3.0), clip("b.mp4", 0.0, 99.0)], &[info(10.0, 1280, 720, true), info(5.0, 640, 360, false)], None, OutSize::P480).unwrap();
        assert_eq!((ok.width, ok.height), (852, 480), "480 × 640/360 = 853,3 → 853 → dibulatkan ke bawah menjadi genap");
        assert!((ok.total() - 7.0).abs() < 1e-9, "klip kedua dipotong sampai akhir videonya (5 detik): 2 + 5");
        assert_eq!(ok.fps, 25.0);

        assert!(make_plan(&[], &[], None, OutSize::First).unwrap_err().contains("minimal satu"));
        let err = make_plan(&[clip("a.mp4", 5.0, 5.0)], &[info(10.0, 640, 360, true)], None, OutSize::First).unwrap_err();
        assert!(err.starts_with("a.mp4:"), "{err}");
        let err = make_plan(&[clip("a.mp4", 20.0, 30.0)], &[info(10.0, 640, 360, true)], None, OutSize::First).unwrap_err();
        assert!(err.contains("a.mp4"), "{err}");

        let m = EditorMusic { path: "sunyi.mp3".into(), mode: MusicMode::Mix, music_volume: 1.0, video_volume: 1.0, loop_music: false, fade_out: false };
        let err = make_plan(&[clip("a.mp4", 0.0, 2.0)], &[info(10.0, 640, 360, true)], Some((&m, &info(3.0, 0, 0, false))), OutSize::First).unwrap_err();
        assert!(err.contains("sunyi.mp3") && err.contains("tidak berisi suara"), "{err}");
    }

    /// Dengan ffmpeg asli; jalankan dengan:
    ///   cargo test real_editor -- --ignored --nocapture
    #[cfg(unix)]
    #[tokio::test]
    #[ignore]
    async fn real_editor_exports_cut_joined_clips_with_music() {
        use crate::toolbox::ffmpeg::testutil;
        let (ffmpeg_bin, ffprobe) = testutil::engines().expect("no ffmpeg");
        let dir = std::env::temp_dir().join(format!("toolbox-editor-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| assert!(std::process::Command::new(&ffmpeg_bin).args(["-hide_banner", "-loglevel", "error", "-y"]).args(args).status().unwrap().success());
        let (a, b, song) = (dir.join("a.mp4"), dir.join("b.mp4"), dir.join("lagu.wav"));
        // A: 4 detik 320x180 dengan suara; B: 3 detik 640x360 TANPA suara; lagu: 1 detik (lebih pendek dari hasil)
        run(&["-f", "lavfi", "-i", "testsrc2=duration=4:size=320x180:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest", "-c:v", "libx264", "-c:a", "aac", a.to_str().unwrap()]);
        run(&["-f", "lavfi", "-i", "testsrc2=duration=3:size=640x360:rate=25", "-c:v", "libx264", b.to_str().unwrap()]);
        run(&["-f", "lavfi", "-i", "sine=frequency=880:duration=1", song.to_str().unwrap()]);

        let ia = ffmpeg::probe(&ffprobe, &a).await.unwrap();
        let ib = ffmpeg::probe(&ffprobe, &b).await.unwrap();
        let isong = ffmpeg::probe(&ffprobe, &song).await.unwrap();
        assert!(ia.has_audio && !ib.has_audio && isong.has_audio);
        let clips = [clip(a.to_str().unwrap(), 1.0, 3.0), clip(b.to_str().unwrap(), 0.0, 2.0)]; // 2 + 2 = 4 detik

        for (tag, music, expect_audio) in [
            ("tanpa-musik", None, true),
            ("ganti", Some(EditorMusic { path: song.to_str().unwrap().into(), mode: MusicMode::Replace, music_volume: 1.0, video_volume: 1.0, loop_music: true, fade_out: true }), true),
            ("campur", Some(EditorMusic { path: song.to_str().unwrap().into(), mode: MusicMode::Mix, music_volume: 0.5, video_volume: 0.8, loop_music: false, fade_out: false }), true),
        ] {
            let plan = make_plan(&clips, &[ia.clone(), ib.clone()], music.as_ref().map(|m| (m, &isong)), OutSize::First).unwrap();
            let out = dir.join(format!("{tag}.mp4"));
            let (_tx, mut rx) = tokio::sync::oneshot::channel::<()>();
            let mut last = 0.0;
            ffmpeg::run(&ffmpeg_bin, &build_args(&plan, &out), Some(plan.total()), &mut rx, |p| last = p).await.unwrap_or_else(|e| panic!("{tag}: {e:?}"));
            let got = ffmpeg::probe(&ffprobe, &out).await.unwrap();
            println!("{tag}: {:?}s {}x{} audio={} progress={last}", got.duration, got.width.unwrap(), got.height.unwrap(), got.has_audio);
            assert!((got.duration.unwrap() - 4.0).abs() < 0.3, "{tag}: durasi {:?}", got.duration);
            assert_eq!((got.width, got.height), (Some(320), Some(180)), "{tag}: mengikuti klip pertama");
            assert_eq!(got.has_audio, expect_audio, "{tag}");

            // Isi suaranya, bukan hanya adanya: rata-rata volume pada dua jendela waktu (dB; -inf = hening).
            let loud = |from: f64| {
                let out_text = std::process::Command::new(&ffmpeg_bin)
                    .args(["-hide_banner", "-ss", &from.to_string(), "-t", "0.5", "-i"])
                    .arg(&out)
                    .args(["-vn", "-af", "volumedetect", "-f", "null", "-"])
                    .output()
                    .unwrap();
                let text = String::from_utf8_lossy(&out_text.stderr).into_owned();
                text.lines().find_map(|l| l.split("mean_volume:").nth(1)).map(|v| v.trim().trim_end_matches(" dB").parse::<f64>().unwrap_or(-91.0)).unwrap_or(-91.0)
            };
            let (early, late) = (loud(0.2), loud(2.5)); // 0,2-0,7 s: klip A (sinus) dan lagu; 2,5-3,0 s: klip B (tanpa suara)
            println!("{tag}: awal {early:.1} dB, akhir {late:.1} dB");
            match tag {
                "tanpa-musik" => assert!(early > -40.0 && late < -60.0, "klip A bersuara, klip B hening: {early} / {late}"),
                "ganti" => assert!(early > -40.0 && late > -45.0, "lagu diulang sampai akhir: {early} / {late}"),
                "campur" => assert!(early > -40.0 && late < -60.0, "lagu 1 detik tidak diulang, setelahnya hening karena klip B bisu: {early} / {late}"),
                _ => unreachable!(),
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
