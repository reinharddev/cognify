use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Folders searched for engine binaries (ffmpeg, ffprobe, yt-dlp, ...), in
/// priority order:
///
/// 1. next to the app executable: where Tauri puts bundled sidecars
///    (`Contents/MacOS` in a macOS app, `target/debug` under `tauri dev`)
/// 2. the app-managed folder, where engines downloaded later will live
/// 3. well-known system locations; GUI apps on macOS do not inherit the shell
///    PATH, so the Homebrew folders are listed explicitly
/// 4. PATH
///
/// A bundled engine wins over a system one so behaviour is the same on every
/// machine (system ffmpeg builds differ, e.g. Homebrew's has no libwebp).
fn search_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        dirs.push(dir);
    }
    if let Ok(dir) = app.path().app_data_dir() {
        dirs.push(dir.join("engines"));
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(dir));
    }
    if let Some(paths) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&paths));
    }
    dirs
}

/// First directory in `dirs` that contains an executable called `name`.
fn find_in(dirs: &[PathBuf], name: &str) -> Option<PathBuf> {
    let file = exe_name(name);
    dirs.iter().map(|d| d.join(&file)).find(|p| p.is_file())
}

pub fn resolve(app: &AppHandle, name: &str) -> Option<PathBuf> {
    find_in(&search_dirs(app), name)
}

#[tauri::command]
pub fn engine_status(app: AppHandle, name: String) -> Option<String> {
    resolve(&app, &name).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("toolbox-engine-test-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn earlier_directory_wins() {
        let bundled = temp("bundled");
        let system = temp("system");
        std::fs::write(bundled.join(exe_name("ffmpeg")), b"bundled").unwrap();
        std::fs::write(system.join(exe_name("ffmpeg")), b"system").unwrap();

        let found = find_in(&[bundled.clone(), system.clone()], "ffmpeg").unwrap();
        assert_eq!(found.parent().unwrap(), bundled);

        // and the reverse order really does change the answer
        let found = find_in(&[system.clone(), bundled], "ffmpeg").unwrap();
        assert_eq!(found.parent().unwrap(), system);
    }

    #[test]
    fn falls_through_to_later_directories_and_reports_missing() {
        let empty = temp("empty");
        let system = temp("fallback");
        std::fs::write(system.join(exe_name("ffprobe")), b"x").unwrap();

        let found = find_in(&[empty.clone(), system.clone()], "ffprobe").unwrap();
        assert_eq!(found.parent().unwrap(), system);
        assert!(find_in(&[empty], "ffprobe").is_none());
    }

    #[test]
    fn a_directory_named_like_the_engine_is_not_an_engine() {
        let root = temp("dirtrap");
        std::fs::create_dir_all(root.join(exe_name("ffmpeg"))).unwrap();
        assert!(find_in(&[root], "ffmpeg").is_none());
    }
}
