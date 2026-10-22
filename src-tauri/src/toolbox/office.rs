//! Documents (PowerPoint, Word, Excel and friends) to PDF through LibreOffice.
//!
//! LibreOffice is not bundled (it is hundreds of MB): the app finds an
//! existing install and runs it headless as a separate program. A private
//! profile folder keeps the conversion from clashing with a LibreOffice window
//! the user may have open.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::{io::AsyncReadExt, process::Command, sync::oneshot};

use crate::toolbox::{engine_install::engines_dir, ffmpeg::Jobs, fsutil, proc};

/// What LibreOffice can open and we offer to turn into PDF.
pub const EXTENSIONS: &[&str] = &["pptx", "ppt", "pps", "ppsx", "odp", "docx", "doc", "dotx", "odt", "rtf", "txt", "xlsx", "xls", "ods", "csv"];

/// A big deck can take a while, but nothing legitimate takes this long.
const TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub fn is_supported(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

// -------------------------------------------------------------- locating ---

fn candidates() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        v.push("/Applications/LibreOffice.app/Contents/MacOS/soffice".into());
        if let Some(home) = std::env::var_os("HOME") {
            v.push(PathBuf::from(home).join("Applications/LibreOffice.app/Contents/MacOS/soffice"));
        }
    }
    #[cfg(target_os = "windows")]
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = std::env::var_os(var) {
            v.push(PathBuf::from(base).join("LibreOffice").join("program").join("soffice.exe"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        for p in ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice", "/snap/bin/libreoffice", "/opt/libreoffice/program/soffice"] {
            v.push(p.into());
        }
        if let Ok(entries) = std::fs::read_dir("/opt") {
            for e in entries.flatten() {
                if e.file_name().to_string_lossy().starts_with("libreoffice") {
                    v.push(e.path().join("program/soffice"));
                }
            }
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for name in ["soffice", "soffice.exe", "libreoffice"] {
                v.push(dir.join(name));
            }
        }
    }
    v
}

fn find_in(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

/// A LibreOffice the app installed itself (in its engines folder) wins over a system one,
/// since it is the one the user asked this app to manage.
pub fn find_soffice(engines: Option<&Path>) -> Option<PathBuf> {
    let mut all = Vec::new();
    if let Some(dir) = engines {
        #[cfg(target_os = "macos")]
        all.push(dir.join("LibreOffice.app/Contents/MacOS/soffice"));
        #[cfg(not(target_os = "macos"))]
        let _ = dir;
    }
    all.extend(candidates());
    find_in(&all)
}

// ---------------------------------------------------------------- running ---

/// A `file://` URL for a folder path. LibreOffice wants its profile location this way.
pub fn file_url(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let mut out = String::from("file://");
    if !s.starts_with('/') {
        out.push('/'); // C:/x -> file:///C:/x
    }
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' | b':' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub fn build_args(profile: &Path, out_dir: &Path, input: &Path) -> Vec<OsString> {
    let mut a: Vec<OsString> = ["--headless", "--norestore", "--nologo", "--nodefault", "--nolockcheck", "--nofirststartwizard"].iter().map(OsString::from).collect();
    a.push(format!("-env:UserInstallation={}", file_url(profile)).into());
    // plain "pdf": LibreOffice picks the right export filter for slides, text or sheets
    a.extend(["--convert-to", "pdf", "--outdir"].iter().map(OsString::from));
    a.push(out_dir.into());
    a.push(input.into());
    a
}

#[derive(Debug, PartialEq, Eq)]
pub enum OfficeError {
    Cancelled,
    TimedOut,
    /// LibreOffice reported an error (its last lines of stderr).
    Failed(String),
    /// It exited cleanly but produced no usable PDF: typically a password-protected or damaged file.
    NoOutput,
}

impl OfficeError {
    pub fn into_message(self) -> String {
        match self {
            OfficeError::Cancelled => "cancelled".into(),
            OfficeError::TimedOut => "timeout|".into(),
            OfficeError::NoOutput => "noOutput|".into(),
            OfficeError::Failed(m) => format!("failed|{m}"),
        }
    }
}

async fn run_soffice(bin: &Path, args: &[OsString], cancel: &mut oneshot::Receiver<()>, timeout: Duration) -> Result<(), OfficeError> {
    let mut command = Command::new(bin);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).kill_on_drop(true);
    crate::toolbox::proc::lower_priority(&mut command);
    proc::own_group(&mut command);
    let mut child = command.spawn().map_err(|e| OfficeError::Failed(format!("Gagal menjalankan LibreOffice: {e}")))?;
    let pid = child.id();
    let mut stderr = child.stderr.take().expect("piped");
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf).await;
        buf
    });

    let mut cancel_open = true;
    let outcome = loop {
        tokio::select! {
            status = child.wait() => break status.map_err(|e| OfficeError::Failed(e.to_string())),
            signal = &mut *cancel, if cancel_open => {
                if signal.is_ok() {
                    break Err(OfficeError::Cancelled);
                }
                cancel_open = false;
            }
            _ = tokio::time::sleep(timeout) => break Err(OfficeError::TimedOut),
        }
    };

    if matches!(outcome, Err(OfficeError::Cancelled | OfficeError::TimedOut)) {
        if let Some(pid) = pid {
            proc::kill_tree(pid);
        }
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    let stderr_text = tokio::time::timeout(Duration::from_secs(2), stderr_task).await.ok().and_then(Result::ok).unwrap_or_default();

    let status = outcome?;
    if !status.success() {
        let tail: Vec<&str> = stderr_text.lines().filter(|l| !l.trim().is_empty()).collect();
        return Err(OfficeError::Failed(tail[tail.len().saturating_sub(4)..].join("\n")));
    }
    Ok(())
}

fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::rename(from, to).or_else(|_| {
        std::fs::copy(from, to)?;
        std::fs::remove_file(from)
    })
}

fn looks_like_pdf(path: &Path) -> bool {
    use std::io::Read;
    let mut head = [0u8; 5];
    std::fs::metadata(path).is_ok_and(|m| m.len() > 8) && std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && &head == b"%PDF-"
}

/// Converts one document. The PDF is built in `work` and only moved to
/// `final_dir` (never over an existing file) once it checks out.
pub async fn convert(
    soffice: &Path,
    input: &Path,
    final_dir: &Path,
    profile: &Path,
    work: &Path,
    cancel: &mut oneshot::Receiver<()>,
    timeout: Duration,
) -> Result<PathBuf, OfficeError> {
    std::fs::create_dir_all(work).map_err(|e| OfficeError::Failed(e.to_string()))?;
    std::fs::create_dir_all(profile).map_err(|e| OfficeError::Failed(e.to_string()))?;

    let result = run_soffice(soffice, &build_args(profile, work, input), cancel, timeout).await;
    let outcome = match result {
        Ok(()) => {
            let stem = fsutil::stem_of(input);
            let produced = work.join(format!("{stem}.pdf"));
            if looks_like_pdf(&produced) {
                let dest = fsutil::unique_path(final_dir, stem, "pdf");
                move_file(&produced, &dest).map(|_| dest).map_err(|e| OfficeError::Failed(format!("Gagal menyimpan: {e}")))
            } else {
                Err(OfficeError::NoOutput)
            }
        }
        Err(e) => Err(e),
    };
    let _ = std::fs::remove_dir_all(work);
    if outcome.is_err() {
        // a profile that was interrupted can leave LibreOffice stuck next time
        let _ = std::fs::remove_dir_all(profile);
    }
    outcome
}

// --------------------------------------------------------------- commands ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeStatus {
    pub found: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub fn office_status(app: AppHandle) -> OfficeStatus {
    let path = find_soffice(engines_dir(&app).ok().as_deref());
    OfficeStatus { found: path.is_some(), path: path.map(|p| p.to_string_lossy().into_owned()) }
}

/// LibreOffice allows one conversion per profile at a time.
#[derive(Default)]
pub struct OfficeLock(tokio::sync::Mutex<()>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeRequest {
    pub job_id: String,
    pub input: String,
    pub out_dir: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeResult {
    pub output: String,
    pub pages: Option<u32>,
}

#[tauri::command]
pub async fn office_to_pdf(app: AppHandle, jobs: State<'_, Jobs>, lock: State<'_, OfficeLock>, req: OfficeRequest) -> Result<OfficeResult, String> {
    let input = PathBuf::from(&req.input);
    if !input.is_file() {
        return Err(format!("failed|File tidak ditemukan: {}", req.input));
    }
    // absolute, so a name can never be mistaken for a command-line option
    if !input.is_absolute() || !is_supported(&input) {
        return Err("unsupported|".into());
    }
    if let Some(d) = &req.out_dir {
        if !Path::new(d).is_dir() {
            return Err(format!("failed|Folder tujuan tidak ada: {d}"));
        }
    }
    let soffice = find_soffice(engines_dir(&app).ok().as_deref()).ok_or_else(|| "libreofficeMissing|".to_string())?;
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let (profile, work) = (cache.join("libreoffice-profile"), cache.join(format!("office-{}", req.job_id)));
    let final_dir = fsutil::output_dir(&input, req.out_dir.as_deref());

    let mut cancel = jobs.register(&req.job_id);
    let _guard = lock.0.lock().await;
    if cancel.try_recv().is_ok() {
        jobs.finish(&req.job_id);
        return Err("cancelled".into());
    }
    let result = convert(&soffice, &input, &final_dir, &profile, &work, &mut cancel, TIMEOUT).await;
    jobs.finish(&req.job_id);

    let output = result.map_err(OfficeError::into_message)?;
    let pages = lopdf::Document::load(&output).ok().map(|d| d.get_pages().len() as u32);
    Ok(OfficeResult { output: output.to_string_lossy().into_owned(), pages })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("toolbox-office-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_office_formats_are_accepted() {
        for ok in ["deck.pptx", "DECK.PPTX", "a.docx", "b.xls", "c.odp", "notes.txt", "/x/y z/report.Docx"] {
            assert!(is_supported(Path::new(ok)), "{ok}");
        }
        for bad in ["a.pdf", "a.exe", "a.png", "noext", "pptx", ".pptx", "a.pptx.exe"] {
            assert!(!is_supported(Path::new(bad)), "{bad}");
        }
    }

    #[test]
    fn profile_urls_are_escaped() {
        assert_eq!(file_url(Path::new("/Users/a/Library/Caches/x")), "file:///Users/a/Library/Caches/x");
        assert_eq!(file_url(Path::new("/Users/Budi Santoso/lo profile")), "file:///Users/Budi%20Santoso/lo%20profile");
        assert_eq!(file_url(Path::new("/tmp/\u{e9}")), "file:///tmp/%C3%A9");
        assert_eq!(file_url(Path::new("C:\\Users\\Budi\\AppData")), "file:///C:/Users/Budi/AppData");
        assert_eq!(file_url(Path::new("/a#b?c%d")), "file:///a%23b%3Fc%25d");
    }

    #[test]
    fn arguments_run_headless_with_a_private_profile_and_the_input_last() {
        let a: Vec<String> = build_args(Path::new("/p/prof"), Path::new("/o/out"), Path::new("/in/My Deck.pptx")).iter().map(|s| s.to_string_lossy().into_owned()).collect();
        for flag in ["--headless", "--norestore", "--nolockcheck", "--nofirststartwizard"] {
            assert!(a.contains(&flag.to_string()), "{flag} in {a:?}");
        }
        assert!(a.contains(&"-env:UserInstallation=file:///p/prof".to_string()), "{a:?}");
        let i = a.iter().position(|x| x == "--convert-to").unwrap();
        assert_eq!(a[i + 1], "pdf");
        assert_eq!(a[a.iter().position(|x| x == "--outdir").unwrap() + 1], "/o/out");
        assert_eq!(a.last().unwrap(), "/in/My Deck.pptx", "a path with a space stays one argument");
    }

    #[test]
    fn the_first_existing_candidate_wins() {
        let dir = workdir("find");
        let (a, b) = (dir.join("soffice-a"), dir.join("soffice-b"));
        std::fs::write(&b, b"x").unwrap();
        std::fs::create_dir_all(dir.join("a-dir")).unwrap();
        assert_eq!(find_in(&[dir.join("missing"), dir.join("a-dir"), b.clone(), a.clone()]), Some(b.clone()), "a folder is not a program");
        std::fs::write(&a, b"x").unwrap();
        assert_eq!(find_in(&[a.clone(), b]), Some(a));
        assert_eq!(find_in(&[]), None);
        #[cfg(target_os = "macos")]
        assert!(candidates().iter().any(|p| p.ends_with("LibreOffice.app/Contents/MacOS/soffice")));
    }

    #[test]
    fn pdf_detection_checks_the_header() {
        let dir = workdir("magic");
        let good = dir.join("g.pdf");
        std::fs::write(&good, b"%PDF-1.7\n%...").unwrap();
        let bad = dir.join("b.pdf");
        std::fs::write(&bad, b"<html>nope</html>").unwrap();
        let empty = dir.join("e.pdf");
        std::fs::write(&empty, b"").unwrap();
        assert!(looks_like_pdf(&good) && !looks_like_pdf(&bad) && !looks_like_pdf(&empty) && !looks_like_pdf(&dir.join("none.pdf")));
    }

    /// The real LibreOffice, through the same code the app uses. Skipped unless asked for:
    ///   TOOLBOX_SOFFICE=/path/to/soffice TOOLBOX_OFFICE_FIXTURES=tests/fixtures/office \
    ///     cargo test real_libreoffice -- --ignored --nocapture
    /// The fixtures were made by LibreOffice 26.8.1 from small hand-written flat ODF files.
    #[tokio::test]
    #[ignore]
    async fn real_libreoffice() {
        let soffice = PathBuf::from(std::env::var("TOOLBOX_SOFFICE").expect("TOOLBOX_SOFFICE"));
        let fixtures = PathBuf::from(std::env::var("TOOLBOX_OFFICE_FIXTURES").expect("TOOLBOX_OFFICE_FIXTURES"));
        let find = |ext: &str| {
            std::fs::read_dir(&fixtures).unwrap().flatten().map(|e| e.path()).find(|p| p.extension().is_some_and(|e| e == ext)).unwrap_or_else(|| panic!("no .{ext} fixture"))
        };
        let root = workdir("real-lo");
        let out = root.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let profile = root.join("profile");

        // (fixture, pages expected, phrases that must be readable in the PDF)
        let cases = [
            (find("pptx"), 3usize, vec!["Rencana Proyek 2026", "250 juta rupiah", "Jadwal dan Tonggak", "Terima Kasih"]),
            (find("docx"), 1, vec!["Laporan Bulanan Oktober 2026", "dua belas persen"]),
            (find("xlsx"), 1, vec!["Kopi Susu", "1250"]),
        ];
        for (i, (input, pages, phrases)) in cases.iter().enumerate() {
            let (_keep, mut rx) = oneshot::channel::<()>();
            let started = std::time::Instant::now();
            let pdf = convert(&soffice, input, &out, &profile, &root.join(format!("work{i}")), &mut rx, Duration::from_secs(300)).await.unwrap_or_else(|e| panic!("{input:?}: {e:?}"));
            println!("{} -> {} in {:.1}s ({})", input.file_name().unwrap().to_string_lossy(), pdf.file_name().unwrap().to_string_lossy(), started.elapsed().as_secs_f64(), if i == 0 { "first run, profile created" } else { "profile reused" });

            let doc = lopdf::Document::load(&pdf).unwrap();
            assert_eq!(doc.get_pages().len(), *pages, "{input:?}");
            let text: String = (1..=*pages as u32).map(|p| doc.extract_text(&[p]).unwrap_or_default()).collect::<Vec<_>>().join(" ");
            let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
            for phrase in phrases {
                assert!(flat.replace(' ', "").contains(&phrase.replace(' ', "")), "{phrase:?} missing from {flat:?}");
            }
        }

        // the same document again must get a new name, not replace the first PDF
        let again = {
            let (_k, mut rx) = oneshot::channel::<()>();
            convert(&soffice, &cases[0].0, &out, &profile, &root.join("work-again"), &mut rx, Duration::from_secs(300)).await.unwrap()
        };
        assert!(again.file_name().unwrap().to_string_lossy().ends_with("(1).pdf"), "{again:?}");

        // cancelling a real conversion stops LibreOffice completely
        let (tx, mut rx) = oneshot::channel::<()>();
        let cancel_profile = root.join("cancel-profile");
        let cancel_work = root.join("work-cancel");
        let (result, _) = tokio::join!(convert(&soffice, &cases[0].0, &out, &cancel_profile, &cancel_work, &mut rx, Duration::from_secs(300)), async {
            tokio::time::sleep(Duration::from_millis(400)).await;
            let _ = tx.send(());
        });
        println!("cancelled run -> {result:?}");
        tokio::time::sleep(Duration::from_millis(800)).await;
        let leftovers = std::process::Command::new("pgrep").args(["-f", &cancel_profile.to_string_lossy()]).output().unwrap();
        assert!(String::from_utf8_lossy(&leftovers.stdout).trim().is_empty(), "LibreOffice processes survived the cancel: {:?}", String::from_utf8_lossy(&leftovers.stdout));
        assert!(matches!(result, Err(OfficeError::Cancelled)) || result.is_ok(), "{result:?}");
        println!("output folder: {:?}", names(&out));
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    // ---- the whole pipeline against a stand-in for soffice (unix shell script)

    #[cfg(unix)]
    mod fake {
        use super::*;
        use lopdf::{dictionary, Document, Object, Stream};
        use std::os::unix::fs::PermissionsExt;

        /// A real one-page PDF for the stand-in to hand back.
        fn sample_pdf(dir: &Path) -> PathBuf {
            let mut doc = Document::with_version("1.5");
            let pages = doc.new_object_id();
            let content = doc.add_object(Stream::new(lopdf::Dictionary::new(), b"".to_vec()));
            let page = doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages, "Contents" => content, "MediaBox" => vec![0.into(), 0.into(), 100.into(), 100.into()] });
            doc.objects.insert(pages, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }));
            let cat = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
            doc.trailer.set("Root", cat);
            let path = dir.join("template.pdf");
            doc.save(&path).unwrap();
            path
        }

        /// Behaves like `soffice --convert-to pdf`, steered by the input file's name:
        /// *fail* errors out, *silent* succeeds without output, *garbage* writes junk,
        /// *hang* starts a long-running child. Logs its arguments one per line.
        fn fake_soffice(dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
            let template = sample_pdf(dir);
            let log = dir.join("args.log");
            let pidfile = dir.join("child.pid");
            let script = dir.join("soffice");
            let body = format!(
                r#"#!/bin/sh
for a in "$@"; do printf '%s\n' "$a"; done > '{log}'
outdir=""; prev=""
for a in "$@"; do if [ "$prev" = "--outdir" ]; then outdir="$a"; fi; prev="$a"; last="$a"; done
name=$(basename "$last"); stem="${{name%.*}}"
case "$name" in
  *fail*) echo "Error: source file could not be loaded" >&2; exit 1;;
  *silent*) exit 0;;
  *garbage*) echo "this is not a pdf at all" > "$outdir/$stem.pdf"; exit 0;;
  *hang*) sleep 60 & echo $! > '{pid}'; wait;;
esac
cp '{template}' "$outdir/$stem.pdf"
"#,
                log = log.display(),
                pid = pidfile.display(),
                template = template.display()
            );
            std::fs::write(&script, body).unwrap();
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            (script, log, pidfile)
        }

        async fn run(script: &Path, input: &Path, final_dir: &Path, root: &Path, timeout: Duration) -> Result<PathBuf, OfficeError> {
            let (_keep, mut rx) = oneshot::channel::<()>();
            convert(script, input, final_dir, &root.join("profile"), &root.join("work"), &mut rx, timeout).await
        }


        #[tokio::test]
        async fn converts_and_never_overwrites() {
            let root = workdir("convert");
            let (script, log, _) = fake_soffice(&root);
            let out = root.join("out folder"); // spaces on purpose
            std::fs::create_dir_all(&out).unwrap();
            let input = root.join("Laporan Tahunan \u{e9}.pptx");
            std::fs::write(&input, b"pretend pptx").unwrap();

            let first = run(&script, &input, &out, &root, Duration::from_secs(30)).await.unwrap();
            assert_eq!(first, out.join("Laporan Tahunan \u{e9}.pdf"));
            assert!(looks_like_pdf(&first));
            assert!(!root.join("work").exists(), "the scratch folder is cleaned up");

            let second = run(&script, &input, &out, &root, Duration::from_secs(30)).await.unwrap();
            assert_eq!(second, out.join("Laporan Tahunan \u{e9} (1).pdf"), "a second run must not replace the first");
            assert_eq!(names(&out).len(), 2);

            let logged = std::fs::read_to_string(&log).unwrap();
            assert!(logged.contains("--headless") && logged.contains("--convert-to\npdf"));
            assert_eq!(logged.lines().last().unwrap(), input.to_string_lossy(), "the input path reached the program intact");
            assert!(root.join("profile").exists(), "a good run keeps the profile, so later runs start fast");
        }

        #[tokio::test]
        async fn failures_are_reported_and_the_profile_is_discarded() {
            let root = workdir("fail");
            let (script, _, _) = fake_soffice(&root);
            let out = root.join("out");
            std::fs::create_dir_all(&out).unwrap();

            let failing = root.join("will-fail.docx");
            std::fs::write(&failing, b"x").unwrap();
            match run(&script, &failing, &out, &root, Duration::from_secs(30)).await {
                Err(OfficeError::Failed(m)) => assert!(m.contains("could not be loaded"), "{m}"),
                other => panic!("{other:?}"),
            }
            assert!(!root.join("profile").exists(), "an interrupted profile is thrown away");

            // exits 0 but writes nothing / writes junk: typically a password-protected or damaged file
            for name in ["silent.pptx", "garbage.pptx"] {
                let f = root.join(name);
                std::fs::write(&f, b"x").unwrap();
                assert_eq!(run(&script, &f, &out, &root, Duration::from_secs(30)).await, Err(OfficeError::NoOutput), "{name}");
            }
            assert!(names(&out).is_empty(), "nothing is left in the output folder after failures");
        }

        fn alive(pid: i32) -> bool {
            unsafe { libc::kill(pid, 0) == 0 }
        }

        async fn child_pid(file: &Path) -> i32 {
            for _ in 0..40 {
                if let Ok(t) = std::fs::read_to_string(file) {
                    if let Ok(p) = t.trim().parse() {
                        return p;
                    }
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            panic!("the stand-in never reported its child");
        }

        #[tokio::test]
        async fn cancel_kills_the_launcher_and_the_process_it_started() {
            let root = workdir("cancel");
            let (script, _, pidfile) = fake_soffice(&root);
            let out = root.join("out");
            std::fs::create_dir_all(&out).unwrap();
            let input = root.join("will-hang.pptx");
            std::fs::write(&input, b"x").unwrap();

            let (tx, mut rx) = oneshot::channel::<()>();
            let started = std::time::Instant::now();
            let (profile, work) = (root.join("profile"), root.join("work"));
            let (result, pid) = tokio::join!(convert(&script, &input, &out, &profile, &work, &mut rx, Duration::from_secs(120)), async {
                let pid = child_pid(&pidfile).await;
                assert!(alive(pid));
                let _ = tx.send(());
                pid
            });
            assert_eq!(result, Err(OfficeError::Cancelled));
            assert!(started.elapsed() < Duration::from_secs(10));
            tokio::time::sleep(Duration::from_millis(300)).await;
            assert!(!alive(pid), "soffice.bin must die with soffice, or LibreOffice keeps running invisibly");
            assert!(!root.join("work").exists() && !root.join("profile").exists());
            assert!(names(&out).is_empty());
        }

        #[tokio::test]
        async fn a_conversion_that_never_finishes_times_out_and_is_killed() {
            let root = workdir("timeout");
            let (script, _, pidfile) = fake_soffice(&root);
            let out = root.join("out");
            std::fs::create_dir_all(&out).unwrap();
            let input = root.join("will-hang.pptx");
            std::fs::write(&input, b"x").unwrap();

            let started = std::time::Instant::now();
            let result = run(&script, &input, &out, &root, Duration::from_millis(1500)).await;
            assert_eq!(result, Err(OfficeError::TimedOut));
            assert!(started.elapsed() < Duration::from_secs(10));
            let pid = child_pid(&pidfile).await;
            tokio::time::sleep(Duration::from_millis(300)).await;
            assert!(!alive(pid));
        }

        #[tokio::test]
        async fn a_missing_program_is_a_clean_error() {
            let root = workdir("missing");
            let input = root.join("a.pptx");
            std::fs::write(&input, b"x").unwrap();
            let r = run(Path::new("/definitely/not/soffice"), &input, &root, &root, Duration::from_secs(5)).await;
            assert!(matches!(r, Err(OfficeError::Failed(m)) if m.contains("LibreOffice")));
        }

        #[test]
        fn error_codes_reach_the_interface() {
            assert_eq!(OfficeError::Cancelled.into_message(), "cancelled");
            assert_eq!(OfficeError::TimedOut.into_message(), "timeout|");
            assert_eq!(OfficeError::NoOutput.into_message(), "noOutput|");
            assert_eq!(OfficeError::Failed("boom".into()).into_message(), "failed|boom");
        }
    }
}
