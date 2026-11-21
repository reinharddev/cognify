// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Harus pertama: installer Velopack memanggil app ini dengan argumen khusus saat pasang, perbarui, dan hapus.
    #[cfg(windows)]
    velopack::VelopackApp::build().run();
    // `cognify --mcp` menjadi server MCP lewat stdio (tanpa jendela); lihat docs/arsitektur/mcp-ai.md.
    if std::env::args().skip(1).any(|a| a == "--mcp") {
        std::process::exit(cognify_lib::run_mcp());
    }
    // `cognify --transcribe ...`: proses anak transkripsi (whisper.cpp), dijalankan oleh app sendiri.
    if std::env::args().nth(1).as_deref() == Some("--transcribe") {
        let args: Vec<String> = std::env::args().skip(1).collect();
        std::process::exit(cognify_lib::run_transcribe(&args));
    }
    cognify_lib::run()
}
