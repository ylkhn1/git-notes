# git-notes

Cross-platform Markdown notes where every notebook is a Git repository synced to any remote
(GitHub, Gitea, plain SSH server). Linux first, then Android and Windows.

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
- Phase 4 — polish: command palette, quick switcher, full-text search, settings screen,
  shortcuts help, first-run flow, Android share target, periodic sync, in-app updates and
  GitHub Releases, Russian interface: done
- Links between notes: `[[wiki links]]` with completion, backlinks and rename updates; a
  selection toolbar and a right-click menu in the desktop editor: done

The interface is available in English and Russian. It follows the device language; pick one
explicitly in Settings → Appearance → Language.

## Install

Builds are published on [GitHub Releases](https://github.com/ylkhn1/git-notes/releases):
Linux (AppImage, `.deb`, `.rpm`), Windows (installer, `.msi`) and an Android APK. Desktop
builds check for new releases and update themselves; see [docs/release.md](docs/release.md).
The bundle identifier is `com.ylkhn.gitnotes`.

## Links between notes

Type `[[` to link to another note: a list of notes appears as you type. `[[Note#Heading]]`
links to a heading, `[[Note|text]]` shows `text` instead of the name. Click a link to open
it (Ctrl-click while editing that line); a link to a note that does not exist yet creates
it. The strip under the editor lists every note that links to the open one. Renaming or
moving a note updates the links to it.

## Sync between devices

Every notebook is an ordinary git repository, so any git host works: GitHub, Gitea, GitLab or
a bare repository on an SSH server. Each device has its own SSH key (generated inside the app,
stored in the OS credential store) or an HTTPS token. Walk-through with GitHub:

1. **Create an empty private repository** — no README, no `.gitignore`, so the first sync does
   not have to merge two histories:

   ```sh
   gh repo create notes --private
   ```

2. **First device (the one that already has notes).**
   - Settings (`Ctrl+,`) → **Credentials** → _SSH key_ → **Generate key**. Copy the public key
     and add it to GitHub under _Settings → SSH and GPG keys_ (one key per device, name it after
     the device). The private key never leaves the credential store.
   - Open the notebook, click the sync status at the bottom left (the cloud icon on Android) →
     **Remote & git setup…** → _Remote URL_ `git@github.com:<you>/notes.git` → **Save**.
   - **Sync now** (`Ctrl+Shift+S`). The first run commits what is in the folder and pushes
     `main`. GitHub's host key is trusted on first use and listed under Credentials → _Known SSH
     hosts_; compare the fingerprint with the one GitHub publishes.

3. **Every other device.** Install the app, finish the first-run questions, then open the
   appearance menu (top right) → **All settings…** → **Credentials** → **Generate key** and add
   that key to GitHub too. Back on the first screen choose **Clone an existing repository**
   (**Clone repository** on the notebook list) and paste the same URL. On Android the clone
   lives in the app's private storage.

4. **That is all.** Changes are committed and pushed 30 s after you stop typing, pulled when
   the app regains focus and every 15 min while it is open; _Sync now_ forces a run. If two
   devices edit the same lines, both versions are kept and a banner offers a side-by-side
   view to pick one. Everything is tunable in Settings → _Sync & identity_.

**HTTPS instead of SSH:** create a fine-grained personal access token with _Contents:
read and write_ on the notes repository, save it under Credentials → _HTTPS tokens_ for host
`github.com`, and use `https://github.com/<you>/notes.git` as the remote URL. Cloning a public
repository needs no credentials at all.

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
  lib/i18n/            UI languages: t(), useT(), rich(); messages/<namespace>.ts (en + ru)
src-tauri/
  src/commands/        thin #[tauri::command] layer
  src/notebook/        notebooks and files
  src/git/             git operations (pure functions over a repo path)
  src/sync/            sync engine and state machine
  src/secrets/         SecretStore trait (keyring / Android Keystore)
  src/error.rs         AppError, serialized to the frontend
scripts/               release helpers (bump-version.mjs)
docs/                  developer documentation (dev-setup.md, release.md)
```
