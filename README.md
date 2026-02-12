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

## Notes

- The Bun backend is started automatically by Tauri (see `src-tauri/src/main.rs`).
- SQLite file is stored at `db/app.db`.
- Backups are created under `backups/` by default.
