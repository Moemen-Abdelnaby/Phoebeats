const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
  let index = 0,
    uuid = 0,
    tree;
  const slots = [],
    effects = [],
    downloads = [];
  const react = {
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
        },
      ];
    },
    useRef(value) {
      const i = index++;
      return (slots[i] ||= { current: value });
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
    window: { __TAURI_INTERNALS__: {} },
    crypto: { randomUUID: () => String(++uuid) },
    setTimeout,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "../utils/youtubeLink")
        return {
          normalizeYoutubeLink: (value) =>
            value.startsWith("https://youtu.be/") ? value : null,
        };
      if (name === "@tauri-apps/api/core")
        return {
          invoke: (command, args) =>
            command === "download_song"
              ? new Promise((resolve, reject) =>
                  downloads.push({ args, resolve, reject }),
                )
              : Promise.resolve(),
        };
      throw Error(name);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/components/YoutubeMp3Download.tsx", "utf8"),
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
  const render = () => {
    index = 0;
    tree = context.exports.YoutubeMp3Download({
      folder: "D:\\songs",
      progress: {},
      onDownloaded() {},
    });
    effects.splice(0).forEach((fn) => fn());
  };
  const nodes = () => {
    const result = [];
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") {
        result.push(n);
        walk(n.props?.children);
      }
    };
    walk(tree);
    return result;
  };
  const add = (links) => {
    render();
    nodes()
      .find((n) => n.type === "textarea")
      .props.onChange({ target: { value: links } });
    render();
    nodes()
      .find((n) => n.type === "form")
      .props.onSubmit({ preventDefault() {} });
    render();
    render();
  };
  return {
    downloads,
    render,
    nodes,
    add,
    async settle() {
      await flush();
      render();
      render();
    },
  };
}
test("queue runs sequentially, deduplicates and captures destination", async () => {
  const h = harness();
  h.add(
    "https://youtu.be/abcdefghijk\nhttps://youtu.be/abcdefghijk\nhttps://youtu.be/12345678901",
  );
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].args.path, "D:\\songs");
  assert.equal(h.downloads[0].args.format, "mp3");
  h.downloads[0].resolve();
  await h.settle();
  assert.equal(h.downloads.length, 2);
  h.downloads[1].resolve();
  await h.settle();
  assert.equal(h.downloads.length, 2);
});
test("failed jobs can be retried and queued jobs cancelled", async () => {
  const h = harness();
  h.add("https://youtu.be/abcdefghijk\nhttps://youtu.be/12345678901");
  const cancelButtons = h
    .nodes()
    .filter((n) => n.type === "button" && n.props.children === "Cancel");
  await cancelButtons[1].props.onClick();
  h.render();
  h.downloads[0].reject(Error("network"));
  await h.settle();
  assert.equal(h.downloads.length, 1);
  h.nodes()
    .find((n) => n.type === "button" && n.props.children === "Retry")
    .props.onClick();
  h.render();
  h.render();
  assert.equal(h.downloads.length, 2);
  h.downloads[1].resolve();
  await h.settle();
});
