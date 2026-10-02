# git-notes

Cross-platform Markdown notes where every notebook is a Git repository synced to any remote
(GitHub, Gitea, plain SSH server). Linux first, then Android and Windows.

> Working name. `git-notes` / `com.example.gitnotes` are placeholders until the final name is chosen.

## Stack

- **Shell:** [Tauri 2](https://v2.tauri.app) (desktop + Android from one codebase)
- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4, shadcn/ui, lucide-react, zustand
- **Editor:** CodeMirror 6 with Obsidian-style live preview (Phase 1)
- **Core:** Rust — `git2` (vendored libgit2 + OpenSSL), `tokio`, `tracing`, `thiserror`
- **Bindings:** [`tauri-specta`](https://github.com/specta-rs/tauri-specta) generates `src/lib/bindings.ts`

## Quick start

See [docs/dev-setup.md](docs/dev-setup.md) for toolchain installation (Linux, Windows, Android).

```sh
pnpm install
pnpm tauri dev            # desktop
pnpm tauri android dev    # Android device / emulator
```

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm format:check
cd src-tauri; and cargo fmt --check; and cargo clippy --all-targets -- -D warnings; and cargo test
```

## Layout

```
src/                   React app
  app/                 entry, global styles, design tokens
  features/            feature slices (editor, tree, sync, settings, …)
  ui/                  shadcn/ui primitives
  lib/bindings.ts      generated — do not edit
src-tauri/
  src/commands/        thin #[tauri::command] layer
  src/notebook/        notebooks and files
  src/git/             git operations (pure functions over a repo path)
  src/sync/            sync engine and state machine
  src/secrets/         SecretStore trait (keyring / Android Keystore)
  src/error.rs         AppError, serialized to the frontend
docs/                  developer documentation
```
