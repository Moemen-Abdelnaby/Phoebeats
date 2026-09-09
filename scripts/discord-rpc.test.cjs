// Run with: node --test scripts/discord-rpc.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function harness() {
  let time = 100000,
    index = 0,
    interval,
    status,
    fail = false,
    pending;
  const slots = [],
    effects = [],
    calls = [];
  const react = {
    useRef(value) {
      const i = index++;
      return (slots[i] ||= { current: value });
    },
    useState(value) {
      index++;
      return [
        value,
        (next) => {
          status = next;
        },
      ];
    },
    useEffect(fn, deps) {
      const i = index++,
        previous = slots[i];
      if (!previous || deps.some((d, j) => d !== previous[j])) {
        slots[i] = deps;
        effects.push(fn);
      }
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/hooks/useDiscordRpc.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    {
      exports,
      Date: { now: () => time },
      window: {
        setInterval: (fn) => {
          interval = fn;
          return 1;
        },
        clearInterval() {},
      },
      require(name) {
        if (name === "react") return react;
        if (name === "../utils") return { cleanArtist: (text) => text };
        if (name === "./playbackProgress")
          return { getPlaybackProgress: () => options.progress };
        if (name === "@tauri-apps/api/core")
          return {
            invoke: async (command, payload) => {
              calls.push({ command, payload });
              if (pending) await pending;
              if (fail) throw Error("Discord closed");
            },
          };
        throw Error(name);
      },
    },
  );
  const options = {
    enabled: true,
    playing: true,
    track: {
      id: -1,
      title: "One",
      artist: "Artist",
      url: "local://one",
      cover: "data:image/png;base64,xx",
    },
    progress: 10,
    duration: 100,
    speed: 1,
    showCover: true,
    timeDisplay: "remaining",
    customButton: false,
    buttonLabel: "",
    buttonUrl: "",
  };
  return {
    calls,
    options,
    get status() {
      return status;
    },
    render(changes = {}) {
      Object.assign(options, changes);
      index = 0;
      exports.useDiscordRpc({ ...options });
      effects.splice(0).forEach((fn) => fn());
    },
    advance(ms) {
      time += ms;
      interval();
    },
    fail(value) {
      fail = value;
    },
    hold() {
      let release;
      pending = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        pending = null;
        release();
      };
    },
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("metadata, local track changes, speed and pause", async () => {
  const h = harness();
  h.render();
  await flush();
  assert.equal(h.calls[0].payload.coverUrl, null);
  assert.equal(h.calls[0].payload.trackUrl, null);
  assert.equal(h.calls[0].payload.applicationId, "1546196215153041448");
  h.render({
    track: { ...h.options.track, title: "Two", url: "local://two" },
    speed: 2,
  });
  await flush();
  assert.equal(h.calls[1].payload.title, "Two");
  assert.equal(h.calls[1].payload.startTimestamp, 95);
  assert.equal(h.calls[1].payload.endTimestamp, 145);
  h.render({ playing: false });
  await flush();
  assert.equal(h.calls[2].command, "clear_discord_rpc");
  h.render({ enabled: false });
  await flush();
  assert.match(h.status, /Disabled/);
  assert.equal(h.calls.length, 3);
});

test("changing the Application ID immediately refreshes presence and blank restores default", async () => {
  const h = harness();
  h.render();
  await flush();
  h.render({ applicationId: "123456789012345678" });
  await flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].payload.applicationId, "123456789012345678");
  h.render({ applicationId: "" });
  await flush();
  assert.equal(h.calls[2].payload.applicationId, "1546196215153041448");
});

test("failed connections retry and normal progress does not flood Discord", async () => {
  const h = harness();
  h.fail(true);
  h.render();
  await flush();
  assert.match(h.status, /retrying/);
  h.advance(1000);
  await flush();
  assert.equal(h.calls.length, 1);
  h.fail(false);
  h.advance(4000);
  await flush();
  assert.equal(h.calls.length, 2);
  assert.match(h.status, /Connected/);
  h.advance(1000);
  h.render({ progress: 11 });
  await flush();
  assert.equal(h.calls.length, 2);
  h.advance(15000);
  await flush();
  assert.equal(h.calls.length, 3);
});

test("pause waits for an in-flight update, then clears activity", async () => {
  const h = harness(),
    release = h.hold();
  h.render();
  h.render({ playing: false });
  assert.equal(h.calls.length, 1);
  release();
  await flush();
  assert.deepEqual(
    h.calls.map((c) => c.command),
    ["update_discord_rpc", "clear_discord_rpc"],
  );
});
