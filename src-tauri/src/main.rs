// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    apply_linux_webkit_workarounds();
    git_notes_lib::run()
}

/// WebKitGTK's DMA-BUF renderer crashes with "Error 71 (Protocol error) dispatching to
/// Wayland display" on NVIDIA's proprietary driver. Disable it there unless the user
/// already decided (any explicit value of the variable wins).
#[cfg(target_os = "linux")]
#[allow(unsafe_code)]
fn apply_linux_webkit_workarounds() {
    const VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    let nvidia = std::path::Path::new("/sys/module/nvidia").exists();
    if nvidia && std::env::var_os(VAR).is_none() {
        // SAFETY: called first thing in `main`, before any other thread exists, so no
        // concurrent reads of the environment can race with this write.
        unsafe { std::env::set_var(VAR, "1") };
    }
}

#[cfg(not(target_os = "linux"))]
fn apply_linux_webkit_workarounds() {}
