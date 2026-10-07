# Releases and updates

Releases are GitHub Releases on `ylkhn1/git-notes`. The desktop app updates itself from them
(`tauri-plugin-updater`); the Android app downloads the attached APK and hands it to the system
installer (`src-tauri/src/apk_update.rs` + `ApkUpdatePlugin.kt`).

## Cutting a release

```fish
node scripts/bump-version.mjs 0.2.0      # package.json, src-tauri/Cargo.toml, Cargo.lock
# edit CHANGELOG.md
git add -A; and git commit -m "release: v0.2.0"
git tag v0.2.0; and git push; and git push origin v0.2.0
```

The tag starts `.github/workflows/release.yml`:

1. **Desktop** (Ubuntu 22.04, Windows): `pnpm tauri build --config src-tauri/tauri.release.conf.json`
   through `tauri-apps/tauri-action`. The overlay turns on `createUpdaterArtifacts`, so every
   bundle gets a minisign signature (`*.sig`) made with `TAURI_SIGNING_PRIVATE_KEY`. The action
   creates a **draft** release named after the tag and uploads the AppImage, `.deb`, `.rpm`,
   NSIS `-setup.exe`, `.msi`, the signatures and `latest.json` (the updater manifest; NSIS is
   preferred over MSI for Windows updates).
2. **Android**: builds the release APK (signed when the keystore secrets exist, see below) and
   attaches it as `git-notes_<version>_android.apk`.

Open the draft on GitHub, check the assets, then **Publish**. `latest.json` is served from
`releases/latest/download/latest.json`, which only resolves to a _published_ release, so
installed apps see the update the moment it is published and not before.

`workflow_dispatch` with an existing tag re-runs the same build (for example after fixing a
secret).

## Secrets (repository → Settings → Secrets and variables → Actions)

| Secret                               | Value                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Contents of the updater private key (`~/.tauri/git-notes-updater.key`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password; empty string if the key has none                         |
| `ANDROID_KEYSTORE_BASE64`            | `base64 -w0 release.jks` of the Android upload keystore                |
| `ANDROID_KEYSTORE_PASSWORD`          | Keystore password                                                      |
| `ANDROID_KEY_ALIAS`                  | Key alias inside the keystore                                          |
| `ANDROID_KEY_PASSWORD`               | Key password                                                           |

```fish
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/git-notes-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""

keytool -genkeypair -v -keystore ~/.tauri/git-notes-android.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias git-notes
base64 -w0 ~/.tauri/git-notes-android.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD; gh secret set ANDROID_KEY_ALIAS --body git-notes
gh secret set ANDROID_KEY_PASSWORD
```

Without the Android secrets the workflow still succeeds but attaches an
`…_android-unsigned.apk`, which Android refuses to install.

### The updater key pair

`pnpm tauri signer generate -w ~/.tauri/git-notes-updater.key` created the pair; the public
half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Installed apps only accept
bundles signed with the matching private key, so:

- **Back it up.** If it is lost, no existing install can ever update again; they would have
  to be reinstalled by hand from a release signed with a new key.
- Never commit it, never put it in a config file or log. CI only sees it as a secret.
- To rotate: generate a new pair, put the new public key in `tauri.conf.json`, update the
  secret, release. Older installs cannot verify that release and need a manual reinstall.

The same goes for the Android keystore: Android only installs an APK over an existing one when
both are signed with the same key.

## How the in-app updater behaves

- Desktop and Android (`src/features/updates/`). It checks `latest.json` 15 s after start-up and every
  6 hours while _Check for updates automatically_ (Settings → About) is on; _Check now_ and the
  _Check for updates…_ command run it by hand. Dev builds (`pnpm tauri dev`) never check on
  their own.
- A newer version shows a banner above the editor: _What’s new_ (release notes from the
  release body), _Install_, _Later_. Install downloads, verifies the signature and installs;
  Linux and Windows then need a restart (_Restart now_ saves open notes first). On Windows the
  installer runs in passive mode.
- Linux: AppImage replaces itself; `.deb` and `.rpm` are installed through `pkexec`
  (a polkit prompt). If the install fails, the dialog shows the error and the releases URL.
- Android: the same `latest.json` says which version is current (the tauri-plugin-updater does
  not run on Android, so `apk_update.rs` reads it through `ApkUpdatePlugin.kt`). _Install_
  downloads `git-notes_<version>_android.apk` from that release into the app cache, checks that
  it is a newer build of `com.ylkhn.gitnotes`, saves open notes and opens the system installer.
  The first time, Android asks to allow git-notes to install apps (_Install unknown apps_); the
  app opens that screen and continues with the installer when the user comes back. The
  installer itself rejects an APK signed with a different key, which is what authenticates
  the download. The APK left in the cache is deleted on the next start. Versions installed
  before 0.2.2 have no updater and must be updated by hand once.

### Trying the updater locally

Serve a manifest with a higher version from a local HTTP server and point a debug build at it
at compile time (`TAURI_CONFIG` is merged into `tauri.conf.json` by `tauri-build`):

```fish
set -x TAURI_CONFIG '{"plugins":{"updater":{"endpoints":["http://127.0.0.1:8787/latest.json"],"dangerousInsecureTransportProtocol":true}}}'
cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
```

The check succeeds and the banner appears; the install then fails on the signature (or the
missing bundle), which exercises the error path.

For Android, temporarily point `RELEASES_URL` in `src-tauri/src/apk_update.rs` at
`http://127.0.0.1:8787` (debug builds allow cleartext HTTP), build a debug APK with a higher
version (`pnpm tauri android build --debug --apk --target x86_64 --config '{"version":"0.9.9"}'`)
and serve it as `download/v0.9.9/git-notes_0.9.9_android.apk` next to
`latest/download/latest.json`; then build and install the current version, run
`adb reverse tcp:8787 tcp:8787` and start the app. Both APKs carry the same debug signature,
so the full flow (permission screen, system installer, relaunch) works on the emulator.
