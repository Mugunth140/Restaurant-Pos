#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::create_dir_all;
use std::process::{Command, Stdio};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Spawn Bun backend (local only)
            let cwd = std::env::current_dir().unwrap_or_default();
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()));
            let cwd_parent = cwd.parent().map(|p| p.to_path_buf());
            let app_dir = if cwd.join("bun").join("server.ts").exists() {
                cwd.clone()
            } else if let Some(parent) = cwd_parent {
                if parent.join("bun").join("server.ts").exists() {
                    parent
                } else if let Some(dir) = exe_dir {
                    dir
                } else {
                    cwd
                }
            } else if let Some(dir) = exe_dir {
                dir
            } else {
                cwd
            };
            let data_dir = if app_dir.join("bun").join("server.ts").exists() {
                app_dir.join("db")
            } else {
                app.path_resolver()
                    .app_data_dir()
                    .unwrap_or_else(|| app_dir.join("db"))
            };
            let mut schema_path = app
                .path_resolver()
                .resolve_resource("db/schema.sql")
                .unwrap_or_else(|| app_dir.join("db").join("schema.sql"));
            if !schema_path.exists() {
                schema_path = data_dir.join("schema.sql");
            }
            let _ = create_dir_all(&data_dir);
            let _child = Command::new("bun")
                .current_dir(&app_dir)
                .env("MEATEAT_POS_DATA_DIR", &data_dir)
                .env("POS_DATA_DIR", &data_dir)
                .env("MEATEAT_POS_SCHEMA_PATH", &schema_path)
                .env("POS_SCHEMA_PATH", &schema_path)
                .arg("run")
                .arg("bun/server.ts")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
