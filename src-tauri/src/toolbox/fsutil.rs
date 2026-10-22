use std::path::{Path, PathBuf};

/// Where results go: the chosen folder, or next to the source file.
pub fn output_dir(source: &Path, out_dir: Option<&str>) -> PathBuf {
    out_dir
        .map(PathBuf::from)
        .or_else(|| source.parent().map(Path::to_path_buf))
        .unwrap_or_default()
}

pub fn stem_of(path: &Path) -> &str {
    path.file_stem().and_then(|s| s.to_str()).unwrap_or("output")
}

/// `<dir>/<stem>.<ext>`, or `<stem> (n).<ext>` if that already exists.
/// Never overwrites an existing file.
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}.{ext}"));
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    candidate
}
