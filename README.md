# git-notes

Cross-platform Markdown notes where every notebook is a Git repository synced to any remote
(GitHub, Gitea, plain SSH server). Linux first, then Android and Windows.

> Working name. `git-notes` / `com.example.gitnotes` are placeholders until the final name is chosen.

## Stack

- **Shell:** [Tauri 2](https://v2.tauri.app) (desktop + Android from one codebase)
- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4, shadcn/ui, lucide-react, zustand
- **Editor:** CodeMirror 6 with Obsidian-style live preview
- **Core:** Rust — `git2` (vendored libgit2 + OpenSSL), `ssh-key`, `keyring`, `tokio`, `tracing`, `thiserror`
- **Bindings:** [`tauri-specta`](https://github.com/specta-rs/tauri-specta) generates `src/lib/bindings.ts`

## Status

- Phase 0 — scaffold, CI, Android toolchain: done
- Phase 1 — local notes, live preview, Android layout: done
- Phase 2 — git: init/clone, SSH key + HTTPS tokens in the OS keyring, manual sync with
  rebase-then-merge and keep-both conflict copies, status, history with diff: done
- Phase 3 — auto-sync (debounce, focus/resume), offline queue with backoff, conflict banner
  with side-by-side resolution: done
- Phase 4 — polish (command palette, search, settings, onboarding, updater): next

## Quick start

See [docs/dev-setup.md](docs/dev-setup.md) for toolchain installation (Linux, Windows, Android).

```sh
pnpm install
pnpm tauri dev            # desktop
pnpm tauri android dev    # Android device / emulator
```

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
cd src-tauri; and cargo fmt --check; and cargo clippy --all-targets -- -D warnings; and cargo test
```

## Adding UI primitives

Components come from shadcn/ui (style `radix-nova`, aliases in `components.json`):

```sh
pnpm dlx shadcn@latest add popover
```

They land in `src/ui/`. Our tokens are defined in `src/app/styles.css`; the shadcn variable
names are mapped onto them there, so new components pick up the theme automatically.

## Layout

```
src/                   React app
  app/                 entry, global styles, design tokens
  features/            feature slices (notebooks, tree, editor, settings, shell)
  ui/                  shadcn/ui primitives
  lib/                 bindings.ts (generated — do not edit), helpers with tests
src-tauri/
  src/commands/        thin #[tauri::command] layer
  src/notebook/        notebooks and files
  src/git/             git operations (pure functions over a repo path)
  src/sync/            sync engine and state machine
  src/secrets/         SecretStore trait (keyring / Android Keystore)
  src/error.rs         AppError, serialized to the frontend
docs/                  developer documentation
```
