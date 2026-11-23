"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { probeProviderHealth } from "@/lib/ai/health";
import type { AppSettings, ProviderHealth } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

export function ProviderHealthStrip({
  settings,
  compact = false,
}: {
  settings: AppSettings;
  compact?: boolean;
}) {
  const [rows, setRows] = useState<ProviderHealth[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setRows(await probeProviderHealth(settings));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 20000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.jevApiKey,
    settings.ollamaUrl,
    settings.lmStudioUrl,
    settings.strictMindVaultMode,
    settings.openaiApiKey,
  ]);

  if (!rows.length) return null;

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      <div className="flex items-center justify-between">
        <span className="kicker">Provider health</span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="btn btn-ghost btn-sm h-6 px-1.5"
          aria-label="Refresh provider health"
        >
          <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <span
            key={r.id}
            className="chip h-7 max-w-full px-2"
            title={r.detail}
          >
            <span
              className={cn(
                "dot",
                r.status === "ok" && "text-good",
                r.status === "warn" && "text-warn",
                r.status === "down" && "text-danger",
                r.status === "skip" && "text-ink-faint opacity-50",
              )}
            />
            <span className="truncate text-[11px] font-medium">{r.label}</span>
          </span>
        ))}
      </div>
      {settings.strictMindVaultMode && (
        <p className="text-[11px] leading-snug text-ink-faint">
          Strict mode routes scoring local-first (LM Studio → Ollama → heuristics).
        </p>
      )}
    </div>
  );
}
