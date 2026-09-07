# Wallpaper-first UI review

The default screen is a 340px rectangular glass player in the top-right. The top-left playlist button opens the playing playlist when its playback context matches a saved playlist, otherwise the last viewed playlist/library. The panel toolbar allows selecting any playlist, returning to all playlists, opening the songs folder, or closing the panel. At narrower window widths the panel overlays the player; its close button returns to playback controls.

The smaller Phoebe icon in the top-right collapses the entire player into just the icon, without its glass panel or other buttons. Click it again to restore the player, including Settings in the bottom-left. Existing Custom CSS and its Ctrl+Shift+F12 emergency recovery remain available. Panels start closed to maximize wallpaper visibility.

The existing local-library/download folder preference is migrated once to `D:\songs`. No music is moved or deleted and no folder is created. Afterwards the normal folder picker can change it. Use **Songs folder** in the expanded panel to scan/play local songs and add them to playlists. If the folder does not exist, choose an existing folder there.

## No longer shown in the main layout — retained pending approval

- Home page, global online search/results, recommendations, quick picks and personalization onboarding.
- Persistent left sidebar, its navigation links, playlist shortcuts and queue badge.
- Global top navigation/back bar, shortcut-help button and downloads flyout trigger.
- Statistics and listening-history navigation/screens. Their stored data and tracking are retained.
- Separate queue panel and queue reordering controls. Queue actions in track context menus and playback behavior remain.
- Library side column: summary statistics, recent-listening cards and sidebar import shortcuts. Playlist creation and the remaining library toolbar remain available.
- Old full-width bottom player and its advanced controls: waveform/A–B loop UI, speed selector, crossfade indicator, sleep-timer button, lyrics button, codec/audio details and player download action. Existing settings/context-menu equivalents and saved playback preferences are not removed or reset.
- Startup navigation choices for Home, Stats and History. The new shell always starts with its expansion panel closed.

This is a presentation change, not deletion approval: legacy components, online integrations, statistics, history, queue data and advanced audio functionality are preserved. Some retained features can still be reached through existing keyboard shortcuts or context menus. Settings is intentionally retained in full so existing audio preferences and integrations can still be managed.

## Changed files

- `src/components/layout/CompactPlayer.tsx`: compact transport, playlist/settings actions, native seek/volume commands and accessible controls.
- `src/compact-layout.css`: floating player, expandable responsive panel, lighter wallpaper overlay and temporary legacy-surface hiding.
- `src/App.tsx`: compact-player wiring, panel navigation/recovery, Home navigation redirection, onboarding suppression and one-time songs-folder default.
- `src/main.tsx`: loads compact layout after existing theme rules and before custom CSS.
- `src/components/SettingsPanel.tsx`: removes hidden pages from startup choices.
- `scripts/compact-player.test.cjs`: server-render regression coverage for visible controls and empty-player state.
- `docs/compact-ui.md`: this usage guide and hidden-feature inventory.
