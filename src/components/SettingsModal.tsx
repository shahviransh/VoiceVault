"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, KeyRound, Server, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { INTERVIEW_TYPES } from "@/lib/ai/interview-types";
import { PROVIDERS, type ProviderTag } from "@/lib/ai/provider-meta";
import type { AppSettings, InterviewType } from "@/lib/ai/types";
import { detectLmStudioModels, detectOllamaModels } from "@/lib/ai/providers";
import { isTauri, ragApi } from "@/lib/tauri/rag";
import { cn } from "@/lib/utils";
import { FieldLabel, Switch } from "./ui/primitives";

const TAG_CLASS: Record<ProviderTag, string> = {
  Cloud: "chip",
  Local: "chip chip-good",
  Browser: "chip chip-accent",
  Offline: "chip chip-warn",
};

export function SettingsModal({
  open,
  settings,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSave: (s: AppSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [lmModels, setLmModels] = useState<string[] | null>(null);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    setOllamaModels(null);
    void detectOllamaModels(draft.ollamaUrl).then(setOllamaModels);
  }, [open, draft.ollamaUrl]);

  useEffect(() => {
    if (!open) return;
    setLmModels(null);
    void detectLmStudioModels(draft.lmStudioUrl).then((models) => {
      setLmModels(models);
      setDraft((s) =>
        !s.lmStudioModel && models[0] ? { ...s, lmStudioModel: models[0] } : s,
      );
    });
  }, [open, draft.lmStudioUrl]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = async () => {
    onSave(draft);
    if (isTauri()) {
      try {
        await ragApi.setEmbeddingPrefs(draft.ollamaUrl, draft.preferOllamaEmbeddings);
      } catch {
        /* backend prefs are best-effort */
      }
    }
    onClose();
  };

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((s) => ({ ...s, [key]: value }));

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-fade" onClick={onClose} />
      <aside
        className="absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col border-l border-line bg-bg-elev shadow-2xl animate-slide"
        role="dialog"
        aria-label="Settings"
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-5">
          <div>
            <div className="kicker">Preferences</div>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Settings</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-icon">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
          <Section icon={SlidersHorizontal} title="Scoring engine" subtitle="First choice; others are automatic fallbacks">
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => {
                const active = draft.preferredProvider === p.id;
                const cloudBlocked = p.tag === "Cloud" && p.id !== "jev" && draft.strictMindVaultMode;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set("preferredProvider", p.id)}
                    className={cn(
                      "relative rounded-xl border p-3 text-left transition",
                      active
                        ? "border-accent bg-accent-soft shadow-[0_0_0_3px_var(--accent-soft)]"
                        : "border-line bg-surface-2 hover:border-line-strong",
                      cloudBlocked && "opacity-55",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{p.label}</span>
                      {active ? (
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-fg">
                          <Check className="h-3 w-3" />
                        </span>
                      ) : (
                        <span className={cn(TAG_CLASS[p.tag], "h-5 px-1.5 text-[9px]")}>{p.tag}</span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-ink-faint">
                      {cloudBlocked ? "Blocked by Strict MindVault Mode" : p.blurb}
                    </p>
                  </button>
                );
              })}
            </div>
            <label className="mt-4 block">
              <FieldLabel hint={<span className="mono-num text-ink">{draft.confidenceThreshold.toFixed(2)}</span>}>
                Low-confidence threshold
              </FieldLabel>
              <input
                type="range"
                min={0.5}
                max={0.95}
                step={0.05}
                value={draft.confidenceThreshold}
                onChange={(e) => set("confidenceThreshold", Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </label>
            <label className="mt-3 block">
              <FieldLabel>Jev API key</FieldLabel>
              <input
                type="password"
                value={draft.jevApiKey}
                onChange={(e) => set("jevApiKey", e.target.value)}
                placeholder="ts_live_…"
                className="input mono-num"
              />
            </label>
          </Section>

          <Section icon={Server} title="Local desktop AI" subtitle="Runs on your machine — works offline">
            <ServerBlock
              name="LM Studio"
              models={lmModels}
              url={draft.lmStudioUrl}
              onUrl={(v) => set("lmStudioUrl", v)}
              offlineHint="Developer → Start Server (port 1234)"
            >
              {lmModels && lmModels.length > 0 && (
                <select
                  value={draft.lmStudioModel || lmModels[0]}
                  onChange={(e) => set("lmStudioModel", e.target.value)}
                  className="input mt-2"
                  aria-label="LM Studio model"
                >
                  {lmModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </ServerBlock>
            <ServerBlock
              name="Ollama"
              models={ollamaModels}
              url={draft.ollamaUrl}
              onUrl={(v) => set("ollamaUrl", v)}
              offlineHint="Run `ollama serve`"
            >
              <div className="mt-2">
                <Switch
                  label="Use Ollama for vault embeddings"
                  hint="Otherwise fastembed runs in-process"
                  checked={draft.preferOllamaEmbeddings}
                  onChange={(v) => set("preferOllamaEmbeddings", v)}
                />
              </div>
            </ServerBlock>
          </Section>

          <Section icon={ShieldCheck} title="Guardrails" subtitle="Keep practice independent">
            <div className="space-y-2">
              <Switch
                label="Strict MindVault Mode"
                hint="Local-first scoring (LM Studio → Ollama → heuristics); cloud deferred"
                checked={draft.strictMindVaultMode}
                onChange={(v) => set("strictMindVaultMode", v)}
              />
              <Switch
                label="Defer critique in Strict mode"
                hint="Score now, queue coach critique for later sync when cloud is allowed"
                checked={draft.deferCritiqueInStrictMode}
                onChange={(v) => set("deferCritiqueInStrictMode", v)}
              />
              <Switch
                label="Coach critique"
                hint="Only shown when confidence clears the threshold"
                checked={draft.enableCoachCritique}
                onChange={(v) => set("enableCoachCritique", v)}
              />
            </div>
            <label className="mt-4 block">
              <FieldLabel>Default interview type</FieldLabel>
              <select
                value={draft.defaultInterviewType}
                onChange={(e) => set("defaultInterviewType", e.target.value as InterviewType)}
                className="input"
              >
                {INTERVIEW_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} — {t.blurb}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block">
              <FieldLabel
                hint={
                  <span className="mono-num text-ink">{draft.checkpointIntervalSec}s</span>
                }
              >
                Mid-answer checkpoint interval
              </FieldLabel>
              <input
                type="range"
                min={10}
                max={45}
                step={5}
                value={draft.checkpointIntervalSec}
                onChange={(e) => set("checkpointIntervalSec", Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </label>
          </Section>

          <Section icon={KeyRound} title="Cloud keys" subtitle="Optional — stored locally only">
            <div className="space-y-3">
              {(
                [
                  ["openaiApiKey", "OpenAI", "sk-…"],
                  ["anthropicApiKey", "Anthropic", "sk-ant-…"],
                  ["geminiApiKey", "Gemini", "AIza…"],
                ] as const
              ).map(([key, label, ph]) => (
                <label key={key} className="block">
                  <FieldLabel>{label}</FieldLabel>
                  <input
                    type="password"
                    value={draft[key]}
                    onChange={(e) => set(key, e.target.value)}
                    placeholder={ph}
                    disabled={draft.strictMindVaultMode}
                    className="input mono-num disabled:opacity-50"
                  />
                </label>
              ))}
            </div>
          </Section>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} className="btn btn-primary">
            Save changes
          </button>
        </footer>
      </aside>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Server;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-accent" />
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-[11px] text-ink-faint">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ServerBlock({
  name,
  models,
  url,
  onUrl,
  offlineHint,
  children,
}: {
  name: string;
  models: string[] | null;
  url: string;
  onUrl: (v: string) => void;
  offlineHint: string;
  children?: ReactNode;
}) {
  const online = !!models && models.length > 0;
  return (
    <div className="card-inset mb-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">{name}</span>
        <span className={cn("chip h-6", models === null ? "" : online ? "chip-good" : "chip-warn")}>
          <span className={cn("dot", models === null && "animate-breathe")} />
          {models === null ? "Probing" : online ? `${models.length} model${models.length > 1 ? "s" : ""}` : "Offline"}
        </span>
      </div>
      <input value={url} onChange={(e) => onUrl(e.target.value)} className="input mono-num text-xs" />
      {models !== null && !online && <p className="mt-1.5 text-[11px] text-ink-faint">{offlineHint}</p>}
      {children}
    </div>
  );
}
