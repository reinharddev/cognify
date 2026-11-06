//! Web ke PDF dan ekspor halaman Cognify ke PDF lewat jalur cetak sistem ("Simpan sebagai PDF").
//!
//! Halaman web dibuka di jendela terpisah. Jendela itu berlabel lain dari `main`, sehingga tidak masuk ke capability
//! mana pun dan situs di dalamnya TIDAK punya akses ke perintah app (IPC). Webview dibuat dalam mode privat (tanpa
//! cookie atau data yang tersimpan) dan hanya boleh berpindah ke alamat http atau https. Pengguna melihat halamannya,
//! bisa menutup spanduk cookie atau masuk sendiri bila perlu, lalu mencetaknya ke PDF dengan pengatur halaman sistem
//! (yang menjaga pemotongan halaman dan teks yang bisa dipilih). Tidak ada usaha menembus paywall atau login.

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::toolbox::ytdlp::validate_url;

const LABEL: &str = "webpdf";

/// Alamat yang boleh dibuka: hanya http(s), tanpa spasi atau karakter kendali. Mengembalikan alamat dan nama situsnya.
pub fn parse_target(input: &str) -> Result<(Url, String), String> {
    let clean = validate_url(input).map_err(|_| "Alamat harus diawali http:// atau https://".to_string())?;
    let url: Url = clean.parse().map_err(|_| "Alamat tidak sah".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Alamat harus diawali http:// atau https://".into());
    }
    let host = url.host_str().filter(|h| !h.is_empty()).ok_or_else(|| "Alamat tidak sah".to_string())?.to_string();
    Ok((url, host))
}

/// Cetak isi webview: macOS memakai API Tauri; platform lain memakai `window.print()` di dalam halaman.
fn print(window: &WebviewWindow) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        window.print().map_err(|e| format!("Jendela cetak tidak bisa dibuka: {e}"))
    } else {
        window.eval("window.print()").map_err(|e| format!("Jendela cetak tidak bisa dibuka: {e}"))
    }
}

/// Buka halaman web di jendela pratinjau. Mengembalikan nama situs.
#[tauri::command]
pub async fn webpdf_open(app: AppHandle, url: String) -> Result<String, String> {
    let (target, host) = parse_target(&url)?;
    let title = format!("Web ke PDF: {host}");
    if let Some(existing) = app.get_webview_window(LABEL) {
        existing.navigate(target).map_err(|e| e.to_string())?;
        let _ = existing.set_title(&title);
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(host);
    }
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(target))
        .title(title)
        .inner_size(1100.0, 800.0)
        .incognito(true)
        .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "about" | "blob" | "data"))
        .build()
        .map_err(|e| format!("Jendela pratinjau tidak bisa dibuka: {e}"))?;
    Ok(host)
}

/// Buka pengatur cetak untuk halaman yang sedang tampil di jendela pratinjau.
#[tauri::command]
pub async fn webpdf_print(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window(LABEL).ok_or("Buka halamannya dulu")?;
    let _ = window.set_focus();
    print(&window)
}

#[tauri::command]
pub async fn webpdf_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Ekspor halaman Cognify yang sedang terbuka: pengatur cetak sistem, tempat pengguna memilih "Simpan sebagai PDF".
/// Bagian antarmuka (menu samping, toolbar) disembunyikan oleh gaya cetak di `app.css`.
#[tauri::command]
pub async fn print_page(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("Jendela utama tidak ditemukan")?;
    print(&window)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_web_addresses_are_opened() {
        let (url, host) = parse_target("  https://id.wikipedia.org/wiki/Fotosintesis  ").unwrap();
        assert_eq!((url.scheme(), host.as_str()), ("https", "id.wikipedia.org"));
        assert_eq!(parse_target("http://localhost:8080/x").unwrap().1, "localhost");
        // standar URL meratakan garis miring berlebih, sama seperti browser: https:///x adalah https://x/
        assert_eq!(parse_target("https:///x").unwrap().1, "x");
        for bad in ["", "example.com", "file:///etc/passwd", "javascript:alert(1)", "ftp://x/y", "tauri://localhost", "https://", "https://a b", "data:text/html,hi", "-o /tmp/x"] {
            assert!(parse_target(bad).is_err(), "{bad:?} seharusnya ditolak");
        }
    }
}
