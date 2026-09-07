const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function setup() {
  const data = new Map();
  const events = [];
  const style = { textContent: "body { display: none !important }" };
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  const context = {
    exports: {},
    localStorage: storage,
    sessionStorage: storage,
    document: {
      getElementById: (id) => (id === "phoebeats-custom-css" ? style : null),
    },
    window: { dispatchEvent: (event) => events.push(event.type) },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
  };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/hooks/cssThemes.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    context,
  );
  return { api: context.exports, data, events, style, context };
}

test("CSS persists and invalid stored data is ignored", () => {
  const { api, data } = setup();
  api.saveCssThemes({
    themes: [{ id: "one", name: "Night", css: ":root { --pb-cyan: cyan; }" }],
    activeId: "one",
  });
  assert.equal(api.readCssThemes().activeId, "one");
  data.set("vg_cssThemes", "{broken");
  assert.equal(api.readCssThemes().activeId, null);
  data.set(
    "vg_cssThemes",
    JSON.stringify({
      themes: [null, {}, { id: "x", name: "x", css: 12 }],
      activeId: "x",
    }),
  );
  assert.equal(api.readCssThemes().themes.length, 0);
});

test("recovery removes hostile CSS, preserves source and opens Appearance", () => {
  const { api, data, events, style } = setup();
  api.saveCssThemes({
    themes: [{ id: "one", name: "Hidden", css: style.textContent }],
    activeId: "one",
  });
  api.disableCustomCss();
  assert.equal(style.textContent, "");
  assert.equal(api.readCssThemes().activeId, null);
  assert.equal(api.readCssThemes().themes.length, 1);
  assert.equal(data.get("pb-css-safe-mode"), "1");
  assert.ok(events.includes("phoebeats-open-appearance"));
});

test("recovery still works when storage is unavailable", () => {
  const { api, context, style, events } = setup();
  context.localStorage = context.sessionStorage = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("full");
    },
  };
  assert.doesNotThrow(() => api.disableCustomCss());
  assert.equal(style.textContent, "");
  assert.ok(events.includes("phoebeats-open-appearance"));
});
