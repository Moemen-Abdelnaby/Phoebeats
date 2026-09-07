# Phoebe Glass theme

Choose **Settings → Appearance → Phoebe Glass**. This is the new default; other built-in themes remain available. Panels use navy glass, cyan active controls and gold favorites. The native Windows titlebar stays native, with dark window styling.

## Wallpaper

The supplied MP4 is already copied to `public/wallpapers/phoebe.mp4`. It is bundled by Vite without base64 encoding or a dependency on the original absolute path. Replace that file to change the wallpaper, then rebuild. Update `public/wallpapers/phoebe-poster.jpg` too: it is the still-image fallback. To change filenames, edit the asset URLs in `src/components/VideoWallpaper.tsx`.

Playback is silent, looping and behind all controls. It pauses when the window is hidden, reduced motion is requested, Performance Mode is enabled, or another built-in theme is selected. The source video is 4K; a smaller H.264 MP4 can reduce installation size and GPU usage.

## Custom CSS

Open **Settings → Appearance → Custom CSS**, edit the source, then **Apply**. Named themes, import/export and localStorage persistence are retained. **Disable CSS** preserves your source; **Enable CSS** applies the selected editor content. **Reset CSS** clears the selected theme and disables custom CSS.

Overrides load after the base theme in `<style id="phoebeats-custom-css">`; they never overwrite application files. Start with `:root[data-theme="phoebe"] { --pb-cyan: #a7eaff; }`. More specific selectors or `!important` may be needed to override existing inline control styles.

If CSS hides the interface, press **Ctrl+Shift+F12** (Cmd+Shift+F12 on Mac). This immediately clears injected CSS, disables it and opens Appearance, preserving the saved source. In browser development, `?customCss=off` also starts without overrides. Applying CSS leaves this recovery mode. Recovery still clears the style element when storage is unavailable.

## Inspected architecture

Global rules are in `src/App.css`; the root is `src/App.tsx`, mounted by `src/main.tsx`. Sidebar, queue, navigation and playback controls live under `src/components/layout`. `PlayerBar.tsx` owns progress and volume. `TrackRow.tsx` and `VirtualTrackList.tsx` render tracks; library/playlist views are in `views/PlaylistsView.tsx`. Search is in `views/HomeView.tsx`. Dialogs are distributed across `App.tsx`, `Modals.tsx`, `OnboardingModal.tsx` and `layout/ContextMenu.tsx`. Settings use `SettingsPanel.tsx`, `ThemedSelect.tsx` and `CssThemeEditor.tsx`; theme state is in `hooks/useTheme.ts` and `hooks/cssThemes.ts`. Window decorations are native Tauri controls, not a frontend titlebar. Existing virtualization, statistics and playback behavior are retained.

## Files changed for this theme

| File                                        | Change                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/phoebe-theme.css`                      | Central palette, glass surfaces, states, controls, menus, dialogs, scrollbars and motion/accessibility fallbacks. |
| `src/main.tsx`                              | Loads the base theme after global CSS; token-based error-screen colors.                                           |
| `src/App.tsx`                               | Wallpaper/layout hooks, emergency settings navigation, dialog markers and neutral color tokens.                   |
| `src/components/VideoWallpaper.tsx`         | Decorative video lifecycle and poster fallback.                                                                   |
| `public/wallpapers/phoebe.mp4`              | Bundled user-supplied wallpaper.                                                                                  |
| `public/wallpapers/phoebe-poster.jpg`       | Still fallback extracted from the supplied video.                                                                 |
| `src/hooks/useTheme.ts`                     | Phoebe default, scoped accent handling, dedicated override style and recovery keyboard handler.                   |
| `src/hooks/cssThemes.ts`                    | Phoebe starter CSS and storage-resilient recovery.                                                                |
| `src/components/CssThemeEditor.tsx`         | Apply, enable/disable, reset and recovery instructions.                                                           |
| `src/components/SettingsPanel.tsx`          | Phoebe theme card, Appearance recovery, tokenized colors.                                                         |
| `src/components/ThemedSelect.tsx`           | Glass dropdown hook.                                                                                              |
| `src/components/layout/Sidebar.tsx`         | Sidebar surface hook and tokenized colors.                                                                        |
| `src/components/layout/QueuePanel.tsx`      | Glass queue/open-state hooks and tokenized colors.                                                                |
| `src/components/layout/PlayerBar.tsx`       | Album art/volume hooks and tokenized controls.                                                                    |
| `src/components/layout/TopBar.tsx`          | Tokenized navigation colors.                                                                                      |
| `src/components/layout/ContextMenu.tsx`     | Tokenized menus and dialog/primary-button markers.                                                                |
| `src/components/layout/DownloadsFlyout.tsx` | Tokenized flyout colors.                                                                                          |
| `src/components/BatchActionBar.tsx`         | Tokenized selection-action colors.                                                                                |
| `src/components/DownloadsPanel.tsx`         | Tokenized download controls/dialog markers.                                                                       |
| `src/components/Modals.tsx`                 | Tokenized dialogs and glass/primary-button markers.                                                               |
| `src/components/OnboardingModal.tsx`        | Tokenized onboarding and glass dialog markers.                                                                    |
| `src/components/SleepTimerPopover.tsx`      | Tokenized timer colors.                                                                                           |
| `src/components/TrackRow.tsx`               | Tokenized track text and hover colors.                                                                            |
| `src/components/WaveformBar.tsx`            | Tokenized waveform labels.                                                                                        |
| `src/components/views/HistoryView.tsx`      | Tokenized history controls.                                                                                       |
| `src/components/views/HomeView.tsx`         | Tokenized search and home controls.                                                                               |
| `src/components/views/LyricsView.tsx`       | Tokenized lyrics controls.                                                                                        |
| `src/components/views/PlaylistsView.tsx`    | Tokenized library/playlist controls and primary-button markers.                                                   |
| `src-tauri/tauri.conf.json`                 | Dark native window theme; no identifier change for this task.                                                     |
| `scripts/phoebe-theme.test.cjs`             | Storage validation and custom-CSS recovery regression tests.                                                      |
| `docs/phoebe-theme.md`                      | Architecture, usage and change manifest.                                                                          |

Other existing worktree changes predate this theme task. Upstream repository links retain their real URLs; technical compatibility identifiers are not blindly replaced.

## Verification

Prettier formatting, TypeScript/frontend production build, six regression tests (CSS recovery and Discord RPC), and offline Cargo check passed. No lint configuration exists. Vite reports a bundle-size advisory. Automated visual verification could not complete because the headless Edge connection closed; a desktop visual/playback check remains recommended. No installer was produced.
