const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const context = {
  exports: {},
  require: (name) => {
    if (name === "../../hooks/playbackProgress")
      return { usePlaybackProgress: () => 0 };
    if (name.endsWith(".png")) return { default: "/brand.png" };
    if (name === "../../utils")
      return {
        loadLS: (_key, fallback) => fallback,
        saveLS: () => {},
        formatTime: (value) =>
          `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`,
      };
    if (name === "@tauri-apps/api/core")
      return { invoke: () => Promise.resolve() };
    return require(name);
  },
};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync("src/components/layout/CompactPlayer.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText,
  context,
);

test("compact player exposes transport, panel actions, seek and volume", () => {
  const html = renderToStaticMarkup(
    React.createElement(context.exports.CompactPlayer, {
      currentTrack: {
        title: "Night song",
        artist: "Phoebe",
        url: "local://test",
      },
      getTrackCover: () => "",
      isTrackLiked: () => true,
      isPlaying: true,
      volume: 40,
      progressSeconds: 30,
      trackDurationSeconds: 120,
      repeatMode: "off",
    }),
  );
  for (const label of [
    "Open playlists",
    "Open settings",
    "Hide player controls",
    "Pause",
    "Previous track",
    "Next track",
    "Seek",
    "Volume",
    "Unlike",
  ])
    assert.ok(html.includes(`aria-label="${label}"`), label);
  assert.ok(html.includes("Night song"));
  assert.ok(!html.includes("Home"));
});

test("empty player offers playlist selection and disables seeking", () => {
  const html = renderToStaticMarkup(
    React.createElement(context.exports.CompactPlayer, {
      currentTrack: null,
      getTrackCover: () => "",
      volume: 50,
      progressSeconds: 0,
      trackDurationSeconds: 0,
      repeatMode: "off",
    }),
  );
  assert.ok(html.includes("Choose a song"));
  assert.match(html, /aria-label="Seek"[^>]*disabled/);
});
