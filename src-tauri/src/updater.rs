//! Pembaruan Cognify: cek, unduh, dan pasang dari rilis "Latest" di GitHub milik proyek ini.
//!
//! - **Windows:** Velopack (`releases.win.json` di `releases/latest/download`), paket selisih bila ada. Hanya bekerja
//!   bila app dipasang oleh installer Velopack; saat dijalankan langsung (pengembangan) kembali ke mode "beri tahu".
//! - **macOS:** DMG dari rilis GitHub diunduh ke folder cache, **tanda tangannya diperiksa** (Developer ID dan Team ID
//!   Cognify) sebelum dan sesudah dipasang, lalu skrip kecil menunggu app keluar, mengganti `Cognify.app`, dan
//!   membukanya lagi. Bila penggantian gagal, DMG dibuka supaya bisa dipasang manual.
//!
//! Privasi: satu-satunya permintaan keluar adalah daftar rilis dan berkas rilis di GitHub; tidak ada informasi tentang
//! komputer atau isi catatan yang dikirim, dan hanya berjalan bila pemeriksaan diaktifkan di Pengaturan.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const REPO: &str = "reinharddev/cognify";
#[cfg(windows)]
const FEED: &str = "https://github.com/reinharddev/cognify/releases/latest/download";
#[cfg(target_os = "macos")]
const TEAM_ID: &str = "2YWT2B548R";

/// Pembaruan yang ditemukan, dikirim ke tampilan.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub version: String,
    pub notes: String,
    pub url: String,
    pub size: u64,
    /// App bisa memasang sendiri (Velopack di Windows, DMG di Mac); bila tidak, hanya diberi tahu dan dibuka halamannya.
    pub self_update: bool,
}

#[derive(Default)]
struct Inner {
    found: Option<Found>,
    #[cfg(windows)]
    velo: Option<velopack::UpdateInfo>,
    #[cfg(target_os = "macos")]
    dmg_url: Option<String>,
    #[cfg(target_os = "macos")]
    dmg: Option<std::path::PathBuf>,
    downloaded: bool,
}

#[derive(Default, Clone)]
pub struct Updater(Arc<Mutex<Inner>>);

#[derive(Clone, Serialize)]
struct Progress {
    received: u64,
    total: u64,
}

fn parse(v: &str) -> Vec<u64> {
    v.trim_start_matches('v').split('.').map(|n| n.split(|c: char| !c.is_ascii_digit()).next().unwrap_or("0").parse().unwrap_or(0)).collect()
}

/// `a` lebih baru dari `b` (angka per bagian, 0.10.0 > 0.9.0).
pub fn newer(a: &str, b: &str) -> bool {
    let (x, y) = (parse(a), parse(b));
    for i in 0..3 {
        let (p, q) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if p != q {
            return p > q;
        }
    }
    false
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent("Cognify-updater").timeout(std::time::Duration::from_secs(30)).build().map_err(|e| e.to_string())
}

#[cfg(windows)]
fn manager() -> Result<velopack::UpdateManager, String> {
    velopack::UpdateManager::new(velopack::sources::HttpSource::new(FEED), None, None).map_err(|e| e.to_string())
}

/// Bisa memasang pembaruan sendiri di komputer ini.
fn self_update_supported() -> bool {
    #[cfg(windows)]
    {
        manager().is_ok()
    }
    #[cfg(target_os = "macos")]
    {
        app_bundle().is_some()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
fn app_bundle() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors().find(|p| p.extension().map(|e| e == "app").unwrap_or(false)).map(|p| p.to_path_buf())
}

#[cfg(target_os = "macos")]
fn dmg_name_hint() -> &'static str {
    if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" }
}

#[tauri::command]
pub fn update_supported() -> bool {
    self_update_supported()
}

/// Versi baru bila ada. Windows dan Mac memakai sumber masing-masing; yang tidak bisa memasang sendiri hanya diberi tahu.
#[tauri::command]
pub async fn update_check(state: State<'_, Updater>) -> Result<Option<Found>, String> {
    let current = env!("CARGO_PKG_VERSION");
    let st = state.inner().clone();

    #[cfg(windows)]
    {
      if self_update_supported() {
        let st2 = st.clone();
        return tauri::async_runtime::spawn_blocking(move || -> Result<Option<Found>, String> {
            use velopack::UpdateCheck;
            match manager()?.check_for_updates().map_err(|e| e.to_string())? {
                UpdateCheck::UpdateAvailable(info) => {
                    let r = &info.TargetFullRelease;
                    let found = Found { version: r.Version.clone(), notes: r.NotesMarkdown.clone(), url: format!("https://github.com/{REPO}/releases/latest"), size: r.Size, self_update: true };
                    let mut g = st2.0.lock().unwrap();
                    g.found = Some(found.clone());
                    g.velo = Some(*info);
                    g.downloaded = false;
                    Ok(Some(found))
                }
                _ => Ok(None),
            }
        })
        .await
        .map_err(|e| e.to_string())?;
      }
    }

    // Mac dan mode "beri tahu": rilis terbaru lewat API GitHub.
    let res = client()?.get(format!("https://api.github.com/repos/{REPO}/releases/latest")).header("Accept", "application/vnd.github+json").send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("GitHub {}", res.status()));
    }
    let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let tag = v["tag_name"].as_str().unwrap_or_default().to_string();
    if tag.is_empty() || !newer(&tag, current) {
        return Ok(None);
    }
    let mut found = Found {
        version: tag.trim_start_matches('v').to_string(),
        notes: v["body"].as_str().unwrap_or_default().to_string(),
        url: v["html_url"].as_str().unwrap_or("https://github.com/reinharddev/cognify/releases/latest").to_string(),
        size: 0,
        self_update: false,
    };
    #[cfg(target_os = "macos")]
    {
        let hint = dmg_name_hint();
        let asset = v["assets"].as_array().and_then(|a| a.iter().find(|x| x["name"].as_str().map(|n| n.starts_with("Cognify_") && n.ends_with(".dmg") && n.contains(hint)).unwrap_or(false)));
        if let (Some(a), true) = (asset, self_update_supported()) {
            found.size = a["size"].as_u64().unwrap_or(0);
            found.self_update = true;
            st.0.lock().unwrap().dmg_url = a["browser_download_url"].as_str().map(|s| s.to_string());
        }
    }
    let mut g = st.0.lock().unwrap();
    g.found = Some(found.clone());
    g.downloaded = false;
    Ok(Some(found))
}

/// Mengunduh pembaruan; kemajuan dikirim lewat peristiwa `update-progress`.
#[tauri::command]
pub async fn update_download(app: AppHandle, state: State<'_, Updater>) -> Result<(), String> {
    let st = state.inner().clone();

    #[cfg(windows)]
    {
        let info = st.0.lock().unwrap().velo.clone().ok_or("Belum ada pembaruan")?;
        let st2 = st.clone();
        return tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let (tx, rx) = std::sync::mpsc::channel::<i16>();
            let total = info.TargetFullRelease.Size;
            let a = app.clone();
            let t = std::thread::spawn(move || {
                for pct in rx {
                    let _ = a.emit("update-progress", Progress { received: total * pct.clamp(0, 100) as u64 / 100, total });
                }
            });
            let r = manager()?.download_updates(&info, Some(tx)).map_err(|e| e.to_string());
            let _ = t.join();
            if r.is_ok() {
                st2.0.lock().unwrap().downloaded = true;
            }
            r
        })
        .await
        .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        use tokio::io::AsyncWriteExt;
        let url = st.0.lock().unwrap().dmg_url.clone().ok_or("Belum ada pembaruan")?;
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("update");
        tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
        let file = dir.join("Cognify-update.dmg");
        let mut res = client_long()?.get(&url).send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("GitHub {}", res.status()));
        }
        let total = res.content_length().unwrap_or(0);
        let mut out = tokio::fs::File::create(&file).await.map_err(|e| e.to_string())?;
        let (mut received, mut last) = (0u64, 0u64);
        while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
            out.write_all(&chunk).await.map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            if total == 0 || received - last >= total / 100 + 1 {
                last = received;
                let _ = app.emit("update-progress", Progress { received, total });
            }
        }
        out.flush().await.map_err(|e| e.to_string())?;
        drop(out);
        let _ = app.emit("update-progress", Progress { received: total.max(received), total: total.max(received) });
        // Periksa tanda tangan sebelum dipercaya: salah satu berkas tidak boleh menimpa app begitu saja.
        let f2 = file.clone();
        tauri::async_runtime::spawn_blocking(move || verify_dmg(&f2)).await.map_err(|e| e.to_string())??;
        let mut g = st.0.lock().unwrap();
        g.dmg = Some(file);
        g.downloaded = true;
        return Ok(());
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, st);
        Err("Pemasangan otomatis tidak didukung di sini".into())
    }
}

#[cfg(target_os = "macos")]
fn client_long() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent("Cognify-updater").connect_timeout(std::time::Duration::from_secs(30)).build().map_err(|e| e.to_string())
}

/// Memasang DMG sementara, memeriksa Developer ID dan Team ID app di dalamnya, lalu melepasnya lagi.
#[cfg(target_os = "macos")]
fn verify_dmg(dmg: &std::path::Path) -> Result<(), String> {
    use std::process::Command;
    let mnt = std::env::temp_dir().join(format!("cognify-verify-{}", std::process::id()));
    std::fs::create_dir_all(&mnt).map_err(|e| e.to_string())?;
    let attach = Command::new("/usr/bin/hdiutil").args(["attach", "-nobrowse", "-readonly", "-noverify", "-mountpoint"]).arg(&mnt).arg(dmg).output().map_err(|e| e.to_string())?;
    if !attach.status.success() {
        let _ = std::fs::remove_dir_all(&mnt);
        return Err("Berkas unduhan tidak bisa dibuka".into());
    }
    let app = mnt.join("Cognify.app");
    let ok = Command::new("/usr/bin/codesign").args(["--verify", "--deep", "--strict"]).arg(&app).status().map(|s| s.success()).unwrap_or(false)
        && Command::new("/usr/bin/codesign").arg("-dv").arg(&app).output().map(|o| String::from_utf8_lossy(&o.stderr).contains(&format!("TeamIdentifier={TEAM_ID}"))).unwrap_or(false);
    let _ = Command::new("/usr/bin/hdiutil").args(["detach", "-quiet"]).arg(&mnt).status();
    let _ = std::fs::remove_dir(&mnt);
    if ok { Ok(()) } else { Err("Tanda tangan pembaruan tidak cocok; tidak dipasang".into()) }
}

/// Memasang pembaruan. `on_exit` = pasang nanti saat Cognify ditutup; kalau tidak, pasang sekarang dan mulai ulang.
#[tauri::command]
pub async fn update_apply(app: AppHandle, state: State<'_, Updater>, on_exit: bool) -> Result<(), String> {
    let st = state.inner().clone();
    if !st.0.lock().unwrap().downloaded {
        return Err("Pembaruan belum diunduh".into());
    }

    #[cfg(windows)]
    {
        let info = st.0.lock().unwrap().velo.clone().ok_or("Belum ada pembaruan")?;
        let r = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let m = manager()?;
            if on_exit {
                m.wait_exit_then_apply_updates(&info.TargetFullRelease, true, false, Vec::<String>::new()).map_err(|e| e.to_string())
            } else {
                m.apply_updates_and_restart(&info).map_err(|e| e.to_string()) // tidak kembali bila berhasil
            }
        })
        .await
        .map_err(|e| e.to_string())?;
        return r;
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::{Command, Stdio};
        use tauri::Manager;
        let dmg = st.0.lock().unwrap().dmg.clone().ok_or("Belum ada pembaruan")?;
        let bundle = app_bundle().ok_or("Cognify tidak dijalankan dari Cognify.app")?;
        let script = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("update").join("apply.sh");
        std::fs::write(&script, APPLY_SH).map_err(|e| e.to_string())?;
        Command::new("/bin/sh")
            .arg(&script)
            .arg(std::process::id().to_string())
            .arg(&dmg)
            .arg(&bundle)
            .arg(if on_exit { "0" } else { "1" })
            .arg(TEAM_ID)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        if !on_exit {
            app.exit(0);
        }
        return Ok(());
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, on_exit);
        Err("Pemasangan otomatis tidak didukung di sini".into())
    }
}

/// Dijalankan terpisah dari app: menunggu app keluar, memeriksa tanda tangan lagi, mengganti app, lalu membukanya.
#[cfg(target_os = "macos")]
const APPLY_SH: &str = r#"#!/bin/sh
PID="$1"; DMG="$2"; APP="$3"; RESTART="$4"; TEAM="$5"
while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done
MNT=$(mktemp -d /tmp/cognify-update.XXXXXX)
if ! hdiutil attach -nobrowse -readonly -noverify -mountpoint "$MNT" "$DMG" >/dev/null 2>&1; then open "$DMG"; exit 1; fi
NEW="$MNT/Cognify.app"
DONE=0
if codesign --verify --deep --strict "$NEW" 2>/dev/null && codesign -dv "$NEW" 2>&1 | grep -q "TeamIdentifier=$TEAM"; then
  TMP="$APP.updating"; OLD="$APP.old"
  rm -rf "$TMP" "$OLD"
  if ditto "$NEW" "$TMP" && mv "$APP" "$OLD" && mv "$TMP" "$APP"; then
    rm -rf "$OLD"; DONE=1
  else
    [ -d "$OLD" ] && [ ! -d "$APP" ] && mv "$OLD" "$APP"
    rm -rf "$TMP"
  fi
fi
hdiutil detach "$MNT" -quiet >/dev/null 2>&1
rmdir "$MNT" 2>/dev/null
if [ "$DONE" = 1 ]; then rm -f "$DMG"; else open "$DMG"; exit 1; fi
[ "$RESTART" = 1 ] && open "$APP"
exit 0
"#;

#[cfg(test)]
mod tests {
    use super::newer;

    #[test]
    fn compares_versions_numerically() {
        assert!(newer("v0.10.0", "0.9.0"));
        assert!(newer("0.4.1", "0.4.0"));
        assert!(!newer("0.4.0", "0.4.0"));
        assert!(!newer("0.3.9", "0.4.0"));
        assert!(newer("1.0.0", "0.99.99"));
        assert!(newer("0.5.0-beta", "0.4.0"));
    }
}
