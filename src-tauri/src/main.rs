// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Harus pertama: installer Velopack memanggil app ini dengan argumen khusus saat pasang, perbarui, dan hapus.
    #[cfg(windows)]
    velopack::VelopackApp::build().run();
    // `cognify --mcp` menjadi server MCP lewat stdio (tanpa jendela); lihat docs/MCP.md.
    if std::env::args().skip(1).any(|a| a == "--mcp") {
        std::process::exit(cognify_lib::run_mcp());
    }
    cognify_lib::run()
}
