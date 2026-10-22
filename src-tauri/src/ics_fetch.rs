//! Mengambil teks kalender ICS dari tautan langganan yang diketik pengguna sendiri. Hanya https,
//! pengalihan ke selain https ditolak, ukuran dibatasi, dan tidak ada cookie atau data lain yang dikirim.

use std::time::Duration;

use futures_util::StreamExt;

pub const MAX_BYTES: usize = 5 * 1024 * 1024;

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent("Cognify (kalender)")
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() == "https" && attempt.previous().len() < 5 { attempt.follow() } else { attempt.stop() }
        }))
        .build()
        .map_err(|e| format!("Pengambilan kalender tidak bisa dimulai: {e}"))
}

/// Pesan yang ramah untuk kegagalan jaringan, tanpa menampilkan tautan (bisa memuat rahasia).
fn friendly(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "Server kalender terlalu lama menjawab.".into()
    } else if e.is_connect() {
        "Tidak bisa terhubung ke server kalender. Periksa koneksi internetmu.".into()
    } else {
        "Kalender tidak bisa diambil.".into()
    }
}

pub async fn fetch(url: &str) -> Result<String, String> {
    let resp = client()?.get(url).send().await.map_err(|e| friendly(&e))?;
    let status = resp.status();
    if status.is_redirection() {
        return Err("Server kalender mengalihkan ke alamat yang tidak aman, jadi dibatalkan.".into());
    }
    if status.as_u16() == 401 || status.as_u16() == 403 || status.as_u16() == 404 {
        return Err("Tautan kalender ditolak atau tidak ditemukan. Salin ulang tautan rahasianya.".into());
    }
    if !status.is_success() {
        return Err(format!("Server kalender menjawab dengan kode {}.", status.as_u16()));
    }
    if resp.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return Err("Kalender terlalu besar (maksimal 5 MB).".into());
    }
    let mut body: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| friendly(&e))?;
        if body.len() + chunk.len() > MAX_BYTES {
            return Err("Kalender terlalu besar (maksimal 5 MB).".into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| "Isinya bukan teks kalender.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_unreachable_host_gives_a_friendly_message_without_leaking_the_url() {
        // .invalid dijamin tidak pernah ada (RFC 2606).
        let err = fetch("https://rahasia-token-123.tidak-ada.invalid/cal.ics").await.unwrap_err();
        assert!(!err.contains("rahasia-token-123"), "{err}");
        assert!(err.contains("kalender"), "{err}");
    }
}
