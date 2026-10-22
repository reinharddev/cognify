mod bridge;
mod clipboard;
mod notch;
mod ics_fetch;
mod link;
mod pdfmeta;
mod mcp;
mod store;
mod toolbox;
mod sticky;
mod tray;

use std::sync::atomic::Ordering;
use std::sync::Arc;

use clipboard::ClipboardWatcher;
use notch::Notch;
use store::Store;
use tauri::{Manager, RunEvent, WindowEvent};
use tray::Tray;

/// Tampilkan folder ekstensi browser di Finder / Explorer (untuk "Muat ekstensi yang belum dibuka").
/// App terpasang: folder `extension` di resources; `tauri dev`: folder `extension/` di repo.
#[tauri::command]
fn reveal_extension_folder(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let bundled = app.path().resource_dir().map(|d| d.join("extension")).ok();
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension");
    let dir = bundled.filter(|d| d.join("manifest.json").is_file()).unwrap_or(dev);
    let dir = dir.canonicalize().map_err(|e| e.to_string())?;
    app.opener().reveal_item_in_dir(dir.join("manifest.json")).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// `cognify --mcp`: server MCP lewat stdio tanpa membuka jendela. Mengembalikan kode keluar proses.
pub fn run_mcp() -> i32 {
    mcp::run()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(toolbox::ffmpeg::Jobs::default())
        .manage(toolbox::office::OfficeLock::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            // Pintasan global catatan melayang: catatan baru dari aplikasi mana pun.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Err(e) = sticky::new_note(app) {
                            log::warn!("Catatan melayang baru gagal: {e}");
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            // Log Rust → stdout & file di folder log app.
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            // Database lokal: gagal dibuka berarti app tidak bisa dipakai, jadi hentikan dengan pesan jelas.
            let dir = store::data_dir(app.handle())?;
            std::fs::create_dir_all(&dir)?;
            app.manage(Store::open(&dir.join("workspace.db"))?);

            app.manage(Tray::new());
            app.manage(ClipboardWatcher::new());
            app.manage(Notch::new());
            app.manage(bridge::Bridge::default());
            tray::setup(app.handle())?;
            sticky::restore(app.handle());
            sticky::set_shortcut(app.handle(), sticky::shortcut_enabled_in_prefs(app.handle()));
            link::start(app.handle().clone());
            bridge::start(app.handle());
            clipboard::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store::commands::backend_info,
            store::commands::page_create,
            store::commands::page_get,
            store::commands::page_tree,
            store::commands::page_update,
            store::commands::page_move,
            store::commands::page_trash,
            store::commands::page_restore,
            store::commands::page_delete_forever,
            store::commands::page_source_get,
            store::commands::page_source_set,
            store::commands::trash_list,
            store::commands::trash_empty,
            store::commands::proposal_list,
            store::commands::proposal_approve,
            store::commands::proposal_reject,
            store::commands::mcp_info,
            store::commands::page_search,
            store::commands::tag_list,
            store::commands::page_by_tag,
            store::commands::setting_get,
            store::commands::setting_set,
            store::commands::event_list,
            store::commands::event_create,
            store::commands::event_update,
            store::commands::event_delete,
            store::commands::calendar_source_list,
            store::commands::calendar_source_add,
            store::commands::calendar_source_refresh,
            store::commands::calendar_source_enable,
            store::commands::calendar_source_delete,
            link::link_status,
            link::link_connect,
            link::link_set_share_clipboard,
            link::link_disconnect,
            link::link_data,
            link::link_write_agenda,
            tray::tray_update,
            sticky::sticky_new,
            sticky::sticky_open,
            sticky::sticky_close,
            sticky::sticky_pin,
            sticky::sticky_open_in_main,
            sticky::sticky_shortcut,
            reveal_extension_folder,
            bridge::bridge_status,
            bridge::bridge_set_enabled,
            bridge::bridge_new_code,
            bridge::bridge_unpair,
            tray::set_keep_in_tray,
            clipboard::set_clipboard_monitor,
            notch::set_notch,
            toolbox::engine::engine_status,
            toolbox::engine_install::engine_catalog,
            toolbox::engine_install::engine_install,
            toolbox::engine_install::engine_remove,
            toolbox::convert::available_formats,
            toolbox::convert::convert_media,
            toolbox::ffmpeg::cancel_job,
            toolbox::compress::pdf_compress,
            toolbox::compress_media::compress_image,
            toolbox::compress_media::compress_video,
            toolbox::compress_media::video_plan,
            toolbox::rename::file_stats,
            toolbox::rename::rename_check,
            toolbox::rename::rename_apply,
            toolbox::files::read_base64_file,
            toolbox::files::read_text_file,
            toolbox::files::write_text_file,
            toolbox::files::write_base64_file,
            toolbox::pdf::pdf_info,
            toolbox::office::office_status,
            toolbox::office::office_to_pdf,
            toolbox::ytdlp::ytdlp_version,
            toolbox::ytdlp::media_info,
            toolbox::ytdlp::media_download,
            toolbox::video_edit::video_info,
            toolbox::video_edit::trim_video,
            toolbox::video_edit::join_plan,
            toolbox::video_edit::join_videos,
            toolbox::video_edit::video_frame,
            toolbox::pdf::pdf_merge,
            toolbox::pdf::pdf_split
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Opsi "tetap berjalan di menu bar": tutup jendela = sembunyikan, app tetap jalan
            // (pengingat & pantau clipboard tetap aktif). Default mati = tutup jendela keluar app.
            RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. }
                if label == "main" && app.state::<Tray>().keep_running.load(Ordering::SeqCst) =>
            {
                api.prevent_close();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => tray::show_main(app), // klik ikon Dock
            RunEvent::Exit => {
                app.state::<Arc<Notch>>().shutdown();
            }
            _ => {}
        });
}
