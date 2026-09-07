export interface CssTheme {
  id: string;
  name: string;
  css: string;
}
export interface CssThemeSettings {
  themes: CssTheme[];
  activeId: string | null;
}
const key = "vg_cssThemes";
export const starterCss = `/* Custom CSS loads after the base theme.
   Edit the Phoebe tokens or target existing player classes. */
:root[data-theme="phoebe"] {
  --pb-cyan: #72d5f4;
  --pb-gold: #e2b56d;
  --pb-blur: 18px;
}

/* Example: .v-track { border-radius: 10px; } */
`;

// Recovery also works when persistent storage is full or unavailable.
export function disableCustomCss() {
  const style = document.getElementById("phoebeats-custom-css");
  if (style) style.textContent = "";
  try {
    sessionStorage.setItem("pb-css-safe-mode", "1");
  } catch {
    /* In-memory removal still succeeds. */
  }
  try {
    saveCssThemes({ ...readCssThemes(), activeId: null });
  } catch {
    /* Do not let storage block recovery. */
  }
  window.dispatchEvent(new Event("phoebeats-open-appearance"));
}
export function readCssThemes(): CssThemeSettings {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    const themes = Array.isArray(value.themes)
      ? value.themes.filter(
          (t: CssTheme) =>
            t &&
            typeof t.id === "string" &&
            typeof t.name === "string" &&
            typeof t.css === "string",
        )
      : [];
    return {
      themes,
      activeId: themes.some((t: CssTheme) => t.id === value.activeId)
        ? value.activeId
        : null,
    };
  } catch {
    return { themes: [], activeId: null };
  }
}
export function saveCssThemes(settings: CssThemeSettings) {
  localStorage.setItem(key, JSON.stringify(settings));
  window.dispatchEvent(new Event("phoebeats-css-themes"));
}
