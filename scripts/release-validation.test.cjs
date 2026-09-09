const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function validate(script, files, env) {
  vm.runInNewContext(fs.readFileSync(script, "utf8"), {
    require: () => ({ readFileSync: (path) => files[path] }),
    process: { argv: ["node", script, "manifest.json"], env },
    console: { log() {} },
  });
}
test("release preflight rejects missing signing secrets and mismatched versions", () => {
  const files = {
    "src-tauri/tauri.conf.json": JSON.stringify({ version: "0.1.7", bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: "public-key" } } }),
    "package.json": JSON.stringify({ version: "0.1.7" }),
    "src-tauri/Cargo.toml": 'version = "0.1.7"',
  };
  const run = (env) => validate("scripts/check-release-config.cjs", files, env);
  assert.throws(() => run({ RELEASE_TAG: "v0.1.7" }), /TAURI_SIGNING_PRIVATE_KEY/);
  assert.throws(() => run({ RELEASE_TAG: "v0.1.6", TAURI_SIGNING_PRIVATE_KEY: "test" }), /Release tag/);
  assert.doesNotThrow(() => run({ RELEASE_TAG: "v0.1.7", TAURI_SIGNING_PRIVATE_KEY: "test" }));
});
test("publishing requires signed assets for every platform and matching version", () => {
  const manifest = { version: "0.1.7", platforms: {} };
  const run = () => validate("scripts/check-update-manifest.cjs", { "manifest.json": JSON.stringify(manifest) }, { RELEASE_TAG: "v0.1.7" });
  assert.throws(run, /Missing signed update/);
  for (const key of ["windows-x86_64-nsis", "linux-x86_64-deb", "linux-x86_64-rpm"]) manifest.platforms[key] = { signature: "signed", url: "https://example.com/installer" };
  assert.doesNotThrow(run);
  manifest.platforms["linux-x86_64-deb"].signature = "";
  assert.throws(run, /Missing signed update/);
  manifest.version = "0.1.8";
  assert.throws(run, /does not match/);
});
