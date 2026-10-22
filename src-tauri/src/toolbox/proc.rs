//! Helpers for running other programs that start their own children.

use tokio::process::Command;

/// Starts the child as the leader of its own process group, so that
/// [`kill_tree`] can reach everything it spawns. Does nothing on Windows.
pub fn own_group(command: &mut Command) -> &mut Command {
    #[cfg(unix)]
    command.process_group(0);
    command
}

/// How many threads heavy work (encoding) may use: half the
/// cores, at least 2 and at most 8. Using every core finishes a little sooner but
/// pins the CPU, which is what makes a laptop hot and loud.
pub fn worker_threads() -> usize {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    (cores / 2).clamp(2, 8)
}

/// Runs the child at below-normal priority, so a long conversion yields to the
/// apps the user is actually working in instead of competing with them.
pub fn lower_priority(command: &mut Command) -> &mut Command {
    #[cfg(unix)]
    // SAFETY: the closure runs in the forked child before exec and only calls
    // setpriority, which is async-signal-safe.
    unsafe {
        command.pre_exec(|| {
            libc::setpriority(libc::PRIO_PROCESS as _, 0, 10);
            Ok(())
        });
    }
    #[cfg(windows)]
    command.creation_flags(0x0000_4000); // BELOW_NORMAL_PRIORITY_CLASS
    command
}

/// Kills the process and everything it started. Killing only the parent is not
/// enough for launchers: yt-dlp's binary runs the real program as a child, and
/// LibreOffice's `soffice` hands over to `soffice.bin`.
pub fn kill_tree(pid: u32) {
    #[cfg(unix)]
    // SAFETY: killpg only sends a signal; the child was started as its own group leader.
    unsafe {
        libc::killpg(pid as libc::pid_t, libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output();
    }
    #[cfg(not(any(unix, windows)))]
    let _ = pid;
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lowered_priority_reaches_the_child() {
        let mut command = Command::new("sleep");
        command.arg("5").kill_on_drop(true);
        lower_priority(&mut command);
        let child = command.spawn().unwrap();
        let out = std::process::Command::new("ps").args(["-o", "ni=", "-p", &child.id().unwrap().to_string()]).output().unwrap();
        let nice: i32 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap();
        assert_eq!(nice, 10);
    }
}
