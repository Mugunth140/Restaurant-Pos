# Meet & Eat POS

Lightweight offline desktop POS for low-end hardware.

## Architecture

- Single-process desktop app (Tauri + Rust + SQLite)
- No separate backend service required in production
- Data location (Windows): `%APPDATA%/com.meetandeat.app/app.db`
- Backups (Windows): `%APPDATA%/com.meetandeat.app/backups/`

## Requirements

- Bun
- Rust toolchain (for Tauri)

## Install

1. `bun install`

## Run (development)

- `bun run tauri:dev`

## Build (production)

- `bun run tauri:build`
- Windows installer (EXE + MSI): `bun run tauri:build:windows`

## Production Readiness

- SQLite is configured for production throughput: WAL, busy timeout, memory temp store, mmap, and tuned cache.
- All bill creation writes are transactional.
- Backup defaults are auto-initialized to AppData backup folder.
- Release build uses size optimizations in `src-tauri/Cargo.toml`.

### Capacity target

This setup is suitable for your target of ~2000 receipts/day with ~200 menu items on a typical Windows POS machine.

Recommended ops settings:
- Keep at least 1 GB free disk space for DB + WAL + backups.
- Run automatic backups daily (default 1440 minutes).
- Keep the app on local disk (not network share).

## Troubleshooting installer policy blocks

If Windows shows "The system administrator has set policies to prevent this installation":

- Try the EXE installer first (per-user, non-elevated) — it should not require admin after the change we made.
- If your environment enforces App Control / Group Policy, request IT to allow the installer (share the installer hash or add to allowed installers).
- As a workaround you can use the portable build (copy `src-tauri/target/release/Meet and Eat POS.exe` to a trusted folder and run it).
- For production releases we recommend code-signing installers (SHA-256) and submitting to your IT/security team for allowlisting.

## Notes

- The app uses direct Tauri IPC (`api_call`) to access Rust backend logic.
