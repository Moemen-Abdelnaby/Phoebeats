const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(autoCheck = false) {
  const slots = [], effects = [], calls = [], events = [];
  let index = 0, api;
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (value) => { slots[slot] = value; }];
    },
    useRef(value) { const slot = index++; return slots[slot] ||= { current: value }; },
    useCallback(fn, deps) {
      const slot = index++;
      if (!slots[slot] || deps.some((v, i) => slots[slot].deps[i] !== v)) slots[slot] = { fn, deps };
      return slots[slot].fn;
    },
    useEffect(fn, deps) {
      const slot = index++;
      if (!slots[slot] || deps.some((v, i) => slots[slot][i] !== v)) { slots[slot] = deps; effects.push(fn); }
    },
  };
  const context = {
    exports: {}, Event: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent: (event) => events.push(event.type) },
    require(name) {
      if (name === "react") return react;
      if (name === "@tauri-apps/api/core") return {
        Channel: class {},
        invoke: (name, args) => {
          if (name === "pause_audio") { events.push(name); return Promise.resolve(); }
          return new Promise((resolve, reject) => calls.push({ name, args, resolve, reject }));
        },
      };
      throw Error(name);
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/hooks/useAppUpdater.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  function render() { index = 0; api = context.exports.useAppUpdater(autoCheck); effects.splice(0).forEach((fn) => fn()); }
  render();
  return { calls, events, render, get api() { return api; }, async settle() { await flush(); render(); } };
}

test("checking does not download; verified download requires a separate install click", async () => {
  const h = harness();
  assert.equal(h.calls.length, 0);
  void h.api.check();
  void h.api.check();
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve("0.1.7"); await h.settle();
  assert.equal(h.api.state.phase, "available");
  void h.api.download(); void h.api.download();
  assert.equal(h.calls.length, 2);
  const progress = h.calls[1].args.onProgress;
  progress.onmessage({ phase: "downloading", downloaded: 20, total: 100 }); h.render();
  assert.equal(h.api.state.percent, 20);
  progress.onmessage({ phase: "verifying", downloaded: 0, total: null }); h.render();
  assert.equal(h.api.state.phase, "verifying");
  h.calls[1].resolve(); await h.settle();
  assert.equal(h.api.state.phase, "ready");
  assert.equal(h.calls.length, 2);
  progress.onmessage({ phase: "downloading", downloaded: 100, total: 100 }); h.render();
  assert.equal(h.api.state.phase, "ready");
  await h.api.check();
  assert.equal(h.calls.length, 2);
  void h.api.install(); await h.settle();
  assert.deepEqual(h.events, ["beforeunload", "pause_audio"]);
  assert.equal(h.calls[2].name, "install_app_update");
  h.calls[2].resolve(); await h.settle();
});

test("startup checking respects preference and no-update response", async () => {
  const h = harness(true);
  assert.equal(h.calls[0].name, "check_for_update");
  h.calls[0].resolve(null); await h.settle();
  assert.equal(h.api.state.phase, "current");
  h.render();
  assert.equal(h.calls.length, 1);
});

test("errors never reveal a repository URL and failed downloads can retry", async () => {
  const h = harness();
  void h.api.check();
  h.calls[0].reject(Error("https://github.com/private-owner/private-repo failed")); await h.settle();
  assert.equal(h.api.state.phase, "error");
  assert.doesNotMatch(h.api.state.message, /github|private-owner|private-repo/);
  void h.api.check(); h.calls[1].resolve("0.1.7"); await h.settle();
  void h.api.download();
  h.calls[2].reject(Error("signature rejected for https://github.com/private/repo")); await h.settle();
  assert.equal(h.api.state.phase, "error");
  assert.doesNotMatch(h.api.state.message, /github|private/);
  await h.api.install();
  assert.equal(h.calls.length, 3);
  void h.api.download(); h.calls[3].resolve(); await h.settle();
  assert.equal(h.api.state.phase, "ready");
});

test("failed installation offers a fresh download and hides native errors", async () => {
  const h = harness();
  void h.api.check(); h.calls[0].resolve("0.1.7"); await h.settle();
  void h.api.download(); h.calls[1].resolve(); await h.settle();
  void h.api.install(); await h.settle();
  h.calls[2].reject(Error("private repository error")); await h.settle();
  assert.equal(h.api.state.phase, "error");
  assert.doesNotMatch(h.api.state.message, /private|repository/);
  void h.api.download(); h.calls[3].resolve(); await h.settle();
  assert.equal(h.api.state.phase, "ready");
});
