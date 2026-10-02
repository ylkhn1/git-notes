//! Device identity helpers (used in commit messages and conflict file names).

/// Best-effort human-readable device name.
///
/// The user can override this in settings; this is only the default.
pub fn device_name() -> String {
    platform_device_name()
        .map(|name| sanitize(&name))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| format!("{}-device", std::env::consts::OS))
}

#[cfg(target_os = "android")]
fn platform_device_name() -> Option<String> {
    // Android exposes the model via `android.os.Build`; wiring that through JNI is deferred
    // to the sync phase. `ro.product.model` is readable without permissions on most devices.
    std::process::Command::new("getprop")
        .arg("ro.product.model")
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[cfg(target_os = "windows")]
fn platform_device_name() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}

#[cfg(not(any(target_os = "android", target_os = "windows")))]
fn platform_device_name() -> Option<String> {
    std::fs::read_to_string("/etc/hostname")
        .or_else(|_| std::fs::read_to_string("/proc/sys/kernel/hostname"))
        .ok()
        .map(|name| name.trim().to_owned())
}

/// Keeps only characters that are safe in file names across all target platforms.
pub fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_unsafe_characters() {
        assert_eq!(sanitize("Pixel 8 Pro"), "Pixel-8-Pro");
        assert_eq!(sanitize("my/host:name"), "my-host-name");
        assert_eq!(sanitize("--edge--"), "edge");
    }

    #[test]
    fn device_name_is_never_empty() {
        assert!(!device_name().is_empty());
    }
}
