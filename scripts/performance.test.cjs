const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

test("stats retain live totals but batch persistence, flush, and discard reset data", () => {
  let index = 0,
    timer;
  const slots = [],
    effects = [],
    writes = [],
    events = [];
  const react = {
    useRef(value) {
      const i = index++;
      return (slots[i] ||= { current: value });
    },
    useState(initial) {
      const i = index++;
      if (!(i in slots))
        slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
        },
      ];
    },
    useCallback(fn) {
      index++;
      return fn;
    },
    useEffect(fn, deps) {
      const i = index++,
        old = slots[i];
      if (!old || deps.some((d, j) => d !== old[j])) {
        slots[i] = deps;
        effects.push(fn);
      }
    },
  };
  // useCallback needs stable identities, as in React.
  react.useCallback = (fn, deps) => {
    const i = index++,
      old = slots[i];
    if (!old || deps.some((d, j) => d !== old.deps[j])) slots[i] = { fn, deps };
    return slots[i].fn;
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/hooks/usePlaybackHistory.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
        },
      },
    ).outputText,
    {
      exports,
      window: {
        setInterval(fn) {
          timer = fn;
        },
        clearInterval() {},
        addEventListener() {},
        removeEventListener() {},
      },
      document: {
        hidden: false,
        addEventListener() {},
        removeEventListener() {},
      },
      require(name) {
        if (name === "react") return react;
        if (name === "../utils")
          return {
            loadLS: (_, fallback) => fallback,
            saveLS: (key, value) => writes.push([key, value]),
          };
        if (name === "../services/db")
          return {
            dbRecordPlayEvent: (track, secs) => events.push([track.url, secs]),
            dbClearListeningStats() {
              events.length = 0;
            },
          };
        throw Error(name);
      },
    },
  );
  function render() {
    index = 0;
    const result = exports.usePlaybackHistory();
    effects.splice(0).forEach((fn) => fn());
    return result;
  }
  let h = render();
  h.recordTrackPlay({ url: "song", title: "Song" });
  h = render();
  writes.length = 0;
  for (let i = 0; i < 10; i++) {
    h.recordListeningStep("song", 1);
    h = render();
  }
  assert.equal(h.listenSecs.song, 10);
  assert.equal(events.length, 1);
  assert.equal(writes.length, 0);
  timer();
  assert.deepEqual(events[1], ["song", 10]);
  assert.equal(writes.length, 2);
  h.recordListeningStep("song", 1);
  h = render();
  h.flushListeningStats();
  assert.deepEqual(events[2], ["song", 1]);
  h.recordListeningStep("song", 1);
  h = render();
  h.resetAllStats();
  h = render();
  timer();
  assert.equal(events.length, 0);
  assert.equal(Object.keys(h.listenSecs).length, 0);
});

test("progress subscribers update only on changed positions and unsubscribe cleanly", () => {
  const exports = {};
  let subscribe;
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/hooks/playbackProgress.ts", "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      exports,
      require: () => ({
        useCallback: (fn) => fn,
        useSyncExternalStore: (fn, snapshot) => {
          subscribe = fn;
          return snapshot();
        },
      }),
    },
  );
  exports.usePlaybackProgress(true);
  let updates = 0;
  const stop = subscribe(() => updates++);
  exports.publishPlaybackProgress(1);
  exports.publishPlaybackProgress(1);
  assert.equal(updates, 1);
  stop();
  exports.publishPlaybackProgress(2);
  assert.equal(updates, 1);
  exports.usePlaybackProgress(false);
  subscribe(() => updates++);
  exports.publishPlaybackProgress(3);
  assert.equal(updates, 1);
  assert.equal(exports.getPlaybackProgress(), 3);
});
