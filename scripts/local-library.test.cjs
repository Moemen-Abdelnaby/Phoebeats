const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const context = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync("src/utils/enrichLocalTracks.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText,
  context,
);
const enrich = context.exports.enrichLocalTracks;
test("metadata workers are bounded, preserve ordering and skip cached entries", async () => {
  let active = 0,
    peak = 0,
    calls = 0,
    result;
  const tracks = Array.from({ length: 12 }, (_, i) => ({
    path: String(i),
    duration: i === 0 ? "1:00" : undefined,
  }));
  await enrich(
    tracks,
    async (t) => {
      calls++;
      peak = Math.max(peak, ++active);
      await new Promise((r) => setImmediate(r));
      active--;
      return { ...t, duration: "2:00" };
    },
    () => false,
    (value) => {
      result = value;
    },
  );
  assert.equal(peak, 3);
  assert.equal(calls, 11);
  assert.equal(result[0].duration, "1:00");
  assert.equal(
    result.map((t) => t.path).join(","),
    tracks.map((t) => t.path).join(","),
  );
});
test("cancelled scans do not publish or schedule further metadata work", async () => {
  let cancelled = false,
    calls = 0,
    published = 0;
  await enrich(
    Array.from({ length: 10 }, (_, i) => ({ path: String(i) })),
    async (t) => {
      calls++;
      await new Promise((r) => setImmediate(r));
      cancelled = true;
      return t;
    },
    () => cancelled,
    () => published++,
  );
  assert.equal(calls, 3);
  assert.equal(published, 0);
});
test("one unreadable track does not block the rest", async () => {
  let result;
  await enrich(
    [{ path: "bad" }, { path: "good" }],
    async (t) => {
      if (t.path === "bad") throw Error("bad file");
      return { ...t, duration: "1:00" };
    },
    () => false,
    (value) => {
      result = value;
    },
  );
  assert.equal(result[0].path, "bad");
  assert.equal(result[1].duration, "1:00");
});
