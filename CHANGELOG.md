# Changelog

All notable changes to this project are documented here. Phases follow the project brief.

## Phase 1 — local notes, checkpoint 2 (2026-10-02)

### Added

- **Live preview** (`src/features/editor/cm/live-preview.ts`): Obsidian-style rendering built
  from the Lezer syntax tree. Lines that touch the selection show raw Markdown; everywhere
  else heading/emphasis/code/link/quote markers are hidden, bullets become `•`, task markers
  become clickable checkboxes, images render inline, fenced code gets a block background with
  a language label, `---` becomes a rule. Pure decoration builder with vitest coverage.
- **Formatting commands** (`cm/commands.ts`): bold, italic, strikethrough, inline code, heading
  cycle, bullet/ordered/task list, quote, link — on Ctrl+B/I/E/K, Ctrl+Shift+X and the mobile
  toolbar. Tested.
- **`notebook://` protocol** (Rust): serves images from inside a registered notebook to the
  webview with path validation and a content-type allow-list; relative image paths in notes
  resolve against the note's folder.
- **Android layout**: single pane with app bar, notes drawer (sheet) with notebook switcher,
  44 px tree rows with a per-row actions button that opens a bottom sheet (new note/folder,
  rename, move, delete), formatting toolbar pinned above the keyboard, image attach via the
  system picker. Folder picker hidden on Android (SAF cannot back a git repo).
- **Android chrome**: `MainActivity` pads the content root with system-bar, cutout and IME
  insets (so the WebView never sits under the status bar or the keyboard) and sets light/dark
  status-bar icons from the system theme.
- **Android back button** closes the drawer, sheets and dialogs (one per press) via WebView
  history entries instead of quitting the app; with nothing open it exits as usual.

### Decisions

- Tree dialogs are driven by a small shared store so the sidebar, drawer and shortcuts can
  open them; the mobile action sheet reuses the same dialogs.
- On Android the in-app theme and the native status-bar icon colour both follow the system by
  default; forcing light/dark in-app does not yet recolour the native bars.

## Phase 1 — local notes, checkpoint 1 (2026-10-02)

### Added

- **Notebooks (Rust `notebook/`)**: registry of known notebooks (`notebooks.json` in the app
  config dir), create / open / forget, file tree (hidden files and `.gitignore` matches
  excluded), atomic read/write, create / rename / move / delete for files and folders,
  `assets/` storage for pasted or dropped images, and a debounced `notify` watcher that emits
  `NotebookChanged` events. Every notebook-relative path goes through one validator that
  rejects `..`, absolute paths and NUL bytes. 30 unit tests.
- **Settings** (`settings.json`): theme (system / light / dark), editor font (sans / serif / mono),
  text size, sidebar width, last notebook. Lenient loader so old files never break startup.
- **Design tokens**: `--gn-*` CSS variables for surfaces, text, one accent, lines, radius and
  type scale, mapped onto Tailwind utilities and the shadcn/ui variable names. Light/dark via
  `<html data-theme>`, bundled fonts (Inter, Source Serif 4, JetBrains Mono) via `@fontsource`.
- **shadcn/ui 4 (radix-nova)** primitives in `src/ui`: button, dialog, alert-dialog,
  dropdown-menu, context-menu, tooltip, input, scroll-area, separator, sheet.
- **Desktop shell**: custom title bar (drag region, window controls, appearance menu),
  resizable sidebar with notebook switcher and file tree (context menu: new note / folder,
  rename, move to…, delete with confirmation), tabs with dirty indicator, status bar with
  save state and word count. Window size/position restored by `tauri-plugin-window-state`.
- **Editor**: CodeMirror 6 with GFM Markdown, typographic highlighting, autosave 800 ms after
  the last edit (also on Ctrl+S, tab close, window hide), per-tab undo history, external
  change detection (clean tabs reload, dirty tabs get a banner), image paste and drop.
- **Welcome screen** with create / open folder / recent notebooks; empty, loading and error
  states on every screen.
- **Tests**: vitest for path, debounce and word-count helpers; `pnpm test` runs in CI.

### Decisions

- Pasted image bytes cross IPC as `number[]` (tauri-specta cannot type raw `ipc::Request`
  bodies). Fine for screenshots; dropped files are copied by Rust without crossing IPC.
- Moving entries uses a "Move to…" dialog rather than HTML5 drag-and-drop, which is unreliable
  inside Tauri webviews while OS file drops are enabled.
- Official Tauri plugins added: `dialog` (folder picker) and `window-state` (desktop only).
- Dependencies pulled in by shadcn/ui 4: `cn`, `radix-ui`, `class-variance-authority`,
  `shadcn` (runtime CSS), `tw-animate-css`. `clsx`/`tailwind-merge` were replaced by `cn`.

### Left for checkpoint 2

- Obsidian-style live preview decorations, syntax highlight polish inside fenced blocks.
- Android single-pane layout (drawer, formatting toolbar above the keyboard, bottom sheets).
- Screenshots and self-review on both platforms.

## Phase 0 — scaffold & toolchains (2026-10-02)

### Added

- Tauri 2.12 + React 19 + TypeScript 6 + Vite 8 + Tailwind CSS v4 scaffold; one codebase for
  Linux, Windows and Android.
- Rust crate layout per the brief: `commands/`, `notebook/`, `git/`, `sync/`, `secrets/`,
  `error.rs`, plus `device.rs` (device name used in commit messages and conflict file names).
- `AppError` (serializable, `kind`-tagged) and `SyncState` enum contracts with unit tests.
- `git2` with `vendored-libgit2` + `vendored-openssl` wired in from day one, with a test
  asserting HTTPS and SSH transports are compiled in; the diagnostics screen shows the
  libgit2 version so the Android build is verified end to end.
- tauri-specta (2.0.0-rc.25) bindings: `src/lib/bindings.ts` is regenerated on every
  `tauri dev` and `cargo test` fails when it is stale.
- Placeholder UI with design-token groundwork (CSS variables via Tailwind `@theme`,
  light/dark via `prefers-color-scheme`, reduced-motion, safe-area padding), zustand store.
- Tooling: ESLint 10 (type-checked), Prettier 3 + Tailwind plugin, rustfmt, clippy lints in
  `Cargo.toml`, `.editorconfig`, VS Code recommendations.
- GitHub Actions: lint/typecheck/test job, desktop build matrix (Ubuntu, Windows) and Android
  APK build, all uploading artifacts.
- `docs/dev-setup.md` covering Linux, Windows and Android toolchains (fish-friendly).
- Generated Android project (`src-tauri/gen/android`, committed) targeting compileSdk 37,
  minSdk 26, Gradle 9.6.1 / AGP 9.3.1.

### Decisions

- Placeholder name `git-notes`, identifier `com.example.gitnotes`.
- TypeScript pinned to 6.x: TypeScript 7 is out but typescript-eslint only supports `< 6.1`.
- Window decorations are left native in Phase 0; the custom title bar lands with the UI in Phase 1.
- shadcn/ui init deferred to Phase 1 so it is set up together with our own tokens rather than
  the default theme.
- On Linux the app disables WebKitGTK's DMA-BUF renderer when the NVIDIA kernel module is
  loaded (crashes under Wayland otherwise); an explicit `WEBKIT_DISABLE_DMABUF_RENDERER` wins.
- Android app module compiles with Java 17 (the template's Java 8 target is deprecated under JDK 21
  and only produced warnings).
- Added tooling-only dev dependencies not named in the brief: `@types/node`, `@eslint/js`,
  `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`,
  `eslint-config-prettier`, `globals`, `prettier-plugin-tailwindcss`.
