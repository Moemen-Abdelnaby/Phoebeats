const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function settings(value) {
  const context = {
    exports: {},
    require: (name) => (name === "react" ? {} : { loadLS: () => value }),
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/hooks/wallpaperSettings.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
        },
      },
    ).outputText,
    context,
  );
  return context.exports.readWallpaperSettings();
}
test("wallpaper preferences validate dimming and default to lighter video", () => {
  assert.equal(settings(null).quality, "1080p");
  assert.equal(settings({ dim: 900 }).dim, 0.85);
  assert.equal(settings({ dim: -2 }).dim, 0);
  assert.equal(settings({ quality: "original", paused: true }).paused, true);
  assert.equal(settings({ quality: "invalid" }).quality, "1080p");
});
