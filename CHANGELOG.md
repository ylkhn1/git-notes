# Changelog

All notable changes to this project are documented here. Phases follow the project brief.

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
- Android app module compiles with Java 17 (the template's Java 8 target is deprecated under JDK 21
  and only produced warnings).
- Added tooling-only dev dependencies not named in the brief: `@types/node`, `@eslint/js`,
  `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`,
  `eslint-config-prettier`, `globals`, `prettier-plugin-tailwindcss`.
