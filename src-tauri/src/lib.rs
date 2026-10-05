//! git-notes core: Tauri entry point, command registration and typed bindings export.
//!
//! Business logic lives in the domain modules ([`notebook`], [`git`], [`sync`], [`secrets`]);
//! the [`commands`] module is a thin `#[tauri::command]` layer over them.

#[cfg(target_os = "android")]
mod android_log;
pub mod commands;
pub mod device;
pub mod error;
pub mod git;
pub mod notebook;
pub mod secrets;
pub mod settings;
pub mod state;
pub mod sync;

use tauri::Manager;
use tauri_specta::{Builder, collect_commands, collect_events};

/// Builds the tauri-specta registry of all commands and events exposed to the frontend.
///
/// Kept separate from [`run`] so tests and the bindings export can use it without a Tauri app.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::get_app_info,
            commands::get_settings,
            commands::update_settings,
            commands::list_notebooks,
            commands::default_notebooks_dir,
            commands::create_notebook,
            commands::open_notebook,
            commands::forget_notebook,
            commands::list_tree,
            commands::read_file,
            commands::write_file,
            commands::create_file,
            commands::create_dir,
            commands::rename_entry,
            commands::delete_entry,
            commands::save_asset,
            commands::import_asset,
            commands::watch_notebook,
            commands::unwatch_notebook,
            commands::get_repo_status,
            commands::init_repo,
            commands::set_remote_url,
            commands::clone_notebook,
            commands::sync_now,
            commands::request_sync,
            commands::get_sync_state,
            commands::get_sync_plan,
            commands::list_conflicts,
            commands::get_conflict_diff,
            commands::resolve_conflict,
            commands::list_history,
            commands::list_commit_files,
            commands::get_file_diff,
            commands::get_credentials,
            commands::generate_ssh_key,
            commands::delete_ssh_key,
            commands::save_https_token,
            commands::delete_https_token,
            commands::forget_host_key,
        ])
        .events(collect_events![
            commands::NotebookChanged,
            commands::SyncStateChanged,
            commands::SyncPlanChanged,
            commands::CloneProgressEvent
        ])
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
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false);
    #[cfg(target_os = "android")]
    let _ = builder
        .with_ansi(false)
        .without_time()
        .with_writer(android_log::Logcat)
        .try_init();
    #[cfg(not(target_os = "android"))]
    let _ = builder.try_init();
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

    let tauri_builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());
    #[cfg(desktop)]
    let tauri_builder = tauri_builder.plugin(tauri_plugin_window_state::Builder::default().build());

    tauri_builder
        .register_uri_scheme_protocol("notebook", |ctx, request| {
            serve_notebook_file(ctx.app_handle(), request.uri().path())
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            app.manage(state::AppState::init(app.handle())?);
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

/// Handler for `notebook://localhost/<id>/<path>`: serves images from inside a registered
/// notebook so the editor can render them. Everything else is a 404.
fn serve_notebook_file<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    url_path: &str,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{Response, StatusCode, header};

    let respond = |status: StatusCode, body: Vec<u8>, mime: &str| {
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "private, max-age=60")
            .body(body)
            .unwrap_or_else(|_| Response::new(Vec::new()))
    };

    let result = (|| -> error::AppResult<(Vec<u8>, &'static str)> {
        let (id, rel) = notebook::protocol::parse_request_path(url_path)?;
        let root = {
            let state = app.state::<state::AppState>();
            let registry = state::lock(&state.registry)?;
            registry.root(&id)?
        };
        let abs = notebook::paths::resolve(&root, &rel)?;
        let mime = notebook::protocol::content_type(&abs)
            .ok_or_else(|| error::AppError::invalid_input("unsupported file type"))?;
        let bytes = std::fs::read(&abs)
            .map_err(|_| error::AppError::not_found(format!("{rel} does not exist")))?;
        Ok((bytes, mime))
    })();

    match result {
        Ok((bytes, mime)) => respond(StatusCode::OK, bytes, mime),
        Err(error::AppError::NotFound { .. }) => {
            respond(StatusCode::NOT_FOUND, Vec::new(), "text/plain")
        }
        Err(error) => {
            tracing::debug!(%error, path = url_path, "notebook protocol request rejected");
            respond(StatusCode::BAD_REQUEST, Vec::new(), "text/plain")
        }
    }
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
