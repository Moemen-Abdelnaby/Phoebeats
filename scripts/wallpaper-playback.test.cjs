const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(enabled = true) {
  let now = 0;
  const document = new EventTarget();
  document.hidden = false;
  const motion = new EventTarget();
  motion.matches = false;
  const window = new EventTarget();
  let tick,
    plays = 0,
    loads = 0,
    fail = false;
  window.matchMedia = () => motion;
  window.setInterval = (fn) => {
    tick = fn;
    return 1;
  };
  window.clearInterval = () => {
    tick = undefined;
  };
  const video = new EventTarget();
  Object.assign(video, {
    paused: true,
    ended: false,
    error: null,
    currentTime: 0,
    pause() {
      this.paused = true;
    },
    load() {
      loads++;
      this.error = null;
      this.paused = true;
    },
    play() {
      plays++;
      if (fail) return Promise.reject(Error("suspended"));
      this.paused = false;
      return Promise.resolve();
    },
  });
  const context = { exports: {}, window, document, Date: { now: () => now } };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/hooks/wallpaperPlayback.ts", "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    context,
  );
  const stop = context.exports.startWallpaperPlayback(video, enabled);
  return {
    video,
    document,
    window,
    motion,
    stop,
    tick: () => tick?.(),
    advance: (ms) => {
      now += ms;
      tick?.();
    },
    get plays() {
      return plays;
    },
    get loads() {
      return loads;
    },
    fail: (v) => {
      fail = v;
    },
  };
}
test("minimize pauses and restore resumes; rejected resume retries", async () => {
  const h = harness();
  await flush();
  h.document.hidden = true;
  h.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.video.paused, true);
  h.tick();
  assert.equal(h.plays, 1);
  h.fail(true);
  h.document.hidden = false;
  h.window.dispatchEvent(new Event("focus"));
  await flush();
  assert.equal(h.video.paused, true);
  h.fail(false);
  h.tick();
  await flush();
  assert.equal(h.video.paused, false);
  h.stop();
});
test("returning to the app forces play even when paused is false", async () => {
  const h = harness();
  await flush();
  h.window.dispatchEvent(new Event("phoebeats-wallpaper-resume"));
  await flush();
  assert.equal(h.plays, 2);
  h.advance(5000);
  await flush();
  assert.equal(
    h.loads,
    1,
    "frozen playback reloads instead of trusting paused=false",
  );
  h.stop();
});
test("moving playback does not reload, including normal loop wrap", async () => {
  const h = harness();
  await flush();
  for (const time of [4, 8, 12, 0, 4]) {
    h.video.currentTime = time;
    h.advance(4000);
    await flush();
  }
  assert.equal(h.loads, 0);
  h.stop();
});
test("watchdog recovers a missed restore event and a media error", async () => {
  const h = harness();
  await flush();
  h.video.pause();
  h.tick();
  await flush();
  assert.equal(h.video.paused, false);
  h.video.error = {};
  h.video.pause();
  h.tick();
  await flush();
  assert.equal(h.loads, 1);
  assert.equal(h.video.paused, false);
  h.stop();
  const plays = h.plays;
  h.window.dispatchEvent(new Event("focus"));
  h.tick();
  assert.equal(h.plays, plays);
});
test("disabled wallpaper and reduced motion remain paused", async () => {
  const disabled = harness(false);
  disabled.tick();
  assert.equal(disabled.plays, 0);
  disabled.stop();
  const h = harness();
  await flush();
  h.motion.matches = true;
  h.motion.dispatchEvent(new Event("change"));
  h.window.dispatchEvent(new Event("focus"));
  h.tick();
  assert.equal(h.video.paused, true);
  assert.equal(h.plays, 1);
  h.stop();
});
