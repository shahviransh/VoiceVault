"use client";

import { useEffect, useState } from "react";
import { Library, Mic, PenLine, Settings2, ShieldCheck, Zap } from "lucide-react";
import { providerLabel } from "@/lib/ai/provider-meta";
import type { AppSettings } from "@/lib/ai/types";
import { loadSettings, saveSettings } from "@/lib/settings";
import { applyTheme, loadThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme";
import {
  listDocumentsSafe,
  offlineStatusSafe,
  type DocumentRecord,
  type OfflineStatus,
} from "@/lib/tauri/rag";
import { cn } from "@/lib/utils";
import { KnowledgeVault } from "./KnowledgeVault";
import { OfflineIndicator } from "./OfflineIndicator";
import { ProofPointMode } from "./ProofPointMode";
import { SettingsModal } from "./SettingsModal";
import { SpeakingStudio } from "./SpeakingStudio";
import { ThemeToggle } from "./ThemeToggle";
import { WritingStudio } from "./WritingStudio";
import { LogoMark } from "./ui/LogoMark";
import { Kbd } from "./ui/primitives";

type Tab = "vault" | "speak" | "write" | "proof";

const NAV: { id: Tab; label: string; hint: string; icon: typeof Library; key: string }[] = [
  { id: "vault", label: "Knowledge Vault", hint: "Index your evidence", icon: Library, key: "1" },
  { id: "speak", label: "Speaking", hint: "Mock interview", icon: Mic, key: "2" },
  { id: "write", label: "Writing", hint: "Articulation drills", icon: PenLine, key: "3" },
  { id: "proof", label: "Proof-Point", hint: "30s defense", icon: Zap, key: "4" },
];

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

export function AppShell() {
  const [tab, setTab] = useState<Tab>("vault");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [offline, setOffline] = useState<OfflineStatus | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const mode = loadThemeMode();
    setThemeMode(mode);
    applyTheme(mode);
    setSettings(loadSettings());
    void listDocumentsSafe().then(setDocuments);
    void offlineStatusSafe().then(setOffline);
    const id = window.setInterval(() => {
      void offlineStatusSafe().then(setOffline);
    }, 15000);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (loadThemeMode() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onSystem);
    return () => {
      window.clearInterval(id);
      mq.removeEventListener("change", onSystem);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const hit = NAV.find((n) => n.key === e.key);
      if (hit) setTab(hit.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onThemeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    saveThemeMode(mode);
    applyTheme(mode);
  };

  if (!settings) {
    return (
      <div className="relative z-10 flex min-h-screen items-center justify-center gap-3 text-sm text-ink-soft">
        <LogoMark live /> Loading VoiceVault…
      </div>
    );
  }

  return (
    <div className="relative z-10 flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line bg-bg-elev/70 px-4 py-5 backdrop-blur-xl md:flex">
        <div className="flex items-center gap-3 px-1">
          <LogoMark live />
          <div>
            <div className="font-display text-lg font-semibold leading-none tracking-tight text-ink">
              VoiceVault
            </div>
            <div className="kicker mt-1">Practice studio</div>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          <div className="kicker mb-2 px-2">Studio</div>
          {NAV.map(({ id, label, hint, icon: Icon, key }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition",
                  active ? "bg-surface shadow-sm ring-1 ring-line" : "hover:bg-surface-2",
                )}
              >
                {active && (
                  <span className="absolute -left-4 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_12px_var(--glow)]" />
                )}
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition",
                    active
                      ? "border-transparent bg-accent-soft text-accent"
                      : "border-line bg-surface-2 text-ink-soft group-hover:text-ink",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm font-semibold",
                      active ? "text-ink" : "text-ink-soft group-hover:text-ink",
                    )}
                  >
                    {label}
                  </span>
                  <span className="block text-[11px] text-ink-faint">{hint}</span>
                </span>
                <Kbd>{key}</Kbd>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3 pt-6">
          <div className="card-inset space-y-2.5 p-3">
            <div className="flex items-center justify-between">
              <span className="kicker">System</span>
              <OfflineIndicator status={offline} />
            </div>
            <StatusRow label="Scoring" value={providerLabel(settings.preferredProvider)} />
            <StatusRow
              label="Embeddings"
              value={offline?.embedding_backend?.replace("fastembed:", "") ?? "—"}
            />
            <StatusRow
              label="Docs indexed"
              value={String(documents.length)}
            />
            {settings.strictMindVaultMode && (
              <div className="flex items-center gap-1.5 pt-0.5 text-[11px] font-semibold text-accent">
                <ShieldCheck className="h-3.5 w-3.5" /> Strict MindVault Mode
              </div>
            )}
          </div>
          <ThemeToggle mode={themeMode} onChange={onThemeChange} />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="btn btn-secondary w-full justify-between"
          >
            <span className="inline-flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Settings
            </span>
            <span className="mono-num text-[10px] text-ink-faint">Ctrl ,</span>
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-line bg-bg-elev/80 px-4 py-3 backdrop-blur-xl md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <LogoMark live className="h-8 w-8" />
              <span className="font-display text-base font-semibold text-ink">VoiceVault</span>
            </div>
            <div className="flex items-center gap-2">
              <OfflineIndicator status={offline} />
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="btn btn-secondary btn-icon"
                aria-label="Settings"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "chip h-8 shrink-0 px-3",
                  tab === id && "chip-accent",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </nav>
          <ThemeToggle mode={themeMode} onChange={onThemeChange} className="mt-3" />
        </header>

        <main key={tab} className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-10">
          {tab === "vault" && (
            <KnowledgeVault documents={documents} onDocumentsChange={setDocuments} />
          )}
          {tab === "speak" && <SpeakingStudio documents={documents} settings={settings} />}
          {tab === "write" && <WritingStudio documents={documents} settings={settings} />}
          {tab === "proof" && <ProofPointMode settings={settings} />}
        </main>
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={(s) => {
          setSettings(s);
          saveSettings(s);
        }}
      />
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-ink-faint">{label}</span>
      <span className="mono-num truncate font-medium text-ink-soft">{value}</span>
    </div>
  );
}
