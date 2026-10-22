//! Safe batch rename.
//!
//! Guarantees:
//! - Nothing is overwritten, ever. A target that exists and is not itself being
//!   renamed away is an error, and so are two files mapped to one name.
//! - Everything is checked before the first rename, so a bad batch changes nothing.
//! - Swaps (a<->b) and cycles work: files first move to temporary names, then to
//!   their final names.
//! - If a rename fails half way, what was done is rolled back.
//! - `apply` returns the operations needed to undo it.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

/// macOS and Windows treat "A.txt" and "a.txt" as the same file.
const CASE_INSENSITIVE: bool = cfg!(any(target_os = "macos", target_os = "windows"));

fn fold(s: &str) -> String {
    if CASE_INSENSITIVE { s.to_lowercase() } else { s.to_string() }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameOp {
    /// Full path of the existing file.
    pub from: String,
    /// New file name only (no folders).
    pub to: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpCheck {
    pub from: String,
    pub to: String,
    /// Machine-readable reason (the UI translates it); None when the op is fine.
    pub error: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Done {
    pub from: String,
    pub to: String,
}

const WINDOWS_RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3",
    "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A bare, portable file name: no folders, nothing Windows would refuse, at
/// most 255 bytes. Portable on purpose so a renamed file can move between systems.
pub fn validate_name(name: &str) -> Option<&'static str> {
    if name.is_empty() || name.trim().is_empty() || name == "." || name == ".." {
        return Some("invalidName");
    }
    if name.len() > 255 {
        return Some("tooLong");
    }
    if name.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c)) {
        return Some("invalidName");
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Some("invalidName");
    }
    let stem = name.split('.').next().unwrap_or("").to_uppercase();
    if WINDOWS_RESERVED.contains(&stem.as_str()) {
        return Some("invalidName");
    }
    None
}

fn parent_of(path: &Path) -> PathBuf {
    path.parent().map(Path::to_path_buf).unwrap_or_default()
}

fn file_name_of(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Checks every operation without touching the disk (besides looking).
pub fn check(ops: &[RenameOp]) -> Vec<OpCheck> {
    // Which files are being renamed away: their current names become free.
    let mut leaving: HashSet<String> = HashSet::new();
    for op in ops {
        let from = Path::new(&op.from);
        if file_name_of(from) != op.to {
            leaving.insert(fold(&from.to_string_lossy()));
        }
    }

    // How many operations want each target path.
    let mut wanted: HashMap<String, usize> = HashMap::new();
    for op in ops {
        *wanted.entry(fold(&parent_of(Path::new(&op.from)).join(&op.to).to_string_lossy())).or_default() += 1;
    }

    ops.iter()
        .map(|op| {
            let from = Path::new(&op.from);
            let target = parent_of(from).join(&op.to);
            let error = if !from.is_file() {
                Some("missing")
            } else if let Some(e) = validate_name(&op.to) {
                Some(e)
            } else if file_name_of(from) == op.to {
                None // unchanged: nothing to do, not a problem
            } else if wanted.get(&fold(&target.to_string_lossy())).copied().unwrap_or(0) > 1 {
                Some("duplicate")
            } else if target.exists() && !leaving.contains(&fold(&target.to_string_lossy())) {
                // A case-only rename on a case-insensitive disk points at the file
                // itself, which is `leaving`, so it is allowed through here.
                Some("exists")
            } else {
                None
            };
            OpCheck { from: op.from.clone(), to: op.to.clone(), error }
        })
        .collect()
}

fn temp_name(dir: &Path, index: usize) -> PathBuf {
    let mut n = 0u32;
    loop {
        let candidate = dir.join(format!(".toolbox-rename-{}-{index}-{n}.tmp", std::process::id()));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

pub fn apply(ops: &[RenameOp]) -> Result<Vec<Done>, String> {
    apply_with(ops, |a, b| fs::rename(a, b))
}

/// `rename` is injectable so the rollback path can be tested.
fn apply_with(ops: &[RenameOp], rename: impl Fn(&Path, &Path) -> std::io::Result<()>) -> Result<Vec<Done>, String> {
    let checks = check(ops);
    if let Some(bad) = checks.iter().find(|c| c.error.is_some()) {
        return Err(format!("{}:{}", bad.error.unwrap(), file_name_of(Path::new(&bad.from))));
    }

    // (original, temp, final) for everything that really changes
    let mut plan: Vec<(PathBuf, PathBuf, PathBuf)> = Vec::new();
    for (i, op) in ops.iter().enumerate() {
        let from = PathBuf::from(&op.from);
        if file_name_of(&from) == op.to {
            continue;
        }
        let dir = parent_of(&from);
        plan.push((from.clone(), temp_name(&dir, i), dir.join(&op.to)));
    }

    let mut parked: Vec<usize> = Vec::new(); // moved to temp
    let mut finished: Vec<usize> = Vec::new(); // at final name

    let rollback = |parked: &[usize], finished: &[usize]| {
        for &i in finished.iter().rev() {
            let _ = rename(&plan[i].2, &plan[i].0);
        }
        for &i in parked.iter().rev() {
            if !finished.contains(&i) {
                let _ = rename(&plan[i].1, &plan[i].0);
            }
        }
    };

    for (i, (from, temp, _)) in plan.iter().enumerate() {
        if let Err(e) = rename(from, temp) {
            rollback(&parked, &finished);
            return Err(format!("failed:{}:{e}", file_name_of(from)));
        }
        parked.push(i);
    }
    for (i, (from, temp, to)) in plan.iter().enumerate() {
        // last look before moving, so a file that appeared meanwhile is not replaced
        if to.exists() {
            rollback(&parked, &finished);
            return Err(format!("exists:{}", file_name_of(to)));
        }
        if let Err(e) = rename(temp, to) {
            rollback(&parked, &finished);
            return Err(format!("failed:{}:{e}", file_name_of(from)));
        }
        finished.push(i);
    }

    Ok(plan
        .into_iter()
        .map(|(from, _, to)| Done { from: from.to_string_lossy().into_owned(), to: to.to_string_lossy().into_owned() })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Modified time, milliseconds since the Unix epoch (0 if unknown).
    pub mtime_ms: u64,
}

fn stat(path: &str) -> Result<FileStat, String> {
    let p = Path::new(path);
    let meta = fs::metadata(p).map_err(|e| format!("{path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{path}: bukan file"));
    }
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStat { path: path.to_string(), name: file_name_of(p), size: meta.len(), mtime_ms })
}

#[tauri::command]
pub fn file_stats(paths: Vec<String>) -> Vec<Result<FileStat, String>> {
    paths.iter().map(|p| stat(p)).collect()
}

#[tauri::command]
pub fn rename_check(ops: Vec<RenameOp>) -> Vec<OpCheck> {
    check(&ops)
}

#[tauri::command]
pub async fn rename_apply(ops: Vec<RenameOp>) -> Result<Vec<Done>, String> {
    tauri::async_runtime::spawn_blocking(move || apply(&ops)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn workdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("toolbox-rename-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file(dir: &Path, name: &str, content: &str) -> String {
        let p = dir.join(name);
        fs::write(&p, content).unwrap();
        p.to_string_lossy().into_owned()
    }

    fn op(from: &str, to: &str) -> RenameOp {
        RenameOp { from: from.into(), to: to.into() }
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    fn read(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap()
    }

    #[test]
    fn renames_and_reports_what_it_did() {
        let dir = workdir("basic");
        let a = file(&dir, "a.txt", "A");
        let b = file(&dir, "b.txt", "B");
        let done = apply(&[op(&a, "one.txt"), op(&b, "two.txt")]).unwrap();
        assert_eq!(names(&dir), ["one.txt", "two.txt"]);
        assert_eq!((read(&dir, "one.txt"), read(&dir, "two.txt")), ("A".into(), "B".into()));
        assert_eq!(done.len(), 2);
        assert_eq!(done[0].to, dir.join("one.txt").to_string_lossy());
    }

    #[test]
    fn swaps_and_cycles_keep_each_files_content() {
        let dir = workdir("cycle");
        let (a, b, c) = (file(&dir, "a.txt", "A"), file(&dir, "b.txt", "B"), file(&dir, "c.txt", "C"));
        // a->b, b->c, c->a: every target is occupied by a file that is itself leaving
        apply(&[op(&a, "b.txt"), op(&b, "c.txt"), op(&c, "a.txt")]).unwrap();
        assert_eq!(names(&dir), ["a.txt", "b.txt", "c.txt"]);
        assert_eq!((read(&dir, "b.txt"), read(&dir, "c.txt"), read(&dir, "a.txt")), ("A".into(), "B".into(), "C".into()));

        // plain two-way swap
        let (x, y) = (dir.join("a.txt").to_string_lossy().into_owned(), dir.join("b.txt").to_string_lossy().into_owned());
        apply(&[op(&x, "b.txt"), op(&y, "a.txt")]).unwrap();
        assert_eq!((read(&dir, "a.txt"), read(&dir, "b.txt")), ("A".into(), "C".into()));
        assert!(names(&dir).iter().all(|n| !n.contains("toolbox-rename")), "no temp files left behind");
    }

    #[test]
    fn never_overwrites_a_file_that_is_not_part_of_the_batch() {
        let dir = workdir("exists");
        let a = file(&dir, "a.txt", "A");
        file(&dir, "keep.txt", "KEEP");
        let before = names(&dir);
        let err = apply(&[op(&a, "keep.txt")]).unwrap_err();
        assert!(err.starts_with("exists:"), "{err}");
        assert_eq!(names(&dir), before);
        assert_eq!(read(&dir, "keep.txt"), "KEEP");
        assert_eq!(read(&dir, "a.txt"), "A");
    }

    #[test]
    fn two_files_cannot_get_the_same_name_and_nothing_is_touched() {
        let dir = workdir("dup");
        let (a, b, c) = (file(&dir, "a.txt", "A"), file(&dir, "b.txt", "B"), file(&dir, "c.txt", "C"));
        let checks = check(&[op(&a, "same.txt"), op(&b, "same.txt"), op(&c, "ok.txt")]);
        assert_eq!(checks.iter().map(|c| c.error).collect::<Vec<_>>(), [Some("duplicate"), Some("duplicate"), None]);
        assert!(apply(&[op(&a, "same.txt"), op(&b, "same.txt"), op(&c, "ok.txt")]).is_err());
        assert_eq!(names(&dir), ["a.txt", "b.txt", "c.txt"], "a rejected batch must change nothing, not even the valid part");
        // on a case-insensitive disk "X.txt" and "x.txt" collide too
        if CASE_INSENSITIVE {
            assert_eq!(check(&[op(&a, "X.txt"), op(&b, "x.txt")])[0].error, Some("duplicate"));
        }
    }

    #[test]
    fn bad_names_are_rejected() {
        let dir = workdir("names");
        let a = file(&dir, "a.txt", "A");
        for bad in ["", " ", ".", "..", "x/y", "x\\y", "a:b", "q?", "a*b", "tab\there", "ends.", "ends ", "CON", "nul.txt", &"z".repeat(256)] {
            assert!(check(&[op(&a, bad)])[0].error.is_some(), "{bad:?} should be rejected");
        }
        for good in ["ok.txt", "résumé 2024.pdf", "日本語.txt", ".hidden", "a b-c_d (1).jpg", &"z".repeat(255)] {
            assert_eq!(check(&[op(&a, good)])[0].error, None, "{good:?} should be fine");
        }
        assert_eq!(names(&dir), ["a.txt"]);
    }

    #[test]
    fn unchanged_names_are_skipped_and_missing_sources_reported() {
        let dir = workdir("skip");
        let a = file(&dir, "a.txt", "A");
        let b = file(&dir, "b.txt", "B");
        let done = apply(&[op(&a, "a.txt"), op(&b, "c.txt")]).unwrap();
        assert_eq!(done.len(), 1, "the unchanged file is not reported as renamed");
        assert_eq!(names(&dir), ["a.txt", "c.txt"]);

        let ghost = dir.join("ghost.txt").to_string_lossy().into_owned();
        assert_eq!(check(&[op(&ghost, "x.txt")])[0].error, Some("missing"));
    }

    #[test]
    fn a_case_only_rename_works() {
        let dir = workdir("case");
        let a = file(&dir, "photo.jpg", "P");
        apply(&[op(&a, "PHOTO.jpg")]).unwrap();
        assert_eq!(names(&dir), ["PHOTO.jpg"]);
        assert_eq!(read(&dir, "PHOTO.jpg"), "P");
    }

    #[test]
    fn undo_restores_the_original_names() {
        let dir = workdir("undo");
        let (a, b) = (file(&dir, "a.txt", "A"), file(&dir, "b.txt", "B"));
        let done = apply(&[op(&a, "b.txt"), op(&b, "a.txt")]).unwrap(); // a swap, the nastiest case
        let undo: Vec<RenameOp> = done.iter().map(|d| op(&d.to, &file_name_of(Path::new(&d.from)))).collect();
        apply(&undo).unwrap();
        assert_eq!((read(&dir, "a.txt"), read(&dir, "b.txt")), ("A".into(), "B".into()));
    }

    #[test]
    fn a_failure_part_way_rolls_everything_back() {
        let dir = workdir("rollback");
        let (a, b, c) = (file(&dir, "a.txt", "A"), file(&dir, "b.txt", "B"), file(&dir, "c.txt", "C"));
        // fail on the 5th rename: all three parked, one finished, the second final move fails
        let calls = Cell::new(0);
        let flaky = |from: &Path, to: &Path| {
            calls.set(calls.get() + 1);
            if calls.get() == 5 { Err(std::io::Error::other("disk on fire")) } else { fs::rename(from, to) }
        };
        let err = apply_with(&[op(&a, "x.txt"), op(&b, "y.txt"), op(&c, "z.txt")], flaky).unwrap_err();
        assert!(err.starts_with("failed:"), "{err}");
        assert_eq!(names(&dir), ["a.txt", "b.txt", "c.txt"], "all files back under their old names, no temp files");
        assert_eq!((read(&dir, "a.txt"), read(&dir, "b.txt"), read(&dir, "c.txt")), ("A".into(), "B".into(), "C".into()));
    }

    #[test]
    fn stats_report_names_sizes_and_reject_folders() {
        let dir = workdir("stat");
        let a = file(&dir, "a.txt", "hello");
        let s = stat(&a).unwrap();
        assert_eq!((s.name.as_str(), s.size), ("a.txt", 5));
        assert!(s.mtime_ms > 1_600_000_000_000);
        assert!(stat(&dir.to_string_lossy()).is_err());
        assert!(stat("/definitely/not/here").is_err());
    }
}
