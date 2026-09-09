# Publishing in-app updates

The app checks a signed update manifest hosted in GitHub Releases. The Settings
screen displays version, progress and status only; it never opens the repository
or shows raw updater errors or release notes.

## One-time signing setup

The public key is already configured in `src-tauri/tauri.conf.json`. Its matching
private key was generated locally in `.secrets/updater.key` (Git-ignored).
Back up that file securely; keep the same key for future releases.

In the repository's **Settings → Secrets and variables → Actions**, add its entire
content as a secret named `TAURI_SIGNING_PRIVATE_KEY`. Alternatively, from this
checkout with GitHub CLI installed and authenticated:

```powershell
Get-Content -Raw .secrets/updater.key | gh secret set TAURI_SIGNING_PRIVATE_KEY
```

The generated key has no password. Leave `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
unset. If you use a password-protected key later, configure that secret too and
ensure the configured public key matches. Do not commit the private key.

## Publish a version

1. Install Rust dependencies on a connected machine (`cargo check --manifest-path
   src-tauri/Cargo.toml`) and commit the resulting `src-tauri/Cargo.lock` changes.
2. Increment versions consistently in `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.
3. Run the frontend tests/build and Rust check, commit and push.
4. Create and push the matching version tag (for example `v0.1.7`).

The Release workflow signs Windows NSIS and Linux Deb/Rpm installers, merges their
entries into `latest.json`, verifies every supported platform is present, and
publishes the release only after both builds succeed. Failed builds leave a draft.
Manual workflow runs require an existing version tag. Arch packages remain
available as ordinary downloads; update Arch installations through their package
manager. Native Linux package updates may require an administrator prompt.

Existing installations need to install the first updater-enabled release manually
once. Later releases appear in Settings → Updates. The user downloads first, then
chooses **Restart and install**. Download failures and signature failures leave
the installed app intact and allow retry. Signing verification is mandatory.

## Local signed build and verification

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path .secrets/updater.key).Path
npm.cmd run tauri build
```

Test a real upgrade from one installed version to a newer signed release on each
supported platform before wider distribution. Verify settings survive restart,
interrupted downloads can be retried, and unsigned/modified packages cannot install.

Reference: https://v2.tauri.app/plugin/updater/
