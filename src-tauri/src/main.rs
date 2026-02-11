#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Stdio};

fn main() {
  tauri::Builder::default()
    .setup(|_| {
      // Spawn Bun backend (local only)
      let _child = Command::new("bun")
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
