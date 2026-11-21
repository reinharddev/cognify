//! `cognify --transcribe --model <berkas> --pcm <berkas> --lang <kode|auto> --threads <n>`
//!
//! Proses anak tanpa jendela yang menjalankan whisper.cpp pada PCM 16 kHz mono 16-bit dan
//! menulis satu pesan JSON per baris ke stdout (`ChildMsg`). Dipanggil oleh
//! `toolbox::transcribe`, yang menjalankannya dengan prioritas rendah dan mematikannya bila
//! pengguna membatalkan. stdout hanya berisi pesan protokol; log whisper.cpp masuk ke stderr.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
};

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::toolbox::transcribe::{next_cut, ChildMsg, SAMPLE_RATE};

fn emit(msg: &ChildMsg) {
    let mut out = std::io::stdout().lock();
    if let Ok(line) = serde_json::to_string(msg) {
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}

struct Args {
    model: String,
    pcm: String,
    lang: String,
    threads: i32,
}

fn parse_args(args: &[String]) -> Result<Args, String> {
    let mut a = Args { model: String::new(), pcm: String::new(), lang: "auto".into(), threads: 2 };
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        let mut value = || it.next().cloned().ok_or_else(|| format!("{flag} butuh nilai"));
        match flag.as_str() {
            "--transcribe" => {}
            "--model" => a.model = value()?,
            "--pcm" => a.pcm = value()?,
            "--lang" => a.lang = value()?,
            "--threads" => a.threads = value()?.parse::<i32>().map_err(|_| "--threads bukan angka".to_string())?.clamp(1, 16),
            other => return Err(format!("argumen tidak dikenal: {other}")),
        }
    }
    if a.model.is_empty() || a.pcm.is_empty() {
        return Err("--model dan --pcm wajib".into());
    }
    if !crate::toolbox::transcribe::valid_language(&a.lang) {
        return Err("bahasa tidak valid".into());
    }
    Ok(a)
}

fn read_i16(file: &mut File, from: usize, to: usize) -> std::io::Result<Vec<i16>> {
    file.seek(SeekFrom::Start(from as u64 * 2))?;
    let mut bytes = vec![0u8; (to - from) * 2];
    file.read_exact(&mut bytes)?;
    Ok(bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect())
}

/// Titik masuk. Mengembalikan kode keluar proses.
pub fn run(args: &[String]) -> i32 {
    match transcribe(args) {
        Ok(()) => {
            emit(&ChildMsg::Done);
            0
        }
        Err(message) => {
            emit(&ChildMsg::Error { message });
            1
        }
    }
}

fn transcribe(args: &[String]) -> Result<(), String> {
    let a = parse_args(args)?;
    let mut file = File::open(&a.pcm).map_err(|e| format!("Audio tidak bisa dibuka: {e}"))?;
    let total = (file.metadata().map_err(|e| e.to_string())?.len() / 2) as usize;
    if total < SAMPLE_RATE / 10 {
        return Err("Audionya terlalu pendek atau kosong".into());
    }

    let ctx = WhisperContext::new_with_params(Path::new(&a.model), WhisperContextParameters::default())
        .map_err(|e| format!("Model tidak bisa dimuat: {e}"))?;
    let mut state = ctx.create_state().map_err(|e| format!("Whisper tidak bisa dimulai: {e}"))?;

    let mut start = 0usize;
    let mut language_sent = false;
    while start < total {
        let cut = next_cut(start, total, |from, to| read_i16(&mut File::open(&a.pcm).expect("pcm"), from, to).unwrap_or_default());
        let cut = cut.clamp(start + 1, total);
        let samples: Vec<f32> = read_i16(&mut file, start, cut)
            .map_err(|e| format!("Audio gagal dibaca: {e}"))?
            .iter()
            .map(|&s| s as f32 / 32768.0)
            .collect();

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(a.threads);
        params.set_language(Some(a.lang.as_str()));
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_no_context(true);

        let (chunk_start, chunk_len) = (start, cut - start);
        let mut last = -1i32;
        params.set_progress_callback_safe(move |p: i32| {
            if p != last {
                last = p;
                let done = chunk_start as f64 + chunk_len as f64 * (p as f64 / 100.0);
                emit(&ChildMsg::Progress { percent: (done / total as f64 * 100.0).clamp(0.0, 99.0) });
            }
        });

        state.full(params, &samples).map_err(|e| format!("Transkripsi gagal: {e}"))?;

        if !language_sent {
            language_sent = true;
            if let Some(code) = whisper_rs::get_lang_str(state.full_lang_id_from_state()) {
                emit(&ChildMsg::Language { code: code.to_string() });
            }
        }

        let offset = start as f64 / SAMPLE_RATE as f64;
        for seg in state.as_iter() {
            let text = seg.to_str_lossy().map_err(|e| e.to_string())?.trim().to_string();
            if text.is_empty() || text == "[BLANK_AUDIO]" || seg.no_speech_probability() > 0.9 {
                continue;
            }
            // whisper.cpp memberi waktu dalam kelipatan 10 ms
            emit(&ChildMsg::Segment {
                start: offset + seg.start_timestamp() as f64 / 100.0,
                end: offset + seg.end_timestamp() as f64 / 100.0,
                text,
            });
        }
        start = cut;
    }
    emit(&ChildMsg::Progress { percent: 100.0 });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn arguments_are_parsed_and_validated() {
        let a = parse_args(&args(&["--transcribe", "--model", "m.bin", "--pcm", "a.pcm", "--lang", "id", "--threads", "4"])).unwrap();
        assert_eq!((a.model.as_str(), a.pcm.as_str(), a.lang.as_str(), a.threads), ("m.bin", "a.pcm", "id", 4));
        assert!(parse_args(&args(&["--transcribe", "--pcm", "a.pcm"])).is_err());
        assert!(parse_args(&args(&["--transcribe", "--model", "m", "--pcm", "p", "--lang", "ID"])).is_err());
        assert!(parse_args(&args(&["--transcribe", "--model", "m", "--pcm", "p", "--bogus"])).is_err());
        let capped = parse_args(&args(&["--transcribe", "--model", "m", "--pcm", "p", "--threads", "99"])).unwrap();
        assert_eq!(capped.threads, 16);
    }
}
