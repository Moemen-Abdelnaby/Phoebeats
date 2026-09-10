# Jams

In Phoebeats, open **Start / Join Jam** and choose **Local** or **Internet**, then **Start a Jam** or **Join a friend**. Set your nickname before connecting. Rooms support two people without accounts.

The host clicks **Start Local Jam** or **Start Internet Jam**. The app creates the server and room automatically. Click **Copy invite** and send the full invite to your friend. They choose the same connection type and paste it into **Friend’s invite**. No terminal, server address entry, or Node installation is required.

## Local

The embedded server chooses an available port and includes the host's network address in the invite. Both people must be on the same reachable network. Local hosting works without internet access; online music sources still need internet. Windows may ask to allow Phoebeats through the firewall on a private network. Guest Wi-Fi isolation or a VPN can prevent devices from reaching each other.

## Internet

Internet hosting starts the embedded server on loopback and automatically connects a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/). The first start downloads the official `cloudflared` helper from Cloudflare's GitHub release, verifies its published SHA-256 digest, and stores it in the app data directory. Later starts reuse the matching verified binary. Automatic Internet hosting supports Windows x64 and Linux x64/ARM64.

Only the dedicated Jam server is exposed. The invite contains its temporary HTTPS address and room code, never either person's private membership token. The public health route is checked before showing the invite. No router port forwarding, Cloudflare account, or purchased domain is required. Quick Tunnels have no uptime guarantee; a blocked connection or provider outage can prevent Internet hosting. Traffic and shared audio pass through Cloudflare.

The host's app must remain running. **End Jam**, quitting the host app, or a hosting failure closes the server and tunnel; the friend disconnects. Minimizing to the system tray keeps hosting active. A new Internet Jam gets a new invite. Guests can leave without ending the host's Jam.

## Nicknames

Each participant chooses their own nickname and can edit it during a Jam using **Update nickname**. Names are remembered on that device, are limited to 40 characters, and cannot be blank. Changing a name updates member labels and shared-song attribution. Host-only playback permissions do not prevent nickname changes. A participant cannot rename the other person.

## Playback

When Discord Rich Presence is enabled and you are playing with another participant, the activity keeps the song title and shows **#Phoebeating with [nickname]**. Hovering the artwork shows the song and artist; the small badge identifies shared listening. Nickname changes update the activity, and the usual solo activity returns when the other participant leaves. Pausing or disabling Rich Presence hides the activity as before. Invites and room credentials are never added to Discord.

Playing a playlist replaces the Jam queue without editing the personal playlist. Shuffle is decided once by the server; both participants see the same order. Disabling shuffle restores the remaining tracks' original order. Both can add songs, or the host can restrict playback controls. Volume remains individual. Back restarts the current song. Repeat cycles off/all/one.

Each track starts after both clients report that it loaded. Clients poll every 750 ms and correct position differences over 1.2 seconds. This is approximate synchronized listening, not sample-accurate multi-speaker playback. A slow download pauses the start for everyone. A participant with playback permission can skip an unavailable track. Interrupted connections pause playback and retry, then require joining again.

Online YouTube tracks are loaded independently by each app. Selected local files are uploaded to the host's embedded service, then downloaded to each player's private playback cache. Files are limited to 100 MB each and 500 MB per room, with at most two simultaneous audio uploads. Uploads can take time before a playlist starts. Sharing a local playlist uploads its selected tracks. Only explicitly selected audio is shared, and local file paths are not sent to the friend.

## Shared songs and saving

The Jam panel includes the shared queue, shared songs with contributor names, and the last 20 sessions. Audio files can be downloaded permanently, or saved directly to an existing/new playlist. Online tracks save as references. Permanent copies live in the application's data directory under `jam-saved`; playback copies live under `jam-cache`. Saving uses a stable file key to avoid duplicate downloads. A saved playlist remains usable after leaving the room.

Room data and relay files are in memory and disappear when hosting ends. Disconnected guests expire after 45 seconds. History is local metadata; an unsaved file from a previous room must be shared again. The playback cache is not a permanent download library.

## Verification

```sh
npm run test:jam
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml jam_
```

For a desktop smoke test, start a Local Jam and join its invite from another computer, then repeat using Internet. Change both nicknames, share a local file in each direction, and verify buffering, playback, seeks, shuffle order, permission restrictions, disconnect behavior, and save-to-playlist playback after leaving. End the hosted Jam and verify that the other person disconnects and the listener/tunnel stop.

The standalone `server/jam-server.mjs` service remains available for development and protocol testing through `npm run jam:server`; it is not used by automatic hosting.
