//! git-notes core: Tauri entry point, command registration and typed bindings export.
//!
//! Business logic lives in the domain modules ([`notebook`], [`git`], [`sync`], [`secrets`]);
//! the [`commands`] module is a thin `#[tauri::command]` layer over them.

pub mod commands;
pub mod device;
pub mod error;
pub mod git;
pub mod notebook;
pub mod secrets;
pub mod sync;

use tauri_specta::{Builder, collect_commands};

/// Builds the tauri-specta registry of all commands and events exposed to the frontend.
///
/// Kept separate from [`run`] so tests and the bindings export can use it without a Tauri app.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![commands::get_app_info])
}

/// TypeScript export configuration shared by the dev-time export and the bindings test.
pub fn typescript_exporter() -> specta_typescript::Typescript {
    specta_typescript::Typescript::default().header(
        "// Regenerate with `GIT_NOTES_WRITE_BINDINGS=1 cargo test bindings` in src-tauri/.\n",
    )
}

/// Path of the generated bindings file, relative to `src-tauri/`.
pub const BINDINGS_PATH: &str = "../src/lib/bindings.ts";

fn init_tracing() {
    use tracing_subscriber::EnvFilter;

    let default_filter = if cfg!(debug_assertions) {
        "info,git_notes_lib=debug"
    } else {
        "info"
    };
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter));

    // `try_init` so a second call (e.g. from tests) does not panic.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let builder = specta_builder();

    // Regenerate `src/lib/bindings.ts` on every desktop debug start so the frontend
    // never drifts from the Rust command signatures.
    #[cfg(all(debug_assertions, desktop))]
    if let Err(error) = builder.export(typescript_exporter(), BINDINGS_PATH) {
        tracing::error!(%error, "failed to export TypeScript bindings");
    }

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            tracing::info!(
                version = %app.package_info().version,
                libgit2 = %git::libgit2_version(),
                "git-notes started"
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fails when `src/lib/bindings.ts` is out of date with the Rust commands.
    ///
    /// Run `GIT_NOTES_WRITE_BINDINGS=1 cargo test bindings` (or `pnpm tauri dev` once) to regenerate.
    #[test]
    fn bindings_are_up_to_date() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(BINDINGS_PATH);
        let builder = specta_builder();

        if std::env::var_os("GIT_NOTES_WRITE_BINDINGS").is_some() {
            builder
                .export(typescript_exporter(), &path)
                .expect("export bindings");
            return;
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let generated_path = dir.path().join("bindings.ts");
        builder
            .export(typescript_exporter(), &generated_path)
            .expect("export bindings");

        let generated = std::fs::read_to_string(&generated_path).expect("read generated");
        let committed = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(
            committed, generated,
            "src/lib/bindings.ts is stale; run `GIT_NOTES_WRITE_BINDINGS=1 cargo test bindings`"
        );
    }
}
