const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/utils/playbackOrder.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const next = context.exports.nextPlaybackIndex;
test("repeat off continues from a selected middle song and stops at the end", () => {
  assert.equal(next(4, 1, "off", false), 2);
  assert.equal(next(4, 2, "off", false), 3);
  assert.equal(next(4, 3, "off", false), null);
  assert.equal(next(1, 0, "off", false), null);
  assert.equal(next(0, 0, "all", false), null);
});
test("repeat modes and shuffle retain their meaning", () => {
  assert.equal(next(4, 3, "all", false), 0);
  assert.equal(next(1, 0, "all", false), 0);
  assert.equal(next(4, 2, "one", true), 2);
  assert.equal(next(4, 1, "off", true, () => 0), 0);
  assert.equal(next(4, 1, "off", true, () => 0.99), 3);
});

test("local playlist clicks keep context through track-end and next/back controls", async () => {
  const effects = [], listeners = {}, calls = [];
  const noop = () => {};
  let time = 10000;
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/hooks/useAudioPlayer.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports: module.exports,
    performance: { now: () => time },
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    window: { setInterval: noop, clearInterval: noop, addEventListener: noop, removeEventListener: noop },
    require(name) {
      if (name === "react") return {
        useState: value => [typeof value === "function" ? value() : value, noop],
        useRef: value => ({current: value}), useCallback: fn => fn,
        useEffect: fn => effects.push(fn),
      };
      if (name === "@tauri-apps/api/core") return {invoke: async (command, args) => { calls.push([command, args]); return {position: 0, duration: 0}; }};
      if (name === "@tauri-apps/api/event") return {listen: async (name, fn) => {listeners[name] = fn; return noop;}};
      if (name === "../utils") return {loadLS: (_, fallback) => fallback, saveLS: noop, parseDurationToSeconds: () => 60};
      if (name === "./playbackProgress") return {publishPlaybackProgress: noop};
      if (name === "../utils/playbackOrder") return context.exports;
      throw Error(name);
    },
  });
  const queueRef = {current: [{url: "stale-queued-song"}]};
  const player = module.exports.useAudioPlayer({
    volume: 50, setVolume: noop, previousVolume: 50, setPreviousVolume: noop,
    eq: {bass: 0, mid: 0, treble: 0}, queue: [], queueRef, setQueue: noop,
    playHistory: [], setPlayHistory: noop, setQuickPicks: noop, showToast: noop,
  });
  effects.forEach(fn => fn());
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  const tracks = [0,1,2,3].map(id => ({id, url: `local://song${id}.mp3`, title: `Song ${id}`, duration: "1:00", cover: ""}));
  player.handlePlayInContext(tracks[1], tracks); await flush();
  assert.equal(queueRef.current.length, 0);
  listeners.mpv_track_end(); await flush();
  assert.equal(player.currentTrackRef.current.url, tracks[2].url);
  assert.equal(player.playlistContextRef.current.index, 2);
  await player.handleSkipBack();
  assert.equal(player.currentTrackRef.current.url, tracks[1].url);
  await player.handleSkipForward();
  assert.equal(player.currentTrackRef.current.url, tracks[2].url);
  time += 60000; listeners.mpv_track_end(); await flush();
  assert.equal(player.currentTrackRef.current.url, tracks[3].url);
  const starts = calls.filter(([command]) => command === "play_audio").length;
  time += 60000; listeners.mpv_track_end(); await flush();
  assert.equal(calls.filter(([command]) => command === "play_audio").length, starts);
  assert.equal(player.isPlayingRef.current, false);
});
