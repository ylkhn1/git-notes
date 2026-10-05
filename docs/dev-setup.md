# Developer setup

Targets: **Linux (primary)**, **Android**, **Windows**. Everything below is written for
[fish](https://fishshell.com); where a command only works in POSIX shells it is wrapped in `bash -c`.

## 1. Common toolchain (all platforms)

| Tool      | Version                       | Notes                                                                    |
| --------- | ----------------------------- | ------------------------------------------------------------------------ |
| Rust      | stable (≥ 1.85, edition 2024) | via `rustup`, **not** the distro package                                 |
| Node.js   | ≥ 22                          |                                                                          |
| pnpm      | 12.x                          | pinned in `package.json` → `packageManager`                              |
| Tauri CLI | 2.x                           | installed as a dev dependency (`pnpm tauri …`), no global install needed |

```fish
# Rust (user-local, no sudo). --no-modify-path keeps your fish config untouched.
curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile default --no-modify-path
fish_add_path ~/.cargo/bin

# pnpm without sudo (global npm prefix is usually root-owned)
npm install -g pnpm@latest --prefix ~/.local
fish_add_path ~/.local/bin

# Project dependencies
pnpm install
```

## 2. Linux (Arch / CachyOS)

Tauri needs WebKitGTK and a few GTK libraries. These require `sudo`:

```fish
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libayatana-appindicator librsvg xdotool patchelf
```

Debian / Ubuntu equivalent (also what CI uses):

```fish
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libssl-dev libxdo-dev patchelf build-essential curl wget file
```

Run the desktop app:

```fish
pnpm tauri dev
```

## 3. Android

### 3.1 JDK 21

Gradle (9.x) and the Android Gradle Plugin in the generated project are tested against
JDK 17–21. A newer system JDK (e.g. 27) is **not** supported by Gradle — install 21 alongside.

Option A — distro package:

```fish
sudo pacman -S --needed jdk21-openjdk
set -Ux JAVA_HOME /usr/lib/jvm/java-21-openjdk
```

Option B — user-local Temurin tarball (no sudo):

```fish
curl -fsSL -o /tmp/jdk21.tar.gz \
  "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
mkdir -p ~/.local/share && tar -xzf /tmp/jdk21.tar.gz -C ~/.local/share
mv ~/.local/share/jdk-21* ~/.local/share/jdk-21
set -Ux JAVA_HOME ~/.local/share/jdk-21
```

### 3.2 Android SDK + NDK (command-line tools, no Android Studio)

```fish
set -Ux ANDROID_HOME ~/Android/Sdk
mkdir -p $ANDROID_HOME/cmdline-tools

# Latest "Command line tools only" zip: https://developer.android.com/studio#command-line-tools-only
curl -fsSL -o /tmp/cmdline-tools.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip
cd /tmp; and unzip -q cmdline-tools.zip; and mv cmdline-tools $ANDROID_HOME/cmdline-tools/latest; and cd -

fish_add_path $ANDROID_HOME/cmdline-tools/latest/bin $ANDROID_HOME/platform-tools $ANDROID_HOME/emulator

# Accept licenses, then install what the Tauri template needs (compileSdk 37).
bash -c 'yes | sdkmanager --licenses >/dev/null'
sdkmanager "platform-tools" "platforms;android-37.0" "build-tools;37.0.0" "ndk;29.0.14206865"

set -Ux NDK_HOME $ANDROID_HOME/ndk/29.0.14206865
set -Ux ANDROID_NDK_HOME $NDK_HOME   # used by the vendored OpenSSL build
# `llvm-ar` / `llvm-ranlib` for the vendored C builds (skip if a system LLVM is installed)
fish_add_path $NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin
```

Rust targets for Android:

```fish
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

### 3.3 Device or emulator

**Physical device:** enable USB debugging, plug in, confirm with `adb devices`.

**Emulator** (needs `/dev/kvm` access — `ls -l /dev/kvm` should be readable by your user):

```fish
sdkmanager "emulator" "system-images;android-36;google_apis;x86_64"
avdmanager create avd -n pixel8 -k "system-images;android-36;google_apis;x86_64" -d pixel_8
emulator -avd pixel8 &
```

### 3.4 Run

```fish
pnpm tauri android dev            # picks a connected device / running emulator
pnpm tauri android build --apk    # release APK (unsigned until signing is configured)
```

The generated Gradle project lives in `src-tauri/gen/android/` and **is committed**
(Tauri recommends this). Build outputs inside it are git-ignored.

### 3.5 Where notebooks live on Android

libgit2 cannot operate through the Storage Access Framework, so notebook repositories are
stored in the app's private data directory (`/data/data/com.ylkhn.gitnotes/files/…`).
The Rust side resolves the path via Tauri's `app_data_dir()`.

The app is also a **share target**: `ACTION_SEND` intents with a `text/*` type (text or a text
file) are received by `SharePlugin.kt` in the generated project, fetched by the Rust side
(`src-tauri/src/share.rs`, `take_shared_content`) and saved into the open notebook as a new note
(`save_shared_note`, naming rules in `notebook/shared.rs`). Try it from a shell:

```fish
adb shell am start -a android.intent.action.SEND -t text/plain \
  --es android.intent.extra.SUBJECT "Reading list" --es android.intent.extra.TEXT "https://example.com" \
  com.ylkhn.gitnotes/.MainActivity
```

### 3.6 Secrets on Android

The SSH private key and HTTPS tokens are stored through the keyring ecosystem's Android
store (`android-native-keyring-store`): values are encrypted with an AES key that lives in
the Android Keystore and written to the app's private `SharedPreferences`. Nothing else is
needed at build time; `tao` initialises the JNI context the store relies on.

## 4. Windows

1. **Visual Studio Build Tools** with the _Desktop development with C++_ workload
   (MSVC, Windows 10/11 SDK).
2. **WebView2** runtime — preinstalled on Windows 10 (1803+) and 11.
3. **Rust** via rustup (`x86_64-pc-windows-msvc` default host).
4. **Perl** (Strawberry Perl) — required to compile the vendored OpenSSL.
5. Node ≥ 22, pnpm 12.

```powershell
winget install --id Rustlang.Rustup StrawberryPerl.StrawberryPerl OpenJS.NodeJS.LTS
npm install -g pnpm@latest
pnpm install
pnpm tauri dev
```

CI builds Windows installers (NSIS `.exe`, WiX `.msi`) on `windows-latest`.

## 4a. Sync, credentials and where things live

| Platform | Secret store                                      | Config files (references only)                     |
| -------- | ------------------------------------------------- | -------------------------------------------------- |
| Linux    | Secret Service via D-Bus (KWallet, GNOME Keyring) | `~/.config/com.ylkhn.gitnotes/`                    |
| Windows  | Credential Manager                                | `%APPDATA%\\com.ylkhn.gitnotes\\`                  |
| Android  | Keystore-encrypted SharedPreferences              | app data root (`/data/user/0/com.ylkhn.gitnotes/`) |

`credentials.json` holds the SSH public key, fingerprint and token _ids_; the private key and
the tokens themselves are only in the secret store under service `com.ylkhn.gitnotes`.
Builds before Phase 4 used the placeholder identifier `com.example.gitnotes`; on its first
start the app copies the JSON files from that config directory if the new one is empty
(`src-tauri/src/migrate.rs`) and moves the keyring entries to the new service name when the
store is first opened. The old directory is left in place. Android cannot migrate (a new
package is a new sandbox): clone the notebooks again.
`known_hosts.json` is the app's own trust-on-first-use list of SSH host keys (the user's
`~/.ssh/known_hosts` and `~/.gitconfig` are deliberately ignored — see `git::configure`).

On a headless Linux box without a Secret Service provider the Credentials screen reports the
store as unavailable; sync over SSH/HTTPS then needs one installed (`kwallet` or
`gnome-keyring`) and an unlocked session.

### How sync is triggered

| Trigger                      | What happens                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Files change (watcher)       | `Pending`; a sync starts `autoSyncDelaySecs` (default 30) after the last change                |
| Notebook opened, app focused | A background sync, at most once per 15 s                                                       |
| Every N minutes              | A sync even without local changes, to pull other devices' work (`periodicSyncMins`, 15; 0 off) |
| Sync now / Ctrl+Shift+S      | Immediate sync; the report is shown in the status menu                                         |
| Offline result               | Local commit kept; retry after 30 s, 1, 2, 5, 10 min, then every 15 min (shown as a countdown) |
| Error result (auth, …)       | No timer; the next edit, focus or Sync now tries again                                         |

All of this lives in `src-tauri/src/sync/scheduler.rs` and is exercised by
`cargo test --test auto_sync`. Turn automatic sync off in Sync settings to keep only the manual
button.

Conflict copies (`note (conflict <device> <YYYY-MM-DD HHmm>).md`) are detected by scanning the
notebook, so they show up on every device that pulls them and after a restart. Resolving one
(Keep current / Use copy / Keep both) is an ordinary file change and is synced like any edit.

### Commands and shortcuts

All actions live in `src/features/commands/registry.ts`; add a command there and it appears in
the palette (Ctrl+K), gets its shortcut dispatched and shows up in the shortcuts help (Ctrl+/).
Shortcuts are written as `Mod+Shift+S` (`Mod` = Ctrl, or ⌘ on macOS). Full-text search is the
`search_notes` command (`src-tauri/src/notebook/search.rs`).

Manual checks against real services (not run by `cargo test` or CI):

```fish
cd src-tauri
cargo test --test network -- --ignored     # HTTPS clone of a public GitHub repo + OS keyring round-trip
```

### Releases and the updater

See [release.md](release.md): tagging, the release workflow, the signing secrets and how the
in-app updater behaves.

## 5. Everyday commands

```fish
pnpm tauri dev                     # desktop dev with HMR
pnpm tauri android dev             # Android dev
pnpm lint; pnpm typecheck; pnpm format:check
pnpm test                          # vitest (frontend helpers)
cd src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```

### Regenerating TypeScript bindings

`src/lib/bindings.ts` is generated by [tauri-specta](https://github.com/specta-rs/tauri-specta)
from the Rust command signatures. It is regenerated automatically on every `pnpm tauri dev`
(desktop debug build). To regenerate without starting the app:

```fish
GIT_NOTES_WRITE_BINDINGS=1 cargo test --manifest-path src-tauri/Cargo.toml bindings
```

`cargo test` fails if the committed file is stale, so CI catches drift.

## 6. Troubleshooting

- **`tauri dev` fails with `webkit2gtk-4.1` not found** → install the Linux packages from §2.
- **Window dies with `Error 71 (Protocol error) dispatching to Wayland display`** (NVIDIA +
  Wayland) → WebKitGTK's DMA-BUF renderer is broken on the proprietary driver. The app sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` itself when it detects the `nvidia` kernel module; to
  override, export the variable with your own value before launching.
- **Gradle: "Unsupported class file major version" / "JVM 27 not supported"** → `JAVA_HOME`
  points at a too-new JDK; use JDK 21 (§3.1).
- **OpenSSL build fails for Android** → `ANDROID_NDK_HOME` must point at the NDK (§3.2) and
  `perl` must be on `PATH`.
- **`aarch64-linux-android-ranlib: not found`** → the `cc` crate found no `llvm-ranlib` on
  `PATH`; add the NDK toolchain `bin` directory (§3.2) or install a system LLVM.
- **Android dev build can't reach the dev server** → Tauri sets `TAURI_DEV_HOST` to your LAN IP;
  the device must be on the same network (emulators work out of the box).
- **Slow Android first build** → libgit2 + OpenSSL compile from source for every target
  architecture; subsequent builds are incremental.
- **`sdkmanager` downloads crawl (dl.google.com throttles per connection)** → download the zip
  from the URL listed in Google's repository XML (`repository2-3.xml`, `sys-img/<tag>/sys-img2-3.xml`)
  with several parallel `curl -r` range requests, verify the SHA-1 from the same XML, and unzip
  into the matching `$ANDROID_HOME` sub-folder together with a `package.xml`.
