# Meet & Eat POS

Lightweight offline desktop POS for low-end hardware.

## Requirements

- Bun
- Rust toolchain (for Tauri)

## Install

1. `bun install`
2. `bun run backend` (optional if running UI only)

## Run (development)

- `bun run tauri:dev`

## Build (production)

- `bun run tauri:build`
- Windows installer (EXE + MSI): `bun run tauri:build:windows`

## Troubleshooting installer policy blocks

If Windows shows "The system administrator has set policies to prevent this installation":

- Try the EXE installer first (per-user, non-elevated) — it should not require admin after the change we made.
- If your environment enforces App Control / Group Policy, request IT to allow the installer (share the installer hash or add to allowed installers).
- As a workaround you can use the portable build (copy `src-tauri/target/release/Meet and Eat POS.exe` to a trusted folder and run it).
- For production releases we recommend code-signing installers (SHA-256) and submitting to your IT/security team for allowlisting.

## Notes

- The Bun backend is started automatically by Tauri (see `src-tauri/src/main.rs`).
- SQLite file is stored at `db/app.db`.
- Backups are created under `backups/` by default.
