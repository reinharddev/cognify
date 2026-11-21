fn main() {
    link_apple_runtime();
    tauri_build::build()
}

/// whisper.cpp (Metal) memakai `@available`, yang pada target macOS lama (build rilis memakai 11.0) memanggil
/// `__isPlatformVersionAtLeast` dari compiler-rt. Rust menautkan dengan `-nodefaultlibs`, jadi library itu harus
/// ditambahkan sendiri, kalau tidak build rilis gagal di tahap tautan.
fn link_apple_runtime() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let Ok(out) = std::process::Command::new("clang").arg("--print-resource-dir").output() else { return };
    let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let lib = format!("{dir}/lib/darwin");
    if std::path::Path::new(&format!("{lib}/libclang_rt.osx.a")).exists() {
        println!("cargo:rustc-link-search=native={lib}");
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
    }
}
