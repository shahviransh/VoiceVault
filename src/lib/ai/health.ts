import { providerLabel } from "./provider-meta";
import type { AiProviderKind, AppSettings, ProviderHealth } from "./types";

type PromptApi = {
  availability: () => Promise<string>;
};

export async function probeProviderHealth(settings: AppSettings): Promise<ProviderHealth[]> {
  const checks: Array<() => Promise<ProviderHealth>> = [
    async () => {
      if (!settings.jevApiKey.trim()) {
        return row("jev", "warn", "API key not set");
      }
      if (settings.strictMindVaultMode) {
        return row("jev", "skip", "Strict mode - cloud scoring deferred");
      }
      try {
        const res = await fetch("https://api.typesafe.ai/v1/systemone", {
          method: "OPTIONS",
        }).catch(() => null);
        // Many APIs don't answer OPTIONS; treat key-present + network as ok-ish.
        if (res && (res.ok || res.status === 401 || res.status === 405 || res.status === 404)) {
          return row("jev", "ok", "Key present · reachable");
        }
        return row("jev", "ok", "Key present");
      } catch {
        return row("jev", "warn", "Key present · network unclear");
      }
    },
    async () => {
      try {
        const root = (settings.lmStudioUrl || "http://localhost:1234").replace(/\/$/, "");
        const res = await fetch(`${root}/v1/models`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) return row("lmstudio", "down", `HTTP ${res.status}`);
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        const n = data.data?.length ?? 0;
        return n
          ? row("lmstudio", "ok", `${n} model${n === 1 ? "" : "s"}`)
          : row("lmstudio", "warn", "Server up · no models");
      } catch {
        return row("lmstudio", "down", "Not reachable on :1234");
      }
    },
    async () => {
      try {
        const root = (settings.ollamaUrl || "http://localhost:11434").replace(/\/$/, "");
        const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) return row("ollama", "down", `HTTP ${res.status}`);
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        const n = data.models?.length ?? 0;
        return n
          ? row("ollama", "ok", `${n} model${n === 1 ? "" : "s"}`)
          : row("ollama", "warn", "Up · no models pulled");
      } catch {
        return row("ollama", "down", "ollama serve not running");
      }
    },
    async () => {
      const lm = (typeof window !== "undefined"
        ? (window as Window & { LanguageModel?: PromptApi }).LanguageModel
        : undefined);
      if (!lm) {
        return row("chrome_prompt", "down", "Prompt API unavailable");
      }
      try {
        const a = await lm.availability();
        if (a === "readily" || a === "available") return row("chrome_prompt", "ok", a);
        if (a === "after-download") return row("chrome_prompt", "warn", "needs download");
        return row("chrome_prompt", "down", a);
      } catch {
        return row("chrome_prompt", "down", "availability check failed");
      }
    },
    async () => {
      if (settings.strictMindVaultMode) {
        return row("openai", "skip", "Strict mode blocks BYOK");
      }
      return settings.openaiApiKey
        ? row("openai", "ok", "Key present")
        : row("openai", "skip", "No key");
    },
    async () => row("heuristic", "ok", "Always available"),
  ];

  return Promise.all(checks.map((fn) => fn()));
}

function row(
  id: AiProviderKind,
  status: ProviderHealth["status"],
  detail: string,
): ProviderHealth {
  return { id, label: providerLabel(id), status, detail };
}
