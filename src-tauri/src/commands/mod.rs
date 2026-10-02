//! Thin `#[tauri::command]` layer. No business logic here — delegate to the domain modules.

mod app;
mod notebook;
mod settings;

pub use app::*;
pub use notebook::*;
pub use settings::*;
