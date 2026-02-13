#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::create_dir_all;
use std::fs::{remove_file, write};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptItem {
    name: String,
    qty: i32,
    unit_price_cents: i32,
    line_total_cents: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptPayload {
    bill_no: String,
    printed_at: String,
    subtotal_cents: i32,
    discount_rate_bps: i32,
    discount_cents: i32,
    total_cents: i32,
    items: Vec<ReceiptItem>,
}

fn cents_to_rs(cents: i32) -> String {
    format!("{:.2}", (cents as f64) / 100.0)
}

fn pad_right(value: &str, width: usize) -> String {
    if value.len() >= width {
        return value.to_string();
    }
    let mut out = String::with_capacity(width);
    out.push_str(value);
    out.push_str(&" ".repeat(width - value.len()));
    out
}

fn pad_left(value: &str, width: usize) -> String {
    if value.len() >= width {
        return value.to_string();
    }
    let mut out = String::with_capacity(width);
    out.push_str(&" ".repeat(width - value.len()));
    out.push_str(value);
    out
}

fn fit_text(value: &str, width: usize) -> String {
    let trimmed = value.trim();
    let mut out = String::new();
    for ch in trimmed.chars() {
        if out.len() >= width {
            break;
        }
        out.push(ch);
    }
    out
}

fn line_two_col(left: &str, right: &str, width: usize) -> String {
    if right.len() >= width {
        return fit_text(right, width);
    }
    let left_room = width.saturating_sub(right.len() + 1);
    let left_text = fit_text(left, left_room);
    let spaces = width.saturating_sub(left_text.len() + right.len());
    format!("{}{}{}", left_text, " ".repeat(spaces), right)
}

fn separator(width: usize) -> String {
    "-".repeat(width)
}

fn format_receipt_80mm(payload: &ReceiptPayload) -> String {
    let width = 42usize;
    let mut lines: Vec<String> = Vec::new();

    lines.push("MEET & EAT".to_string());
    lines.push("Fresh Food | Fast Service".to_string());
    lines.push(separator(width));
    lines.push(line_two_col(&format!("Bill: {}", payload.bill_no), &payload.printed_at, width));
    lines.push(separator(width));
    lines.push(format!(
        "{} {} {} {}",
        pad_right("Item", 20),
        pad_left("Qty", 5),
        pad_left("Rate", 7),
        pad_left("Amount", 10)
    ));
    lines.push(separator(width));

    for item in &payload.items {
        let item_name = fit_text(&item.name, 20);
        lines.push(format!(
            "{} {} {} {}",
            pad_right(&item_name, 20),
            pad_left(&item.qty.to_string(), 5),
            pad_left(&cents_to_rs(item.unit_price_cents), 7),
            pad_left(&cents_to_rs(item.line_total_cents), 10)
        ));
    }

    lines.push(separator(width));
    lines.push(line_two_col(
        "Subtotal",
        &format!("Rs {}", cents_to_rs(payload.subtotal_cents)),
        width,
    ));
    lines.push(line_two_col(
        &format!("Discount ({:.2}%)", (payload.discount_rate_bps as f64) / 100.0),
        &format!("-Rs {}", cents_to_rs(payload.discount_cents)),
        width,
    ));
    lines.push(line_two_col(
        "TOTAL",
        &format!("Rs {}", cents_to_rs(payload.total_cents)),
        width,
    ));
    lines.push(separator(width));
    lines.push("Thank you. Visit again!".to_string());
    lines.push("\n\n\n".to_string());

    lines.join("\r\n")
}

fn ps_escape_single_quotes(input: &str) -> String {
    input.replace('\'', "''")
}

#[tauri::command]
fn print_thermal_receipt(printer_name: String, payload: ReceiptPayload) -> Result<(), String> {
    let receipt = format_receipt_80mm(&payload);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let file_name = format!("meateat_receipt_{}.txt", now_ms);
    let temp_path = std::env::temp_dir().join(file_name);

    write(&temp_path, receipt).map_err(|e| format!("Failed to prepare receipt: {e}"))?;

    let path_escaped = ps_escape_single_quotes(&temp_path.to_string_lossy());
    let printer_escaped = ps_escape_single_quotes(printer_name.trim());
    let cmd = format!(
        "$content = Get-Content -LiteralPath '{}' -Raw; $content | Out-Printer -Name '{}';",
        path_escaped, printer_escaped
    );

    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(cmd)
        .output()
        .map_err(|e| format!("Printer command failed: {e}"))?;

    let _ = remove_file(&temp_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Failed to print on '{}': {}", printer_name, stderr));
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![print_thermal_receipt])
        .setup(|app| {
            // Spawn backend:
            // - dev: `bun run bun/server.ts`
            // - production bundle: `bin/backend.exe` resource
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

            let dev_server = app_dir.join("bun").join("server.ts");
            let bundled_backend = app.path_resolver().resolve_resource("bin/backend.exe");

            let mut backend_cmd = if dev_server.exists() {
                let mut cmd = Command::new("bun");
                cmd.current_dir(&app_dir)
                    .arg("run")
                    .arg("bun/server.ts");
                Some(cmd)
            } else if let Some(path) = bundled_backend {
                if path.exists() {
                    let mut cmd = Command::new(path);
                    cmd.current_dir(&app_dir);
                    Some(cmd)
                } else {
                    None
                }
            } else {
                None
            };

            if let Some(cmd) = backend_cmd.as_mut() {
                let _child = cmd
                    .env("MEATEAT_POS_DATA_DIR", &data_dir)
                    .env("POS_DATA_DIR", &data_dir)
                    .env("MEATEAT_POS_SCHEMA_PATH", &schema_path)
                    .env("POS_SCHEMA_PATH", &schema_path)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
