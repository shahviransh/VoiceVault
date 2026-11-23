export type ThemeMode = "light" | "dark" | "system";

const KEY = "voicevault.theme.v1";

export function loadThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = localStorage.getItem(KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function saveThemeMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, mode);
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
