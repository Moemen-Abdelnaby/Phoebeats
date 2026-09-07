const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function render(saved) {
  const context = {
    exports: {},
    require(name) {
      if (name === "../../hooks/playbackProgress")
        return { usePlaybackProgress: () => 0 };
      if (
        name === "react" ||
        name === "react/jsx-runtime" ||
        name === "lucide-react"
      )
        return require(name);
      if (name.endsWith(".png")) return { default: "/phoebe.png" };
      if (name === "../../utils")
        return {
          loadLS: (key, fallback) => (key in saved ? saved[key] : fallback),
          saveLS() {},
          formatTime: () => "0:00",
        };
      if (name === "@tauri-apps/api/core") return { invoke: async () => null };
      throw Error(name);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/components/layout/CompactPlayer.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    context,
  );
  return renderToStaticMarkup(
    React.createElement(context.exports.CompactPlayer, {
      currentTrack: null,
      getTrackCover: () => "",
      progressSeconds: 0,
      trackDurationSeconds: 0,
      volume: 50,
      repeatMode: "off",
    }),
  );
}
test("player restores collapse and position preferences", () => {
  const html = render({
    pb_playerCollapsed: true,
    pb_playerPosition: { right: 80, top: 120 },
  });
  assert.ok(html.includes('data-collapsed="true"'));
  assert.ok(html.includes("right:80px;top:120px"));
  assert.ok(!html.includes('aria-label="Seek"'));
});
test("malformed position falls back to reachable defaults", () => {
  const html = render({ pb_playerPosition: null });
  assert.ok(html.includes("right:32px;top:24px"));
});
