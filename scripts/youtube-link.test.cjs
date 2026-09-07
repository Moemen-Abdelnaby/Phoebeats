const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const context = { exports: {}, URL };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("src/utils/youtubeLink.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  context,
);
const normalize = context.exports.normalizeYoutubeLink;
test("video URLs normalize and discard playlist parameters", () => {
  for (const link of [
    "https://youtu.be/abcdefghijk?si=test",
    "https://www.youtube.com/watch?v=abcdefghijk&list=PL123",
    "https://music.youtube.com/watch?v=abcdefghijk",
    "https://youtube.com/shorts/abcdefghijk",
  ])
    assert.equal(
      normalize(link),
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
});
test("rejects playlists, unrelated hosts and invalid video IDs", () => {
  for (const link of [
    "https://youtube.com/playlist?list=PL123",
    "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "file:///test",
    "https://youtube.com/watch?v=abc",
    "--exec test",
    "https://user:pass@youtube.com/watch?v=abcdefghijk",
  ])
    assert.equal(normalize(link), null);
});
