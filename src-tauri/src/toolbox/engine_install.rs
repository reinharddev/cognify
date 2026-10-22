//! Downloads engines (yt-dlp, and later models) on demand, verifying a SHA-256
//! before the file is put in place.
//!
//! What the check does and does not give you: a file only appears under its
//! final name if its hash matches, so a truncated, corrupted or swapped
//! download is rejected. For yt-dlp the expected hash comes from the same
//! GitHub release as the binary, so it does not protect against a compromised
//! release; pinned entries (`sha256` in engines.json) do, once reviewed in git.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::Duration,
};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tokio::{io::AsyncWriteExt, sync::oneshot};

use crate::toolbox::ffmpeg::{self, Jobs};

const CATALOG: &str = include_str!("../../engines.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub url: String,
    /// Fixed expected hash. Takes precedence over `sums_url`.
    pub sha256: Option<String>,
    /// Release checksum list ("<hash>  <name>" per line) and our name in it.
    pub sums_url: Option<String>,
    pub asset: Option<String>,
    /// File name inside the engines folder.
    pub file: String,
    /// True for programs (made runnable after download), false for data such as models.
    #[serde(default = "yes")]
    pub executable: bool,
    /// How to unpack the download. `dmg-app`: a macOS disk image holding one .app, which is
    /// copied into the engines folder; `file` then points at a file inside that app.
    pub archive: Option<String>,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineDef {
    pub id: String,
    pub label: String,
    pub approx_mb: u32,
    pub targets: HashMap<String, Target>,
}

#[derive(Deserialize)]
struct Catalog {
    engines: Vec<EngineDef>,
}

pub fn catalog() -> Vec<EngineDef> {
    serde_json::from_str::<Catalog>(CATALOG).expect("engines.json is valid").engines
}

/// "macos-aarch64", "linux-x86_64", "windows-x86_64", ...
pub fn platform_key() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

impl EngineDef {
    /// The build for this platform, or the platform-independent one ("any",
    /// used for models).
    pub fn target(&self) -> Option<&Target> {
        self.targets.get(&platform_key()).or_else(|| self.targets.get("any"))
    }
}

pub fn engines_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("engines")).map_err(|e| e.to_string())
}

#[derive(Debug, PartialEq, Eq)]
pub enum DlError {
    Cancelled,
    Failed(String),
}

impl DlError {
    pub fn into_message(self) -> String {
        match self {
            DlError::Cancelled => "cancelled".into(),
            DlError::Failed(m) => m,
        }
    }
}

fn failed<E: std::fmt::Display>(e: E) -> DlError {
    DlError::Failed(e.to_string())
}

pub enum Expect<'a> {
    Sha256(&'a str),
    /// No hash check. Tests only: every catalog entry must be verifiable.
    #[cfg(test)]
    Any,
}

#[derive(Debug)]
#[cfg_attr(not(test), allow(dead_code))] // read by tests; callers only need success or failure
pub struct Downloaded {
    pub bytes: u64,
    pub sha256: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("toolbox/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// Streams `url` to `dest`, hashing as it goes. The file is written to a
/// `.part` file first and only renamed into place once its size and hash check
/// out; every failure path removes the partial file.
pub async fn download_to(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expect: Expect<'_>,
    max_bytes: u64,
    cancel: &mut oneshot::Receiver<()>,
    mut on_progress: impl FnMut(f64),
) -> Result<Downloaded, DlError> {
    let response = client.get(url).send().await.map_err(|e| DlError::Failed(format!("Koneksi gagal: {e}")))?;
    if !response.status().is_success() {
        return Err(DlError::Failed(format!("Server menjawab HTTP {}", response.status().as_u16())));
    }
    let total = response.content_length();
    if total.is_some_and(|t| t > max_bytes) {
        return Err(DlError::Failed("File lebih besar dari batas yang diizinkan".into()));
    }

    let part = dest.with_file_name(format!("{}.part", dest.file_name().and_then(|n| n.to_str()).unwrap_or("download")));
    if let Some(dir) = dest.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(failed)?;
    }
    let mut file = tokio::fs::File::create(&part).await.map_err(failed)?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let mut got: u64 = 0;
    let mut cancel_open = true;

    let outcome: Result<(), DlError> = loop {
        tokio::select! {
            chunk = stream.next() => match chunk {
                Some(Ok(bytes)) => {
                    got += bytes.len() as u64;
                    if got > max_bytes {
                        break Err(DlError::Failed("File lebih besar dari batas yang diizinkan".into()));
                    }
                    hasher.update(&bytes);
                    if let Err(e) = file.write_all(&bytes).await {
                        break Err(failed(e));
                    }
                    if let Some(t) = total.filter(|t| *t > 0) {
                        on_progress((got as f64 / t as f64 * 100.0).min(99.0));
                    }
                }
                Some(Err(e)) => break Err(DlError::Failed(format!("Unduhan terputus: {e}"))),
                None => break Ok(()),
            },
            signal = &mut *cancel, if cancel_open => {
                if signal.is_ok() {
                    break Err(DlError::Cancelled);
                }
                cancel_open = false;
            }
        }
    };

    let finish = async {
        outcome?;
        file.flush().await.map_err(failed)?;
        if total.is_some_and(|t| t != got) {
            return Err(DlError::Failed("Unduhan tidak lengkap".into()));
        }
        let digest = hex(hasher.finalize().as_ref());
        match expect {
            Expect::Sha256(want) if !want.trim().eq_ignore_ascii_case(&digest) => {
                return Err(DlError::Failed(format!(
                    "Checksum tidak cocok, file ditolak.\n  seharusnya: {}\n  diterima:   {digest}",
                    want.trim().to_lowercase()
                )));
            }
            Expect::Sha256(_) => {}
            #[cfg(test)]
            Expect::Any => {}
        }
        Ok(digest)
    };

    match finish.await {
        Ok(digest) => {
            drop(file);
            let _ = tokio::fs::remove_file(dest).await; // rename cannot replace on Windows
            tokio::fs::rename(&part, dest).await.map_err(failed)?;
            Ok(Downloaded { bytes: got, sha256: digest })
        }
        Err(e) => {
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            Err(e)
        }
    }
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, DlError> {
    let response = client.get(url).send().await.map_err(|e| DlError::Failed(format!("Koneksi gagal: {e}")))?;
    if !response.status().is_success() {
        return Err(DlError::Failed(format!("Server menjawab HTTP {}", response.status().as_u16())));
    }
    if response.content_length().is_some_and(|l| l > 1_000_000) {
        return Err(DlError::Failed("Daftar checksum terlalu besar".into()));
    }
    response.text().await.map_err(failed)
}

/// Finds `asset` in a `sha256sum`-style list ("<hash>  <name>", optional `*` before the name).
pub fn parse_sums(text: &str, asset: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (hash, name) = line.trim().split_once(char::is_whitespace)?;
        let name = name.trim().trim_start_matches('*');
        (name == asset && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())).then(|| hash.to_lowercase())
    })
}

/// Mach-O (also universal) executables start with one of these magic numbers.
fn is_mach_o(path: &Path) -> bool {
    use std::io::Read;
    let mut magic = [0u8; 4];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut magic)).is_ok()
        && matches!(
            u32::from_be_bytes(magic),
            0xfeed_face | 0xfeed_facf | 0xcefa_edfe | 0xcffa_edfe | 0xcafe_babe | 0xbebb_afca
        )
}

/// Makes the file runnable. On macOS a binary that fails its signature check is
/// ad-hoc signed (arm64 refuses unsigned code); a binary that already verifies
/// is left alone, since re-signing can break self-extracting executables.
fn make_runnable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    if is_mach_o(path) {
        let verified = std::process::Command::new("codesign").arg("--verify").arg(path).output().map(|o| o.status.success()).unwrap_or(false);
        if !verified {
            let _ = std::process::Command::new("codesign").args(["--force", "--sign", "-"]).arg(path).output();
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = is_mach_o;
    Ok(())
}

/// Downloads one engine for this platform into `dir`, verified. Returns its path.
pub async fn install(
    client: &reqwest::Client,
    def: &EngineDef,
    dir: &Path,
    cancel: &mut oneshot::Receiver<()>,
    on_progress: impl FnMut(f64),
) -> Result<PathBuf, DlError> {
    let target = def
        .target()
        .ok_or_else(|| DlError::Failed(format!("{} belum tersedia untuk {}", def.label, platform_key())))?;

    let expected = match (&target.sha256, &target.sums_url, &target.asset) {
        (Some(h), _, _) => h.clone(),
        (None, Some(sums), Some(asset)) => {
            let text = fetch_text(client, sums).await?;
            parse_sums(&text, asset).ok_or_else(|| DlError::Failed(format!("Tidak ada checksum untuk {asset} di daftar rilis")))?
        }
        _ => return Err(DlError::Failed(format!("{}: tidak ada checksum untuk diverifikasi", def.label))),
    };

    if target.archive.as_deref() == Some("dmg-app") {
        return install_dmg_app(client, target, &expected, dir, cancel, on_progress).await;
    }

    let dest = dir.join(&target.file);
    download_to(client, &target.url, &dest, Expect::Sha256(&expected), 2 * 1024 * 1024 * 1024, cancel, on_progress).await?;
    if target.executable {
        make_runnable(&dest).map_err(DlError::Failed)?;
    }
    Ok(dest)
}

/// The folder an `archive` engine unpacks into: the first part of `file` ("LibreOffice.app").
pub fn app_folder(target: &Target) -> Option<&str> {
    target.file.split('/').next().filter(|first| target.file.contains('/') && !first.is_empty())
}

/// Downloads a macOS disk image, checks its hash, and copies the .app inside it into `dir`.
/// Nothing is installed system-wide and no password is needed; the app lives and dies with
/// the engines folder.
async fn install_dmg_app(
    client: &reqwest::Client,
    target: &Target,
    expected: &str,
    dir: &Path,
    cancel: &mut oneshot::Receiver<()>,
    on_progress: impl FnMut(f64),
) -> Result<PathBuf, DlError> {
    let app = app_folder(target).ok_or_else(|| DlError::Failed("engines.json: archive butuh file di dalam .app".into()))?.to_string();
    let dmg = dir.join(format!("{app}.dmg"));
    download_to(client, &target.url, &dmg, Expect::Sha256(expected), 2 * 1024 * 1024 * 1024, cancel, on_progress).await?;

    let (dmg2, dir2) = (dmg.clone(), dir.to_path_buf());
    let copied = tokio::task::spawn_blocking(move || copy_app_from_dmg(&dmg2, &dir2, &app)).await.map_err(failed)?;
    let _ = tokio::fs::remove_file(&dmg).await;
    copied.map_err(DlError::Failed)?;

    let installed = dir.join(&target.file);
    if installed.is_file() {
        Ok(installed)
    } else {
        Err(DlError::Failed(format!("{} tidak ditemukan setelah pemasangan", target.file)))
    }
}

#[cfg(target_os = "macos")]
fn copy_app_from_dmg(dmg: &Path, dir: &Path, app: &str) -> Result<(), String> {
    use std::process::Command;

    let mount = dir.join(format!(".mount-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&mount);
    std::fs::create_dir_all(&mount).map_err(|e| e.to_string())?;

    // read-only, no Finder window, and no checksum pass (we already verified the hash)
    let attach = Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-readonly", "-noverify", "-noautoopen", "-mountpoint"])
        .arg(&mount)
        .arg(dmg)
        .output()
        .map_err(|e| format!("hdiutil gagal dijalankan: {e}"))?;
    if !attach.status.success() {
        let _ = std::fs::remove_dir_all(&mount);
        return Err(format!("Disk image tidak bisa dibuka: {}", String::from_utf8_lossy(&attach.stderr).trim()));
    }

    let result = (|| {
        let source = mount.join(app);
        if !source.is_dir() {
            return Err(format!("{app} tidak ada di dalam disk image"));
        }
        let (dest, part) = (dir.join(app), dir.join(format!("{app}.part")));
        let _ = std::fs::remove_dir_all(&part);
        // ditto keeps permissions, symlinks and the code signature intact
        let copy = Command::new("ditto").arg(&source).arg(&part).output().map_err(|e| format!("ditto gagal dijalankan: {e}"))?;
        if !copy.status.success() {
            let _ = std::fs::remove_dir_all(&part);
            return Err(format!("Menyalin {app} gagal: {}", String::from_utf8_lossy(&copy.stderr).trim()));
        }
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::rename(&part, &dest).map_err(|e| e.to_string())
    })();

    let detach = |force: bool| {
        let mut c = Command::new("hdiutil");
        c.arg("detach").arg(&mount);
        if force {
            c.arg("-force");
        }
        c.output().map(|o| o.status.success()).unwrap_or(false)
    };
    if !detach(false) {
        detach(true);
    }
    let _ = std::fs::remove_dir_all(&mount);
    result
}

#[cfg(not(target_os = "macos"))]
fn copy_app_from_dmg(_dmg: &Path, _dir: &Path, _app: &str) -> Result<(), String> {
    Err("Disk image hanya didukung di macOS".into())
}

// ---------------------------------------------------------------- commands ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub id: String,
    pub label: String,
    pub approx_mb: u32,
    pub supported: bool,
    pub installed: bool,
    pub path: Option<String>,
}

fn status_of(def: &EngineDef, dir: &Path) -> EngineStatus {
    let path = def.target().map(|t| dir.join(&t.file)).filter(|p| p.is_file());
    EngineStatus {
        id: def.id.clone(),
        label: def.label.clone(),
        approx_mb: def.approx_mb,
        supported: def.target().is_some(),
        installed: path.is_some(),
        path: path.map(|p| p.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
pub fn engine_catalog(app: AppHandle) -> Result<Vec<EngineStatus>, String> {
    let dir = engines_dir(&app)?;
    Ok(catalog().iter().map(|d| status_of(d, &dir)).collect())
}

#[tauri::command]
pub async fn engine_install(app: AppHandle, jobs: State<'_, Jobs>, job_id: String, id: String) -> Result<EngineStatus, String> {
    let def = catalog().into_iter().find(|d| d.id == id).ok_or_else(|| format!("Engine tidak dikenal: {id}"))?;
    let dir = engines_dir(&app)?;
    let client = http_client()?;

    let mut cancel = jobs.register(&job_id);
    let result = install(&client, &def, &dir, &mut cancel, |p| ffmpeg::emit_progress(&app, &job_id, p)).await;
    jobs.finish(&job_id);

    result.map_err(DlError::into_message)?;
    ffmpeg::emit_progress(&app, &job_id, 100.0);
    Ok(status_of(&def, &dir))
}

#[tauri::command]
pub fn engine_remove(app: AppHandle, id: String) -> Result<EngineStatus, String> {
    let def = catalog().into_iter().find(|d| d.id == id).ok_or_else(|| format!("Engine tidak dikenal: {id}"))?;
    let dir = engines_dir(&app)?;
    if let Some(target) = def.target() {
        match app_folder(target).filter(|_| target.archive.is_some()) {
            Some(folder) => {
                let app = dir.join(folder);
                if app.is_dir() {
                    std::fs::remove_dir_all(app).map_err(|e| e.to_string())?;
                }
            }
            None => {
                let path = dir.join(&target.file);
                if path.is_file() {
                    std::fs::remove_file(path).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(status_of(&def, &dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::Arc,
    };

    /// A tiny HTTP server for tests: path -> behaviour.
    #[derive(Clone)]
    enum Route {
        Body(Vec<u8>),
        Redirect(&'static str),
        Status(u16),
        /// Sends the first half of the body, then stalls for a long time.
        Stall(Vec<u8>),
        /// Claims more bytes than it sends, then closes.
        Truncated(Vec<u8>),
    }

    fn serve(routes: Vec<(&'static str, Route)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let routes = Arc::new(routes);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let routes = routes.clone();
                std::thread::spawn(move || {
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let route = routes.iter().find(|(p, _)| *p == path).map(|(_, r)| r.clone());
                    let head = |status: &str, extra: &str, len: usize| format!("HTTP/1.1 {status}\r\n{extra}Content-Length: {len}\r\nConnection: close\r\n\r\n");
                    match route {
                        Some(Route::Body(b)) => {
                            let _ = stream.write_all(head("200 OK", "", b.len()).as_bytes());
                            let _ = stream.write_all(&b);
                        }
                        Some(Route::Redirect(to)) => {
                            let _ = stream.write_all(head("302 Found", &format!("Location: {to}\r\n"), 0).as_bytes());
                        }
                        Some(Route::Status(code)) => {
                            let _ = stream.write_all(head(&format!("{code} Nope"), "", 0).as_bytes());
                        }
                        Some(Route::Stall(b)) => {
                            let _ = stream.write_all(head("200 OK", "", b.len()).as_bytes());
                            let _ = stream.write_all(&b[..b.len() / 2]);
                            let _ = stream.flush();
                            std::thread::sleep(Duration::from_secs(20));
                        }
                        Some(Route::Truncated(b)) => {
                            let _ = stream.write_all(head("200 OK", "", b.len() + 500).as_bytes());
                            let _ = stream.write_all(&b);
                        }
                        None => {
                            let _ = stream.write_all(head("404 Not Found", "", 0).as_bytes());
                        }
                    }
                });
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    fn sha(bytes: &[u8]) -> String {
        hex(Sha256::digest(bytes).as_ref())
    }

    fn workdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("toolbox-install-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    async fn dl(url: &str, dest: &Path, expect: Expect<'_>, max: u64) -> (Result<Downloaded, DlError>, Vec<f64>) {
        let (_keep, mut rx) = oneshot::channel::<()>();
        let mut progress = Vec::new();
        let r = download_to(&http_client().unwrap(), url, dest, expect, max, &mut rx, |p| progress.push(p)).await;
        (r, progress)
    }

    // ---- catalog

    #[test]
    fn catalog_is_well_formed_and_https_only() {
        let engines = catalog();
        assert!(engines.iter().any(|e| e.id == "yt-dlp"));
        for e in &engines {
            assert!(!e.targets.is_empty(), "{} has no targets", e.id);
            for (platform, t) in &e.targets {
                assert!(t.url.starts_with("https://"), "{} {platform}: {}", e.id, t.url);
                // a plain file name, or (for unpacked apps only) a relative path that stays inside the folder
                assert!(!t.file.is_empty() && !t.file.starts_with('/') && !t.file.split('/').any(|p| p == ".."), "{} {platform}", e.id);
                assert!(t.archive.is_some() || !t.file.contains('/'), "{} {platform}: only archives may use a path", e.id);
                let verifiable = t.sha256.as_deref().is_some_and(|h| h.len() == 64) || (t.sums_url.as_deref().is_some_and(|u| u.starts_with("https://")) && t.asset.is_some());
                assert!(verifiable, "{} {platform} has no way to verify its download", e.id);
            }
        }
    }

    #[test]
    fn programs_are_platform_specific_and_files_do_not_clash() {
        let engines = catalog();
        // programs are still platform specific and executable
        let ytdlp = engines.iter().find(|e| e.id == "yt-dlp").unwrap();
        assert!(ytdlp.targets.values().all(|t| t.executable && t.sha256.is_none()));
        // file names are unique, or two engines would overwrite each other
        let mut files: Vec<&str> = engines.iter().flat_map(|e| e.targets.values().map(|t| t.file.as_str())).collect();
        files.sort_unstable();
        let total = files.len();
        files.dedup();
        assert!(files.len() < total, "yt-dlp shares one file name across platforms, as intended");
    }

    /// Runs the real installer against the real hosts. Skipped unless asked for:
    ///   TOOLBOX_REAL_ENGINES=yt-dlp TOOLBOX_ENGINE_DIR=/some/dir cargo test real_install -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn real_install() {
        let ids = std::env::var("TOOLBOX_REAL_ENGINES").expect("TOOLBOX_REAL_ENGINES");
        let dir = PathBuf::from(std::env::var("TOOLBOX_ENGINE_DIR").expect("TOOLBOX_ENGINE_DIR"));
        let client = http_client().unwrap();
        for id in ids.split(',') {
            let def = catalog().into_iter().find(|d| d.id == id).unwrap_or_else(|| panic!("unknown engine {id}"));
            let (_keep, mut rx) = oneshot::channel::<()>();
            let started = std::time::Instant::now();
            let mut last = 0.0;
            let path = install(&client, &def, &dir, &mut rx, |p| last = p).await.unwrap_or_else(|e| panic!("{id}: {e:?}"));
            println!("{id}: installed {} ({} bytes) in {:.1}s, last progress {last:.0}%", path.display(), std::fs::metadata(&path).unwrap().len(), started.elapsed().as_secs_f64());
        }
    }

    #[test]
    fn sums_lines_are_parsed_strictly() {
        let a = "a".repeat(64);
        let b = "b".repeat(64);
        let text = format!("{a}  yt-dlp\n{b} *yt-dlp_macos\nnothex{}  yt-dlp_linux\n", "z".repeat(58));
        assert_eq!(parse_sums(&text, "yt-dlp"), Some(a));
        assert_eq!(parse_sums(&text, "yt-dlp_macos"), Some(b), "the binary-mode '*' is ignored");
        assert_eq!(parse_sums(&text, "yt-dlp_linux"), None, "a malformed hash is not accepted");
        assert_eq!(parse_sums(&text, "missing"), None);
    }

    // ---- downloads

    #[tokio::test]
    async fn a_matching_download_is_installed_and_reports_progress() {
        let body: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let base = serve(vec![("/file", Route::Body(body.clone()))]);
        let dir = workdir("ok");
        let dest = dir.join("engine.bin");

        let (r, progress) = dl(&format!("{base}/file"), &dest, Expect::Sha256(&sha(&body)), 10 << 20).await;
        let info = r.unwrap();
        assert_eq!((info.bytes, info.sha256), (body.len() as u64, sha(&body)));
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert!(progress.iter().all(|p| (0.0..=99.0).contains(p)) && !progress.is_empty());
        assert_eq!(leftovers(&dir), ["engine.bin"], "no .part file left behind");
    }

    #[tokio::test]
    async fn a_wrong_hash_is_rejected_and_nothing_is_left() {
        let base = serve(vec![("/file", Route::Body(b"genuine".to_vec()))]);
        let dir = workdir("bad-hash");
        let dest = dir.join("engine.bin");
        std::fs::write(&dest, b"previous good version").unwrap();

        let (r, _) = dl(&format!("{base}/file"), &dest, Expect::Sha256(&sha(b"something else")), 1 << 20).await;
        match r {
            Err(DlError::Failed(m)) => assert!(m.contains("Checksum tidak cocok"), "{m}"),
            other => panic!("expected a checksum failure, got {other:?}"),
        }
        assert_eq!(std::fs::read(&dest).unwrap(), b"previous good version", "a failed update must not destroy the working install");
        assert_eq!(leftovers(&dir), ["engine.bin"]);
    }

    #[tokio::test]
    async fn redirects_are_followed_and_http_errors_reported() {
        let base = serve(vec![("/go", Route::Redirect("/file")), ("/file", Route::Body(b"hello".to_vec())), ("/err", Route::Status(500))]);
        let dir = workdir("redirect");
        let (r, _) = dl(&format!("{base}/go"), &dir.join("a"), Expect::Sha256(&sha(b"hello")), 1 << 20).await;
        assert!(r.is_ok());

        let (r, _) = dl(&format!("{base}/err"), &dir.join("b"), Expect::Any, 1 << 20).await;
        assert!(matches!(r, Err(DlError::Failed(m)) if m.contains("500")));
        let (r, _) = dl(&format!("{base}/nope"), &dir.join("c"), Expect::Any, 1 << 20).await;
        assert!(matches!(r, Err(DlError::Failed(m)) if m.contains("404")));
        assert_eq!(leftovers(&dir), ["a"]);
    }

    #[tokio::test]
    async fn size_limits_and_truncated_transfers_are_refused() {
        let base = serve(vec![("/big", Route::Body(vec![7u8; 50_000])), ("/cut", Route::Truncated(vec![1u8; 1000]))]);
        let dir = workdir("limits");

        let (r, _) = dl(&format!("{base}/big"), &dir.join("big"), Expect::Any, 10_000).await;
        assert!(matches!(r, Err(DlError::Failed(m)) if m.contains("batas")));

        let (r, _) = dl(&format!("{base}/cut"), &dir.join("cut"), Expect::Any, 1 << 20).await;
        assert!(matches!(r, Err(DlError::Failed(_))), "a connection cut short must not become a file");
        assert!(leftovers(&dir).is_empty(), "{:?}", leftovers(&dir));
    }

    #[tokio::test]
    async fn cancelling_stops_the_download_and_cleans_up() {
        let base = serve(vec![("/slow", Route::Stall(vec![9u8; 100_000]))]);
        let dir = workdir("cancel");
        let dest = dir.join("slow.bin");
        let (tx, mut rx) = oneshot::channel::<()>();
        let client = http_client().unwrap();
        let url = format!("{base}/slow");

        let started = std::time::Instant::now();
        let (r, _) = tokio::join!(download_to(&client, &url, &dest, Expect::Any, 1 << 20, &mut rx, |_| {}), async {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let _ = tx.send(());
        });
        assert_eq!(r.unwrap_err(), DlError::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(8), "cancel must not wait for the stalled server");
        assert!(leftovers(&dir).is_empty());
    }

    // ---- full install

    #[tokio::test]
    async fn install_checks_the_release_checksum_list_and_makes_the_file_executable() {
        let binary = b"#!/bin/sh\necho 2026.01.01\n".to_vec();
        let sums = format!("{}  fake_asset\n{}  other\n", sha(&binary), "0".repeat(64));
        let base = serve(vec![("/bin", Route::Body(binary.clone())), ("/SUMS", Route::Body(sums.into_bytes()))]);
        let dir = workdir("install");
        let def = EngineDef {
            id: "fake".into(),
            label: "Fake".into(),
            approx_mb: 1,
            targets: HashMap::from([(
                platform_key(),
                Target { url: format!("{base}/bin"), sha256: None, sums_url: Some(format!("{base}/SUMS")), asset: Some("fake_asset".into()), file: "fake".into(), executable: true, archive: None },
            )]),
        };
        let (_keep, mut rx) = oneshot::channel::<()>();
        let path = install(&http_client().unwrap(), &def, &dir, &mut rx, |_| {}).await.unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), binary);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o111, 0o111, "must be executable");
            let out = std::process::Command::new(&path).output().unwrap();
            assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "2026.01.01", "the installed file actually runs");
        }
        assert_eq!(status_of(&def, &dir).installed, true);

        // a release list that does not mention our asset must fail closed
        let base2 = serve(vec![("/bin", Route::Body(binary)), ("/SUMS", Route::Body(format!("{}  unrelated\n", "1".repeat(64)).into_bytes()))]);
        let mut def2 = def.clone();
        def2.targets.get_mut(&platform_key()).unwrap().url = format!("{base2}/bin");
        def2.targets.get_mut(&platform_key()).unwrap().sums_url = Some(format!("{base2}/SUMS"));
        let dir2 = workdir("install2");
        let (_k2, mut rx2) = oneshot::channel::<()>();
        let err = install(&http_client().unwrap(), &def2, &dir2, &mut rx2, |_| {}).await.unwrap_err();
        assert!(matches!(err, DlError::Failed(m) if m.contains("checksum")));
        assert!(leftovers(&dir2).is_empty(), "nothing is installed without a verified hash");
    }

    #[test]
    fn mach_o_detection_ignores_scripts() {
        let dir = workdir("macho");
        let script = dir.join("s.sh");
        std::fs::write(&script, b"#!/bin/sh\n").unwrap();
        assert!(!is_mach_o(&script));
        let fat = dir.join("fat");
        std::fs::write(&fat, [0xca, 0xfe, 0xba, 0xbe, 0, 0]).unwrap();
        assert!(is_mach_o(&fat));
        assert!(!is_mach_o(&dir.join("missing")));
    }

    // ---- disk image apps (macOS)

    #[cfg(target_os = "macos")]
    fn fake_dmg(tag: &str) -> (Vec<u8>, PathBuf) {
        let src = workdir(&format!("{tag}-src"));
        let bin = src.join("LibreOffice.app/Contents/MacOS");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("soffice"), b"#!/bin/sh\necho fake office\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(bin.join("soffice"), std::fs::Permissions::from_mode(0o755)).unwrap();
        std::os::unix::fs::symlink("Contents/MacOS", src.join("LibreOffice.app/link")).unwrap();
        let out = workdir(&format!("{tag}-out")).join("fake.dmg");
        let made = std::process::Command::new("hdiutil").args(["create", "-quiet", "-srcfolder"]).arg(&src).args(["-format", "UDZO", "-volname", "FakeOffice"]).arg(&out).output().unwrap();
        assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
        (std::fs::read(&out).unwrap(), out)
    }

    #[cfg(target_os = "macos")]
    fn dmg_def(base: &str, hash: &str) -> EngineDef {
        EngineDef {
            id: "fake-office".into(),
            label: "Fake office".into(),
            approx_mb: 1,
            targets: HashMap::from([(
                platform_key(),
                Target { url: format!("{base}/fake.dmg"), sha256: Some(hash.into()), sums_url: None, asset: None, file: "LibreOffice.app/Contents/MacOS/soffice".into(), executable: false, archive: Some("dmg-app".into()) },
            )]),
        }
    }

    #[cfg(target_os = "macos")]
    fn mounted_volumes() -> String {
        String::from_utf8_lossy(&std::process::Command::new("hdiutil").arg("info").output().unwrap().stdout).into_owned()
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn a_disk_image_app_is_copied_in_and_the_image_is_unmounted() {
        let (bytes, _) = fake_dmg("dmg");
        let base = serve(vec![("/fake.dmg", Route::Body(bytes.clone()))]);
        let dir = workdir("dmg-install");
        let def = dmg_def(&base, &sha(&bytes));
        let (_keep, mut rx) = oneshot::channel::<()>();
        let path = install(&http_client().unwrap(), &def, &dir, &mut rx, |_| {}).await.unwrap();

        assert_eq!(path, dir.join("LibreOffice.app/Contents/MacOS/soffice"));
        let out = std::process::Command::new(&path).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "fake office", "the copied program runs");
        assert!(std::fs::symlink_metadata(dir.join("LibreOffice.app/link")).unwrap().file_type().is_symlink(), "symlinks are kept");
        assert!(status_of(&def, &dir).installed);
        let names: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(names, ["LibreOffice.app"], "no dmg, mount point or .part left behind");
        assert!(!mounted_volumes().contains(&dir.to_string_lossy().to_string()), "the image must be detached");

        // installing again replaces the old copy instead of failing
        let (_k, mut rx2) = oneshot::channel::<()>();
        install(&http_client().unwrap(), &def, &dir, &mut rx2, |_| {}).await.unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn a_disk_image_with_the_wrong_hash_or_content_installs_nothing() {
        let (bytes, _) = fake_dmg("dmg-bad");
        let base = serve(vec![("/fake.dmg", Route::Body(bytes.clone())), ("/junk.dmg", Route::Body(b"not a disk image".to_vec()))]);

        let dir = workdir("dmg-wrong-hash");
        let (_k, mut rx) = oneshot::channel::<()>();
        let err = install(&http_client().unwrap(), &dmg_def(&base, &"0".repeat(64)), &dir, &mut rx, |_| {}).await.unwrap_err();
        assert!(matches!(err, DlError::Failed(m) if m.contains("Checksum")));
        assert!(leftovers(&dir).is_empty());

        // right hash but not a real image: hdiutil refuses it and nothing stays behind
        let junk = b"not a disk image".to_vec();
        let mut def = dmg_def(&base, &sha(&junk));
        def.targets.get_mut(&platform_key()).unwrap().url = format!("{base}/junk.dmg");
        let dir2 = workdir("dmg-junk");
        let (_k2, mut rx2) = oneshot::channel::<()>();
        assert!(install(&http_client().unwrap(), &def, &dir2, &mut rx2, |_| {}).await.is_err());
        assert!(leftovers(&dir2).is_empty(), "{:?}", leftovers(&dir2));
    }

    #[test]
    fn the_app_folder_comes_from_the_first_path_part() {
        let t = |file: &str| Target { url: String::new(), sha256: None, sums_url: None, asset: None, file: file.into(), executable: false, archive: Some("dmg-app".into()) };
        assert_eq!(app_folder(&t("LibreOffice.app/Contents/MacOS/soffice")), Some("LibreOffice.app"));
        assert_eq!(app_folder(&t("plain-file")), None);
        assert_eq!(app_folder(&t("/abs")), None);
    }

    #[test]
    fn the_catalog_offers_libreoffice_with_a_pinned_hash_on_every_mac() {
        let office = catalog().into_iter().find(|d| d.id == "libreoffice").expect("libreoffice entry");
        for key in ["macos-aarch64", "macos-x86_64"] {
            let t = office.targets.get(key).unwrap_or_else(|| panic!("{key}"));
            assert!(t.url.starts_with("https://"), "{key}");
            assert_eq!(t.sha256.as_deref().map(str::len), Some(64), "{key} must be hash-pinned");
            assert_eq!(t.archive.as_deref(), Some("dmg-app"));
        }
    }
}
