# Performance cleanup

Playback progress uses a small shared store. The compact player subscribes only
while expanded; lyrics and Last.fm subscribe only when enabled/open. Ordinary
progress ticks no longer drive the application root when these are inactive.
Listening statistics still update live once per second.

Library sorting is memoized and its playlist/context-menu callbacks are stable.
Playlist localStorage persistence happens once per change; SQLite writes only
playlists whose objects changed. Unused codec polling is removed. Discord compares
only RPC-relevant fields, excluding embedded artwork from its comparison key.

Native artwork extraction shares an LRU cache across both cover commands. It
caches missing art as well as images, coalesces same-key work, and checks audio,
directory and selected sidecar fingerprints on lookup. It retains at most 64
entries and 32 MiB of image strings; images over 512 KiB are returned unchanged
but not retained. Temporary extraction allocations are outside that limit.

Stats persistence batches elapsed seconds every 15 seconds, with flushes on
pause, track changes, visibility loss and best-effort unload. Database writes are
ordered. Elapsed-time updates no longer increment database play counts or
overwrite track metadata. Existing historical overcounts are not rewritten.
An abrupt crash/termination can lose the latest unflushed seconds (up to about
15 seconds); unload cannot guarantee completion of asynchronous database writes.

Wallpaper quality, blur, audio playback and visible controls are unchanged.
These changes are covered by automated checks, but CPU/GPU savings have not been
benchmarked against a running game.
