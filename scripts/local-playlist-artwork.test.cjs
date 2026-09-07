const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
test("playlist rows recover missing local artwork from the audio file", async () => {
  let index = 0;
  const slots = [],
    effects = [],
    calls = [];
  const react = {
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (v) => {
          slots[i] = v;
        },
      ];
    },
    useEffect(fn, deps) {
      const i = index++;
      if (!slots[i] || deps.some((v, n) => v !== slots[i][n])) {
        slots[i] = deps;
        effects.push(fn);
      }
    },
  };
  const context = {
    exports: {},
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return require(name);
      if (name === "@tauri-apps/api/core")
        return {
          invoke: async (command, args) => {
            calls.push({ command, args });
            return "data:image/png;base64,cover";
          },
        };
      throw Error(name);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/components/LocalPlaylistArtwork.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    context,
  );
  const track = { url: "local://D:\\songs\\song.mp3", cover: "" };
  const render = () => {
    index = 0;
    const result = context.exports.LocalPlaylistArtwork({ track });
    effects.splice(0).forEach((fn) => fn());
    return result;
  };
  assert.equal(render(), null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0].command, "get_audio_cover");
  assert.equal(calls[0].args.path, "D:\\songs\\song.mp3");
  assert.equal(render().props.src, "data:image/png;base64,cover");
  assert.equal(calls.length, 1);
});
