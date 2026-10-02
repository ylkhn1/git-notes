//! Thin `#[tauri::command]` layer. No business logic here — delegate to the domain modules.

mod app;
mod git;
mod notebook;
mod secrets;
mod settings;

pub use app::*;
pub use git::*;
pub use notebook::*;
pub use secrets::*;
pub use settings::*;
