# Phoebeats

Phoebeats is a personal-use fork of [Veluna](https://github.com/rry0ku/veluna), customized around Phoebe from Wuthering Waves. It is not an official Veluna release.

It features a compact music player, a looping video wallpaper, custom CSS themes, local playlists, listening stats, and Discord Rich Presence.

Private two-person Jams support automatic Local/Internet hosting, personal nicknames, a shared queue, synchronized shuffle, local audio sharing, and saving songs to playlists. See [Jams](docs/jam.md) for how to connect.

## Development

Requires Node.js, Rust/Cargo, and the platform prerequisites for Tauri v2.

```sh
npm install
npm run tauri dev
```

Build the desktop app:

```sh
npm run tauri build
```

## Credits

Original project by [rry0ku](https://github.com/rry0ku). See [LICENSE](LICENSE) for the MIT license and original copyright notice.
