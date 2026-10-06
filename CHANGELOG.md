# Changelog

All notable changes to this project are documented here. Phases follow the project brief.

## Unreleased — tables in place, any keyboard layout

### Changed

- **Tables are edited in place**, like in Obsidian: the table stays drawn while you edit it
  (no more Markdown source with pipes and a `---` line), the clicked cell becomes editable,
  and "+" bars on the right and bottom edges add a column or a row. Tab / Shift+Tab / Enter
  and the arrow keys move between cells, Esc leaves the table; Ctrl+B, Ctrl+Z and the other
  editing shortcuts work inside a cell. A typed `|` is escaped, and an edited table's source
  is re-aligned when the cursor leaves it.

### Fixed

- **Shortcuts work with a non-Latin keyboard layout.** With the Russian layout on, Ctrl+B,
  Ctrl+Z, Ctrl+P, Ctrl+S and the rest did nothing, because they were matched by the typed
  letter; they now fall back to the physical key.

## 0.2.0 — history, search, tags, graph, attachments (2026-10-06)

### Added

- **Note history** follows renames, shows every version whole (rendered like the editor) next
  to its diff, and the notebook history has a _Deleted files_ tab listing everything deleted
  in past commits that is gone now.
- **Restore any version.** _Restore this version_ replaces the open note's text, so the
  change is autosaved and Ctrl+Z undoes it; closed files are overwritten after a
  confirmation; deleted files come back and open.
- **Changes inside the note.** Lines that differ from the last commit get a bar in the margin
  (added, modified, removed). _Show changes in note_ also shows the removed lines inline,
  struck through, each block with a _Revert_ button; it compares with the version before the
  last commit (auto-sync commits within 30 s), and _Compare in note_ in the history picks
  any other version.
- **Full-text search panel** in the sidebar (Ctrl+Shift+F): a note matches when it contains
  every word anywhere (title included), title matches rank first, results are grouped by
  note with every match highlighted, and the open note highlights the terms too. Queries
  understand `"exact phrase"`, `tag:name` / `#name` and `path:folder`.
- **Tags**: `#tag`, `#nested/tag` and frontmatter `tags:` (`[a, b]`, `a, b` or a list).
  Tags are drawn as pills (click lists the tag's notes), `#` completes known tags, and a
  _Tags_ panel shows the tag tree with note counts. Tags in code are ignored.
- **Graph of notes** (Ctrl+Shift+G or the button next to the sidebar tabs): notes and their
  wiki links in a force-directed layout, the whole notebook or the neighbourhood of the open
  note (depth 1–3), optional tag nodes, links to missing notes as hollow nodes. Drag nodes,
  pan, zoom with the wheel or a pinch, hover to highlight neighbours, click to open.
- **Attachments of any type** go to `assets/`: images are embedded, other files linked with
  a paperclip. _Attach file…_ in the editor menu, the command palette and the phone
  toolbar; pasting files works too. Clicking an image opens it full-size; clicking an
  attachment opens it in the system app (desktop); web and mail links open in the browser.
- **Drag and drop**: files from the file manager dropped on the note are attached at the
  drop point, dropped on the tree are copied into that folder. Notes and folders can be
  dragged onto another folder (links to them are updated) or onto the open note to insert a
  link.

### Changed

- The sidebar has _Files_, _Search_ and _Tags_ tabs (also in the phone drawer).
- Clicking an image or another non-note file in the tree opens it instead of failing to
  load it as text.
- New dependency: `tauri-plugin-opener` (called from Rust only, limited to files inside the
  notebook and http/https/mailto links).

### Known limitations

- On Android, attachments other than images cannot be opened yet (needs a FileProvider).

## 0.1.3 — tables (2026-10-05)

### Added

- **Tables in the editor.** A top-level GFM table away from the cursor is drawn as a grid
  (header, column alignment, bold/italic/strikethrough, code, links, wiki links and images in
  cells); clicking a cell moves the cursor into its source, which is shown in monospace so
  the pipes line up. Tables nested in quotes or lists stay plain text.
- **Cell navigation**: Tab / Shift+Tab select the next / previous cell, Enter the cell below;
  Tab after the last cell and Enter on the last row add a row, Enter on an empty last row
  leaves the table. Every move re-aligns the columns.
- **Table commands**: insert table, add row above/below, add column left/right, delete row,
  column or table, align column left/center/right, align columns. Desktop: right-click menu
  (a _Table_ submenu inside a table) and the command palette. Phone: an _Insert table_
  button; inside a table the toolbar starts with _Next cell_, _Add row below_ and a menu
  with the rest.
- `src/lib/markdown-table.ts`: the text model (split rows on unescaped pipes, parse
  alignment, format with padded columns, grid edits), unit-tested.

### Fixed

- Wiki links with a table-escaped pipe, `[[Note\|text]]`, now resolve (they were treated as
  links to `Note\`), and renames keep the backslash so the table stays intact.

## 0.1.2 — links between notes and editor menus (2026-10-05)

### Added

- **Wiki links** like Obsidian: `[[Note]]`, `[[folder/Note]]`, `[[Note#Heading]]`,
  `[[Note|shown text]]` (and `![[Note]]`). Live preview hides the brackets (and the target of
  an aliased link) away from the cursor; links to notes that do not exist yet are drawn
  dashed. Clicking a rendered link opens the note, Ctrl/⌘-click works on the line being
  edited too, and a link to a missing note creates it. `#Heading` jumps to that heading.
  Relative Markdown links to notes (`[text](Other.md)`) open the same way.
- **Note-name completion** after typing `[[`, with fuzzy matching; the inserted text is the
  shortest name that resolves unambiguously from the current note.
- **Backlinks**: a strip under the editor lists the notes that link to the open one, with the
  linking line; click to jump there. On phones it appears only when there are backlinks.
- **Links follow renames and moves**: renaming or moving a note or folder rewrites the
  `[[links]]` in other notes so they keep pointing at the same files (heading and alias are
  kept). Links inside code are never touched.
- **Selection menu on desktop**: selecting text shows a small floating toolbar (bold, italic,
  strikethrough, code, link to note, link, heading, quote).
- **Editor context menu on desktop**: right-click offers cut, copy, paste, select all, link to
  note, link and formatting (the webview's own menu is disabled in release builds). Paste
  uses the clipboard plugin's `allow-read-text` permission, granted on desktop only.
- Commands _Insert link to note_ and _Show links to this note_; a _Link to note_ button in the
  mobile formatting toolbar.
- Rust `notebook/links.rs` (`list_note_links`, `rewrite_note_links`): finds and rewrites link
  text, skipping fenced and inline code. Resolution of a target to a file lives only in
  `src/lib/wikilinks.ts` (same folder first, then notebook root, then by name; ties go to
  the same folder, then the shallowest path). Tests on both sides.

### Changed

- The search module's file walk is shared with the link scanner (`search::notes`).

## Phase 4 — polish, checkpoint 3 (2026-10-05)

### Added

- **Russian interface.** The UI is translated into Russian; the language follows the device
  (`navigator.languages`) and can be pinned in Settings → Appearance → Language or in the
  appearance menu (System / English / Русский), or with the palette commands _Language: …_.
  New `language` setting (`system` | `en` | `ru`). Relative times, durations, byte sizes and
  the CodeMirror search panel follow the language; `<html lang>` is updated so spell-checking
  matches.
- **i18n module** (`src/lib/i18n/`): no runtime dependency. Message catalogues live in
  `src/lib/i18n/messages/<namespace>.ts` with the English source next to its Russian
  translation; the `ru` object is typed against `en`, so a missing key is a compile error.
  `t("ns.key", { count, name })` interpolates `{name}` placeholders and picks CLDR plural forms
  through `Intl.PluralRules`; `useT()` re-renders a component on language change; `rich()`
  renders `<link>…</link>` markers as React nodes so sentences with inline links stay whole.
  `i18n.test.ts` checks every catalogue for key parity and matching placeholders.
- README: a step-by-step guide to syncing a notebook between devices over SSH or HTTPS.

### Changed

- Command groups are ids (`go`, `note`, …) with translated labels; `editorShortcuts` is a
  function so the shortcuts help follows the language. Palette keywords include Russian words.
- File names created by the app (`Untitled.md`, conflict copies, pasted images, shared notes)
  and git commit messages stay in English so they are identical on every device.

## Phase 4 — polish, checkpoint 2 (2026-10-05)

### Added

- **First-run flow** (`src/features/onboarding/`): on a device with no notebooks the app asks
  for the commit identity (name, email, device name — prefilled with the system defaults)
  and then offers the three ways to get a notebook (new, clone, open folder). It ends on its
  own when a notebook is open, or with _Skip for now_; existing installs with notebooks never
  see it (`onboardingComplete` setting).
- **Android share target**: `ACTION_SEND` with any `text/*` type (shared text or a text
  file) lands in the open notebook as a new note. The Kotlin side (`SharePlugin.kt`) keeps
  the payload until the Rust command `take_shared_content` collects it; the frontend polls on
  start-up and whenever the app returns to the foreground. `save_shared_note`
  (`notebook/shared.rs`) names the file after the share subject, else the first line (the host
  for a bare URL), else a timestamp, sanitises it for every platform and numbers duplicates;
  a subject becomes a level-1 heading. While no notebook is open the text waits with a
  notice on the notebook list.
- **Periodic sync**: while a notebook is open the scheduler also syncs every N minutes
  (`periodicSyncMins`, default 15, _Off_/5/15/30/60 in Settings → Sync) so changes made on
  another device arrive without a local edit or a focus change. The timer restarts after
  every run, pauses while offline (the retry backoff takes over) and keeps going after an
  error so a repaired server is picked up. New `SyncTrigger::Periodic`; integration test
  `periodic_sync_pulls_remote_changes_without_a_trigger`.
- **In-app updates on desktop** (`tauri-plugin-updater` + `tauri-plugin-process`,
  `src/features/updates/`): checks GitHub Releases 15 s after start-up and every 6 hours
  (switch in Settings → About, off in dev builds), _Check now_ / _Check for updates…_
  command, a banner with _What’s new_ (release notes), _Install_ and _Later_, download
  progress, and _Restart now_ after installing (open notes are saved first). Install errors
  show the message and the releases URL.
- **Release pipeline** (`.github/workflows/release.yml`): a `v*` tag builds Linux
  (Ubuntu 22.04) and Windows bundles with `tauri-action`, signs them with the updater key
  from CI secrets, creates a draft release with `latest.json`, and attaches a release APK
  (signed when the keystore secrets exist). `scripts/bump-version.mjs` sets the version in
  `package.json`, `Cargo.toml` and `Cargo.lock`. Documented in `docs/release.md`.
- Tests: config-dir migration, shared-note naming (7 cases), settings defaults/clamping for
  the new fields, scheduler plan with a periodic timer, byte formatting.

### Changed

- **Bundle identifier is now `com.ylkhn.gitnotes`** (was the placeholder
  `com.example.gitnotes`). Config dir, keyring service name and Android package follow. On
  desktop the first start copies `settings.json`, `notebooks.json`, `credentials.json` and
  `known_hosts.json` from the old config dir when the new one is empty (`migrate.rs`) and
  moves the SSH key and tokens to the new keyring service when the store is first opened
  (`keyring_store::migrate_legacy`); the old files stay. Android is a fresh install.
- Android Gradle project: sources moved to `com/ylkhn/gitnotes`, the share intent filter, and
  a release signing config read from a git-ignored `keystore.properties`.
- The sync menu says “…, on focus and every 15 min”; the status bar no longer re-renders every
  second just because a periodic timer is pending.

### Decisions

- Shared text goes to the notebook root (same as _New note_), not a dedicated inbox folder.
- The updater key pair lives outside the repository (`~/.tauri/git-notes-updater.key`) and in
  CI secrets; only the public key is in `tauri.conf.json`. Updater artifacts are enabled only
  through `src-tauri/tauri.release.conf.json`, so local and CI builds need no key.
- Releases are created as drafts: `releases/latest/download/latest.json` only resolves once a
  release is published, so publishing is the moment installed apps start updating.
- `rust-version` stays 1.85, which pins `tauri-plugin-updater` to 2.12 (2.13 needs 1.90);
  the JS package is pinned to the same minor.

## Phase 4 — polish, checkpoint 1 (2026-10-05)

### Added

- **Command registry** (`src/features/commands/registry.ts`): every user-facing action in one
  typed list with title, group, icon, keywords, availability and an optional shortcut. The
  palette lists it, one global key handler dispatches it and the shortcuts help renders it.
  Dynamic entries (switch to another notebook) are built on demand. Shortcuts are written as
  `Mod+Shift+S` and shown as `Ctrl+…` or `⇧⌘…` depending on the platform.
- **Command palette (Ctrl+K), quick switcher (Ctrl+P) and full-text search (Ctrl+Shift+F)**
  in one overlay (`CommandPalette.tsx`) with three tabs (Tab cycles them). Commands and notes
  are ranked by a small fuzzy matcher (`src/lib/fuzzy.ts`: substrings first, then
  subsequences with word-start and run bonuses; matched characters are highlighted); the quick
  switcher puts recently opened notes first (per device, in `localStorage`). Search runs in
  Rust (`notebook/search.rs`: case-insensitive, Unicode-folded, every term must occur on the
  line, at most 20 lines per file and 200 in total, long lines windowed around the match) and
  opening a hit jumps the editor to that line. On Android the palette is a full-screen sheet
  opened from the search button in the app bar.
- **Settings dialog (Ctrl+,)** with sections Appearance (theme, editor font, text size),
  Sync & identity (automatic sync, delay, author, device name), Credentials (the existing
  credentials UI, now shared) and About (version, platform, libgit2). Reachable from the
  appearance menu, the notebook menu, the sync menu and the palette. The per-notebook dialog
  shrank to “Remote & git setup” and links to Settings for identity.
- **Keyboard shortcuts help (Ctrl+/)**: generated from the registry plus the editor keymap.
- New shortcuts: `F2` rename note, `Ctrl+Shift+=` / `Ctrl+-` text size, `Ctrl+,` settings,
  `Ctrl+/` shortcuts; `Ctrl+N`, `Ctrl+W`, `Ctrl+S`, `Ctrl+Shift+S` moved from the desktop
  shell into the registry.
- Global dialogs (new notebook, clone, remote, credentials, history, conflicts, settings,
  shortcuts, palette) are owned by one UI store and mounted once at the app root, so any
  command or button can open them.
- Tests: Rust search (case folding incl. Cyrillic, multi-term, per-file and total caps,
  windowing); vitest for the fuzzy matcher and shortcut parsing/matching/formatting.

### Decisions

- No `cmdk`: the palette is a Radix dialog plus the in-house matcher, so no new dependency
  and full control over the mobile layout. Full-text search scans files instead of keeping
  an index; `tantivy` can be added later if notebooks grow beyond what a scan handles.
- Recent-notes order is a per-device convenience kept in `localStorage`, not in settings.
- Identity and auto-sync moved out of the per-notebook remote dialog into Settings; they
  were global settings presented as if they were per notebook.

### Left for checkpoint 2

- Onboarding flow, Android share intent, desktop auto-updater with GitHub Releases, periodic
  background pull, and the final bundle identifier (currently the `com.example.gitnotes`
  placeholder).

## Phase 3 — auto-sync & conflicts (2026-10-02)

### Added

- **Auto-sync scheduler** (`src-tauri/src/sync/scheduler.rs`, plain Rust + tokio): every
  change the notebook watcher reports (editor autosave, tree operations, pasted images,
  external edits) arms a debounce — 30 s by default, configurable 5–3600 s — and the UI shows
  `Pending` with a live countdown. The app also syncs when it opens a notebook, when the
  window regains focus and when the Android activity resumes (throttled to once per 15 s).
  A debounced sync that finds nothing local to commit or push (for example the previous
  sync's own checkout) is skipped without touching the network. The engine's single-flight
  guarantee still holds for every trigger, and a running sync now releases its slot even if
  the task driving it is dropped.
- **Offline queue**: the queue is git itself (changes are committed locally on every
  attempt); the scheduler retries pushing with backoff — 30 s, 1, 2, 5, 10, then every 15
  minutes — and the status menu says “Offline · 2 commits waiting to push · Retrying in
  2 min”. An edit, a focus or Sync now retries immediately. Non-network errors (auth, a push
  rejected three times) are not retried on a timer; the message stays until the user acts.
- **Conflict copies** (`src-tauri/src/sync/conflicts.rs`): the notebook is scanned for
  `note (conflict <device> <YYYY-MM-DD HHmm>).md` files, so copies made on another device are
  found too, and the conflict state survives a restart. New commands list them, compare a
  copy with the current file and resolve: _Keep current_ (delete the copy), _Use copy_
  (replace the current note with the copy) or _Keep both_ (rename the copy to
  `note (<device> <stamp>).md`). Every copy is committed before the UI sees it, so each
  resolution is recoverable from history, and the resolution itself syncs like any edit.
- **Conflict UI**: a banner above the editor (desktop) or under the app bar (Android) counts
  the copies and opens the Conflicts dialog: list on the left, whole-file side-by-side
  comparison on the right (removed lines red, added lines green, long unchanged runs folded
  behind “⋯ N unchanged lines”), actions Keep current / Use copy / Keep both / Open in editor.
  On phones the dialog is two steps and the comparison stacks removed and added lines
  instead of showing two columns. The dialog is also reachable from the sync menu, and the
  banner can be dismissed for the session.
- **Sync settings** gained an Automatic sync switch and the debounce delay (seconds); the sync
  menu shows the auto-sync mode and when the last sync finished.
- **Diffs** are produced by one shared routine (`git::history::text_diff`, used by the
  history view and the conflict comparison); hunks now carry their old/new line coordinates so
  whole-file alignment is exact.
- **Tests**: 72 unit tests (+ scheduler plan/backoff, conflict name parsing round-trip,
  conflict list/diff/resolve, buffer diff line numbers) and 5 new integration tests
  (`tests/auto_sync.rs`) driving the scheduler against local bare remotes: edits debounce into
  one sync and a focus pulls them on the second device, offline edits are queued and retried
  with growing backoff then pushed when the remote returns, disabling auto-sync drops plans
  but keeps manual sync, cancel stops a planned sync, and a conflict surfaces on both devices
  and is resolved end to end. Frontend: side-by-side alignment/folding and the new status
  labels (47 vitest cases in total).

### Decisions

- Change detection for auto-sync lives in Rust (the existing `notify` watcher), not in the
  editor: anything that changes files on disk triggers a sync, and the frontend has no timer
  to keep in step with the backend.
- Focus/resume syncs are throttled (15 s) and debounced syncs skip when there is nothing
  local to send, so alt-tabbing or a pull's own checkout never causes a network round trip.
- Conflict detection is by file name rather than by remembering the last sync report; this is
  what makes copies from other devices and restarts work, at the cost of treating any file a
  user names `x (conflict dev 2026-01-01 1200).md` as a conflict copy.
- `Keep both` renames the copy to `note (<device> <stamp>).md` instead of leaving it as is,
  because a copy that still matches the pattern would come back in the banner on every scan.
- The side-by-side view is a two-column table on desktop and a stacked (unified) view on
  phones, where two columns of prose would be unreadable at 360 px.
- No new crates: the scheduler uses the `tokio` runtime Tauri already ships; the Switch
  primitive is shadcn/ui's.

### Left for later

- Periodic background pull while the app stays focused (today other devices' changes arrive
  on focus/resume, on the next edit or on Sync now).
- Resolving conflicts line by line inside the comparison (today: pick a version, or open both
  in the editor and merge by hand).
- Sync status is per session: the last result is not persisted across restarts (the conflict
  banner does come back, since it is derived from the files).

## Phase 2 — git (2026-10-02)

### Added

- **Git core** (`src-tauri/src/git/`, pure Rust, no Tauri): `init` on branch `main`, `clone`
  with progress, `fetch`/`push` with upstream resolution (configured tracking branch → same
  name → remote default), stage-all + commit with the author from settings and messages like
  `sync: 3 files from laptop`, repository status (branch, dirty/ahead/behind, last commit,
  interrupted state), per-file log, changed-files list and unified diff for the history view.
- **Sync algorithm** (`src-tauri/src/sync/run.rs`) exactly as specified: stage all → commit if
  dirty → fetch → fast-forward when possible, otherwise rebase local commits onto upstream; if
  the rebase conflicts, abort and merge instead, re-running the textual 3-way merge per file
  and keeping both versions of anything still conflicting (`note.md` = theirs,
  `note (conflict <device> <YYYY-MM-DD HHmm>).md` = ours; binary files and edit-vs-delete
  follow the same rule) → push, refetching and retrying up to three times when the push is
  rejected. Handles an empty remote, no upstream branch, an unborn local branch against a
  populated remote, unrelated histories, detached HEAD (re-attached to `main` or a
  `recovered-…` branch) and interrupted merges/rebases from a crash. Network failures become
  `Offline` with the local commit kept; everything else `Error(msg)`.
- **Sync engine**: per-notebook state (`Idle | Pending | Syncing | UpToDate | Offline |
Conflict(files) | Error(msg)`), single-flight execution on a blocking thread, state pushed
  to the UI as `SyncStateChanged` events.
- **Credentials**: in-app ed25519 key (generated with `ssh-key`, public key + fingerprint
  shown with a copy button) and per-host HTTPS tokens. Secrets live only in the OS store via
  the keyring ecosystem — Secret Service (KWallet/GNOME Keyring) on Linux, Credential Manager
  on Windows, Keystore-backed `android-native-keyring-store` on Android; `credentials.json`
  holds reference ids only. SSH host keys are trusted on first use and remembered in the
  app's own `known_hosts.json`; a changed key is refused with an actionable message.
- **libgit2 isolation**: global/system/XDG git config search paths point at an empty folder,
  so the user's `insteadOf` rewrites and credential helpers never apply. The vendored OpenSSL
  gets its trusted roots explicitly: a CA bundle file on Linux, and on Android the system
  certificates fed from memory via `GIT_OPT_ADD_SSL_X509_CERT` (OpenSSL is built without
  stdio there, so no file-based bundle can work).
- **UI**: sync indicator in the desktop status bar and the Android app bar with a menu (Sync
  now / Ctrl+Shift+S, Remote & author, Credentials, History); Sync settings dialog (remote
  URL with credential hints, author name/email, device name, Initialize git for plain
  folders); Credentials dialog (key generate/copy/regenerate/delete, tokens, known hosts,
  store status); Clone dialog with progress on Welcome and in the notebook menus; History
  dialog with commit list, changed files and a unified diff (two columns on desktop, two steps
  on mobile). New notebooks are git repositories from the start.
- **Tests**: 63 unit tests plus 10 integration tests driving two clones through a local bare
  remote (clean merges across files and within one file, conflict copies, delete-vs-edit both
  ways, empty remote, offline → online, local-only, detached HEAD, interrupted merge,
  unrelated histories, engine single-flight). Manual network tests (`cargo test --test network
-- --ignored`) clone a public GitHub repo over HTTPS and round-trip a secret through the real
  OS keyring.
- Android: `tracing` output now reaches logcat (tag `git-notes`).

### Decisions

- `android-native-keyring-store` (the keyring project's own Android store) is used instead
  of a hand-written Keystore plugin; it is part of the keyring ecosystem the brief names,
  so no separate Kotlin plugin is maintained.
- `libgit2-sys` and `openssl-sys` (already in the dependency tree through `git2`) are
  referenced directly on Android to add certificates from memory; no new crates.
- `tauri-plugin-clipboard-manager` (official Tauri plugin) backs the "Copy public key" button
  because the WebView clipboard API is unreliable on Linux and Android.
- Author name/email default to the device name and `<device>@git-notes.local` so the first
  sync never fails on identity; both are editable in Sync settings.
- HTTPS remotes without a saved token are allowed to clone anonymously (public repos); a
  push then fails with a message pointing at Credentials.
- A merge commit that merely carries a change over is hidden from a file's history (its blob
  equals one parent's); only real changes and conflict resolutions appear.

### Left for later

- Auto-sync (debounce, on focus/resume), offline queue with backoff and the conflict banner
  with side-by-side resolution: done in Phase 3.
- Sync status is per session: the last result is not persisted across restarts.

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
