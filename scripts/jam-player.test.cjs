const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, deps) {
  const context = { exports: {}, require: name => {
    if (!(name in deps)) throw Error(`Unexpected dependency ${name}`);
    return deps[name];
  }, setTimeout, clearTimeout, console, performance, URL, URLSearchParams, window: { setTimeout } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}
function fixture() {
  const calls = [], actions = [];
  const bridge = load('src/services/jamBridge.ts', {});
  const react = { useState: value => [typeof value === 'function' ? value() : value, () => {}], useEffect() {}, useRef: current => ({ current }), useCallback: fn => fn };
  const utils = { loadLS: (_, fallback) => fallback, saveLS() {}, parseDurationToSeconds: () => 180 };
  const { useAudioPlayer } = load('src/hooks/useAudioPlayer.ts', {
    react, '@tauri-apps/api/core': { invoke: async (...args) => { calls.push(args); return {}; } },
    '@tauri-apps/api/event': { listen() {} }, './playbackProgress': { publishPlaybackProgress() {} },
    '../services/jamBridge': bridge, '../utils/playbackOrder': { nextPlaybackIndex() { return 0; } }, '../utils': utils,
  });
  const noop = () => {};
  const player = useAudioPlayer({ volume: 80, setVolume: noop, previousVolume: 80, setPreviousVolume: noop,
    eq: { bass: 0, mid: 0, treble: 0 }, queue: [], setQueue: noop, playHistory: [], setPlayHistory: noop, setQuickPicks: noop, showToast: noop });
  return { bridge, player, calls, actions, connect() { bridge.connectJamBridge(a => actions.push(a)); } };
}
const song = { id: 1, title: 'Song', artist: 'Artist', duration: '3:00', cover: '', url: 'https://www.youtube.com/watch?v=abc' };
test('invites include connection details without exposing member credentials', () => {
  const invites = load('src/services/jamInvite.ts', {});
  const local = invites.makeJamInvite('http://192.168.1.10:54321', 'ABCDEF1234');
  assert.equal(local,'http://192.168.1.10:54321/#jam=ABCDEF1234');
  assert.equal(invites.parseJamInvite(local,'local').server,'http://192.168.1.10:54321');
  const internet = invites.makeJamInvite('https://music-room.trycloudflare.com','ABCDEF1234');
  assert.equal(invites.parseJamInvite(internet,'internet').code,'ABCDEF1234');
  assert.throws(() => invites.parseJamInvite(local,'internet'),/Choose Local/);
  assert.throws(() => invites.parseJamInvite(internet,'local'),/Choose Internet/);
  for (const invalid of ['ABCDEF1234','file:///song#jam=ABCDEF1234','https://user:pass@host/#jam=ABCDEF1234','https://host/#jam=invalid']) assert.throws(() => invites.parseJamInvite(invalid,'internet'));
});
test('normal playback stays local and room application bypasses outgoing commands', async () => {
  const f = fixture();
  await f.player.handlePlayTrack(song);
  assert.ok(f.calls.some(([name]) => name === 'play_audio'));
  f.calls.length = 0; f.connect();
  await f.player.handlePlayTrack(song, true, true);
  assert.equal(f.actions.length, 0);
  assert.ok(f.calls.some(([name]) => name === 'play_audio'));
  assert.ok(f.calls.some(([name]) => name === 'pause_audio'));
  f.bridge.connectJamBridge(null);
  assert.equal(f.bridge.jamAction({ action: 'skip' }), false);
});
test('all player actions and local playlists route to the shared room', async () => {
  const f = fixture(); f.connect();
  await f.player.handlePlayTrack(song);
  f.player.handlePlayInContext(song, [song, { ...song, url: song.url + '2' }]);
  await f.player.handlePlayLocalTrack({ path: 'C:/song.mp3', title: 'Local', extension: 'mp3' }, [
    { path: 'C:/song.mp3', title: 'Local', extension: 'mp3' },
    { path: 'C:/other.mp3', title: 'Other', extension: 'mp3' },
  ], 0);
  f.player.toggleShuffle(); f.player.cycleRepeat();
  await f.player.togglePlayPause(); await f.player.handleSkipForward(); await f.player.handleSkipBack();
  assert.deepEqual(f.actions.map(a => a.action), ['play', 'play', 'play', 'shuffle', 'repeat', 'toggle', 'skip', 'back']);
  assert.equal(f.actions[1].tracks.length, 2);
  assert.equal(f.actions[2].tracks[1].url, 'local://C:/other.mp3');
  assert.equal(f.calls.length, 0, 'outgoing controls must not independently change native playback');
});

test('Jam hook saves shared audio once, archives songs, and restores personal state on leave', async t => {
  const { createJamServer } = await import('../server/jam-server.mjs');
  const server = createJamServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const bridge = load('src/services/jamBridge.ts', {});
  const storage = new Map(), calls = [], errors = [], statuses = [];
  const failedUploads = new Set();
  const native = async (name, args) => {
    calls.push([name, args]);
    if (name === 'jam_host_start') {
      args.onProgress.onmessage('Checking the connection helper...');
      args.onProgress.onmessage('Waiting for public reachability...');
      const response = await fetch(`${base}/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:args.name})});
      return {...await response.json(),server:base,publicServer:base,hostId:'host-test',mode:args.mode};
    }
    if (name === 'jam_request') {
      const response = await fetch(`${args.server}/${args.path}`, { method: args.body === null ? 'GET' : 'POST', headers: { Authorization: `Bearer ${args.token}`, 'Content-Type': 'application/json' }, body: args.body === null ? undefined : JSON.stringify(args.body) });
      const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
    }
    if (name === 'jam_upload') {
      if (failedUploads.has(args.path)) throw Error('Room storage is full (5 GB).');
      const response = await fetch(`${args.server}/rooms/${args.code}/files`, { method: 'POST', headers: { Authorization: `Bearer ${args.token}`, 'x-audio-extension': 'mp3' }, body: Buffer.from('sample audio') });
      return response.json();
    }
    if (name === 'jam_download') {
      const response = await fetch(`${args.server}/rooms/${args.code}/files/${args.key}`, { headers: { Authorization: `Bearer ${args.token}` } });
      assert.equal(await response.text(), 'sample audio');
      return `C:/${args.save ? 'saved' : 'cache'}/${args.key}.mp3`;
    }
    if (name === 'get_playback_state') return { duration: 180, position: 0, paused: true, eof_reached: false };
  };
  const react = { useState: value => {
    let current = typeof value === 'function' ? value() : value;
    return [current, update => { current = typeof update === 'function' ? update(current) : update; statuses.push(current); }];
  }, useRef: current => ({ current }), useEffect() {} };
  const { useJam } = load('src/hooks/useJam.ts', { react, '@tauri-apps/api/core': { invoke: native, Channel: class { onmessage() {} } }, '../services/jamBridge': bridge,
    '../services/jamInvite': load('src/services/jamInvite.ts', {}),
    '../services/nickname': {saveNickname: name => { storage.set('pb_jamName',name.trim()); return name.trim(); }},
    '../utils': { loadLS: (_, fallback) => fallback, saveLS: (key, value) => storage.set(key, value) } });
  const personalQueue = [song]; const state = { queue: personalQueue, shuffle: true, repeat: 'all', playing: false };
  const jam = useJam({ play: async track => { state.track = track; }, setPlaying: v => { state.playing = v; }, setShuffle: v => { state.shuffle = v; }, setRepeat: v => { state.repeat = v; }, setQueue: v => { state.queue = v; }, getQueue: () => state.queue, getPreferences: () => ({ shuffle: state.shuffle, repeat: state.repeat }) }, message => errors.push(message));
  await jam.join(base, 'Alice');
  assert.equal(bridge.isJamActive(), true);
  await jam.command({ action: 'play', tracks: [{ ...song, url: 'local://C:/music/song.mp3' }] });
  assert.equal(state.playing, true);
  const shared = storage.get('pb_jamHistory')[0].songs[0];
  const [savedA, savedB] = await Promise.all([jam.saveSong(shared), jam.saveSong(shared)]);
  assert.equal(savedA.url, savedB.url);
  assert.ok(savedA.url.startsWith('local://C:/saved/'));
  assert.equal(calls.filter(([name, args]) => name === 'jam_download' && args.save).length, 1);
  assert.equal(storage.get('pb_jamSaved')[shared.jamId].url, savedA.url);
  const reused = { ...song, url: 'local://C:/music/song.mp3' };
  const unavailable = { ...song, title: 'Unavailable', url: 'local://C:/full.mp3' };
  failedUploads.add('C:/full.mp3');
  const uploadsBefore = calls.filter(([name]) => name === 'jam_upload').length;
  await jam.command({ action: 'play', tracks: [unavailable, reused], index: 1 });
  assert.equal(state.playing, true, 'a full room must still play the previously uploaded selection');
  assert.equal(state.track.title, song.title);
  assert.equal(calls.filter(([name]) => name === 'jam_upload').length, uploadsBefore + 1, 'only the unavailable file is attempted');
  assert.match(errors.pop(), /Playing the selected song only/);
  await jam.command({ action: 'play', tracks: [unavailable, { ...reused, title: 'Fresh selection', url: 'local://C:/fresh.mp3' }], index: 1 });
  assert.equal(state.playing, true);
  assert.equal(state.track.title, 'Fresh selection', 'resolve the clicked song before failing on an earlier playlist entry');
  assert.match(errors.pop(), /Playing the selected song only/);
  const beforeOversized = calls.filter(([name]) => name === 'jam_upload').length;
  await jam.command({ action: 'play', tracks: Array(501).fill(unavailable) });
  assert.equal(calls.filter(([name]) => name === 'jam_upload').length, beforeOversized);
  assert.match(errors.pop(), /Choose up to 500/);
  jam.leave();
  assert.equal(bridge.isJamActive(), false);
  assert.equal(state.playing, false);
  assert.equal(state.queue[0].url, personalQueue[0].url);
  assert.equal(state.shuffle, true); assert.equal(state.repeat, 'all');
  await jam.start('local','New host');
  assert.ok(statuses.includes('Checking the connection helper...'));
  assert.ok(statuses.includes('Waiting for public reachability...'));
  calls.find(([name]) => name === 'jam_host_start')[1].onProgress.onmessage('Late startup message');
  assert.ok(!statuses.includes('Late startup message'));
  assert.equal(storage.get('pb_jamName'),'New host');
  await jam.rename('Updated host');
  assert.equal(storage.get('pb_jamName'),'Updated host');
  jam.leave();
  assert.ok(calls.some(([name,args])=>name==='jam_host_stop' && args.hostId==='host-test'));
  assert.deepEqual(errors, []);
});
