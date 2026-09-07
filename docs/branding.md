# App artwork

The app is named Phoebeats. Its package/executable name is `phoebeats` and its desktop identifier is `com.phoebeats.player`.

Before switching from an earlier build, export a backup in Settings. The renamed app uses a new data directory; restore the backup in Phoebeats to transfer your library, preferences, stats, and CSS themes. Existing data in the previous app directory is not deleted.

Repository and release URLs still point to the existing upstream project until a replacement repository is configured. The Discord application name must also be changed to Phoebeats by its owner in the Developer Portal.

The original copyright notice is retained. For the standalone Arch PKGBUILD, supply `phoebeats-v0.1.5.tar.gz` with a `phoebeats-0.1.5/` source directory next to the PKGBUILD. The release workflow can package the local compiled binary directly through `scripts/build-arch-pkg.sh`.

The project-owned source is `src/assets/brand.png`. The app does not reference the original file outside the repository.

To regenerate desktop icons on Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-brand-icon.ps1
npm.cmd run tauri icon -- src/assets/brand-icon.png --output src-tauri/icons
```

The preparation step pads to a square without cropping or stretching. `src-tauri/icons/icon.png` supplies the tray image; the other generated icons supply installer and operating-system branding. Rebuild and reinstall to update installed icons.

Discord hosts Rich Presence artwork separately. Upload `src/assets/brand-icon.png` as the `icon` asset in the Discord Developer Portal for application `1517835351044001953`. Local app builds cannot replace that hosted asset or the Discord application icon; the application owner must update them in the portal.
