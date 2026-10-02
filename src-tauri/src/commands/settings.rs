use tauri::State;

use crate::error::AppResult;
use crate::settings::Settings;
use crate::state::{AppState, lock};

#[tauri::command]
#[specta::specta]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    Ok(lock(&state.settings)?.get().clone())
}

#[tauri::command]
#[specta::specta]
pub fn update_settings(state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    Ok(lock(&state.settings)?.update(settings)?.clone())
}
