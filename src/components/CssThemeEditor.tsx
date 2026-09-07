import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveFile } from "@tauri-apps/plugin-dialog";
import {
  readCssThemes,
  saveCssThemes,
  starterCss,
  disableCustomCss,
  CssThemeSettings,
} from "../hooks/cssThemes";

export function CssThemeEditor() {
  const [settings, setSettings] = useState(readCssThemes);
  const [selected, setSelected] = useState(
    settings.activeId || settings.themes[0]?.id || "",
  );
  const initial = settings.themes.find((t) => t.id === selected);
  const [name, setName] = useState(initial?.name || "My theme");
  const [css, setCss] = useState(initial?.css || starterCss);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const update = () => setSettings(readCssThemes());
    window.addEventListener("phoebeats-css-themes", update);
    return () => window.removeEventListener("phoebeats-css-themes", update);
  }, []);
  const commit = (next: CssThemeSettings) => {
    try {
      saveCssThemes(next);
      setSettings(next);
      return true;
    } catch {
      setMessage("Could not save theme. Browser storage may be full.");
      return false;
    }
  };
  const save = () => {
    if (!name.trim()) {
      setMessage("Enter a theme name.");
      return;
    }
    const id = selected || crypto.randomUUID();
    const theme = { id, name: name.trim(), css };
    const themes = selected
      ? settings.themes.map((t) => (t.id === id ? theme : t))
      : [...settings.themes, theme];
    try {
      sessionStorage.removeItem("pb-css-safe-mode");
    } catch {
      /* Optional recovery flag. */
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get("customCss") === "off") {
      url.searchParams.delete("customCss");
      window.history.replaceState(null, "", url);
    }
    if (commit({ themes, activeId: id })) {
      setSelected(id);
      setMessage("CSS saved and applied.");
    }
  };
  return (
    <section
      className="v-css-editor"
      style={{
        padding: 20,
        border: "1px solid var(--v-bdr2)",
        borderRadius: 12,
        background: "var(--v-bg1)",
        color: "var(--v-fg)",
        marginBottom: 20,
      }}
    >
      <h3 style={{ marginTop: 0 }}>Custom CSS</h3>
      <p>
        Active:{" "}
        {settings.themes.find((t) => t.id === settings.activeId)?.name ||
          "Built-in theme only"}
      </p>
      <p>
        Edit colors, typography, spacing, and player selectors. Apply saves your
        CSS over the base theme.
      </p>
      <p>
        Recovery: press Ctrl+Shift+F12 (Cmd+Shift+F12 on Mac) to disable custom
        CSS and open Appearance, even if CSS hides the interface.
      </p>
      <label>
        Saved theme{" "}
        <select
          value={selected}
          onChange={(e) => {
            const id = e.target.value;
            const theme = settings.themes.find((t) => t.id === id);
            setSelected(id);
            setName(theme?.name || "My theme");
            setCss(theme?.css || starterCss);
            setMessage("");
          }}
        >
          <option value="">New theme</option>
          {settings.themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "block", margin: "12px 0" }}>
        Theme name{" "}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label htmlFor="custom-theme-css">CSS source</label>
      <textarea
        id="custom-theme-css"
        value={css}
        onChange={(e) => setCss(e.target.value)}
        spellCheck={false}
        style={{
          display: "block",
          width: "100%",
          minHeight: 280,
          padding: 12,
          fontFamily: "monospace",
          background: "var(--v-bg0)",
          color: "var(--v-fg)",
          border: "1px solid var(--v-bdr2)",
          resize: "vertical",
        }}
      />
      <div
        style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}
      >
        <button className="v-btn pb-primary" onClick={save}>
          Apply
        </button>
        <button
          className="v-btn"
          aria-pressed={Boolean(settings.activeId)}
          onClick={() => {
            if (settings.activeId) {
              disableCustomCss();
              setSettings(readCssThemes());
              setMessage("Custom CSS disabled. Your source is preserved.");
            } else save();
          }}
        >
          {settings.activeId ? "Disable CSS" : "Enable CSS"}
        </button>
        <button
          className="v-btn"
          onClick={() => {
            disableCustomCss();
            const next = readCssThemes();
            if (
              commit({
                themes: next.themes.map((t) =>
                  t.id === selected ? { ...t, css: "" } : t,
                ),
                activeId: null,
              })
            ) {
              setCss("");
              setMessage("CSS reset. The base theme is active.");
            }
          }}
        >
          Reset CSS
        </button>
        <button
          className="v-btn"
          onClick={() => {
            setSelected("");
            setName("My theme");
            setCss(starterCss);
            setMessage("New theme draft.");
          }}
        >
          New theme
        </button>
        <label className="v-btn">
          Import CSS
          <input
            type="file"
            accept=".css,text/css"
            style={{ maxWidth: 200 }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const text = await file.text();
                setSelected("");
                setName(file.name.replace(/\.css$/i, ""));
                setCss(text);
                setMessage("Imported as a draft. Save & apply to activate.");
              } catch {
                setMessage("Could not read CSS file.");
              }
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="v-btn"
          onClick={async () => {
            if ("__TAURI_INTERNALS__" in window) {
              try {
                const path = await saveFile({
                  defaultPath: `${name.trim().replace(/[<>:"/\\|?*]/g, "-") || "theme"}.css`,
                  filters: [{ name: "CSS theme", extensions: ["css"] }],
                });
                if (path) {
                  await invoke("write_text_file", { path, content: css });
                  setMessage("CSS exported.");
                }
              } catch {
                setMessage("Could not export CSS.");
              }
              return;
            }
            const url = URL.createObjectURL(
              new Blob([css], { type: "text/css" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = `${name.trim() || "theme"}.css`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Export CSS
        </button>
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
