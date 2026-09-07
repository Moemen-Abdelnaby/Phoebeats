# Phoebeats feature pack

## Added

- **Remember player state:** drag the Phoebeats label to move the player. Position and icon-only collapse state survive restarts; positions are kept within the window. The last playlist and song are restored without auto-playing. Press Play to resume the saved position (updated every five seconds and on normal close).
- **Persistent library metadata:** file metadata is saved in SQLite alongside existing app data and reused across launches. File size and modification time invalidate changed entries. This is derived cache data, not a replacement for playlist backups.
- **Missing-file repair:** Settings → Repair missing playlist songs → Check files. Locate each replacement to update matching entries across playlists and the queue. Files are not moved or deleted; existing playlist order and custom playlist art remain intact.
- **YouTube MP3 queue:** paste one video link per line in the playlist panel's download form. Jobs run one at a time, show progress, and support Cancel/Retry. Destination folders are captured when queued. Queue state is session-only; cancelled partial files are retained for retry instead of deleting unrelated files from the songs folder.
- **Wallpaper controls:** Settings → Appearance → Wallpaper provides Pause/Resume, Restart, Dimming and Original/1080p quality. The new 1080p asset is the default and is around 2.7 MB; the original 4K video remains available. Reduced-motion and Performance Mode still pause the wallpaper.
- **Automatic playlist artwork:** the first song supplies the cover, including embedded artwork for local songs. A manually chosen playlist cover takes priority. Changing the first song updates the automatic cover.

## Removed

Deleted the Home view, recommendation/onboarding data and UI, artist-following types/state, legacy Sidebar and full-width PlayerBar, SpeedSelector and WaveformBar components. Removed crossfade and A–B playback logic and speed preferences from the active frontend. The native speed command remains as an implementation detail to reset playback to normal speed.

Deleted source files: `src/components/views/HomeView.tsx`, `src/components/OnboardingModal.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/PlayerBar.tsx`, `src/components/SpeedSelector.tsx`, `src/components/WaveformBar.tsx`.

Saved playlists, liked songs, listening data and existing backups were not deleted. Old unused preference keys are tolerated for compatibility. Genre definitions remain because statistics still use them. Search plumbing used by retained import tools is not removed.

## Retained access

Settings has a small menu for Statistics, Listening history and the queue. Equalizer, Discord RPC, Custom CSS with emergency recovery, and backup/restore remain available. Closing an expansion panel returns to the wallpaper. The old theme/compact-UI inventory documents describe earlier revisions; this document supersedes their removed-feature lists.

## Implementation files

- Player/session state: `src/components/layout/CompactPlayer.tsx`, `src/hooks/useAudioPlayer.ts`, `src/hooks/usePlaylists.ts`, `src/App.tsx`.
- Persistent metadata: `src-tauri/src/db.rs`, `src-tauri/src/metadata.rs`.
- Missing-file repair: `src/components/LibraryRepair.tsx`, `src-tauri/src/main.rs`.
- Download queue: `src/components/YoutubeMp3Download.tsx`, cancellation safety in `src-tauri/src/main.rs`.
- Wallpaper: `src/hooks/wallpaperSettings.ts`, `src/components/WallpaperControls.tsx`, `src/components/VideoWallpaper.tsx`, `src/components/SettingsPanel.tsx`, `public/wallpapers/phoebe-1080p.mp4`.
- Artwork: `src/hooks/usePlaylistArtwork.ts`.
- Layout, cleanup and tests: `src/compact-layout.css`, `src/constants.ts`, `src/types.ts`, `scripts/compact-player.test.cjs`, and feature-specific regression tests.

Rebuild the desktop app to include the Rust changes and the new video asset. No live YouTube download or desktop visual verification is implied by unit/build checks.

Validation: Prettier formatting, TypeScript/frontend production build, 24 JavaScript regression tests and all 6 native Rust tests passed. The native tests include SQLite metadata persistence across reopening and fingerprint invalidation. Vite still reports a bundle-size advisory; no lint script is configured. No installer was produced and real-world performance was not benchmarked.
