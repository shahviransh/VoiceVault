import type { AppSettings } from "./ai/types";

const KEY = "voicevault.settings.v1";

export const DEFAULT_SETTINGS: AppSettings = {
  jevApiKey: "",
  ollamaUrl: "http://localhost:11434",
  preferOllamaEmbeddings: false,
  lmStudioUrl: "http://localhost:1234",
  lmStudioModel: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  geminiApiKey: "",
  strictMindVaultMode: true,
  confidenceThreshold: 0.7,
  preferredProvider: "jev",
  enableCoachCritique: false,
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(settings));
}
