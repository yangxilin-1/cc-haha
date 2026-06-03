// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

fn main() {
    // Match the original Ycode desktop behavior: all desktop data lives beside
    // the app executable in "Ycode Data".
    if let Some(portable_dir) = resolve_ycode_data_dir() {
        std::env::set_var(
            "CLAUDE_CONFIG_DIR",
            portable_dir.to_string_lossy().to_string(),
        );
        std::env::set_var("CC_HAHA_APP_PORTABLE_DIR", "1");

        let webview_data = portable_dir.join("EBWebView");
        if let Err(e) = fs::create_dir_all(&webview_data) {
            eprintln!("[desktop] failed to create EBWebView dir: {e}");
        }
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_data);
    }

    ycode_desktop_lib::run()
}

fn resolve_ycode_data_dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("YCODE_DATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    Some(exe_dir.join("Ycode Data"))
}
