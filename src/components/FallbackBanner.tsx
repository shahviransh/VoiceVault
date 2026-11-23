"use client";

import { ArrowRight, Info } from "lucide-react";
import { providerLabel } from "@/lib/ai/provider-meta";
import type { FallbackStep } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

export function FallbackBanner({ chain }: { chain?: FallbackStep[] | null }) {
  if (!chain?.length) return null;
  const winner = [...chain].reverse().find((s) => s.ok);
  const failed = chain.filter((s) => !s.ok);
  if (!winner) return null;
  // Only show when something actually fell through
  if (failed.length === 0 && chain.length === 1) return null;

  return (
    <div className="card flex gap-3 border-l-2 p-3" style={{ borderLeftColor: "var(--warn)" }}>
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="text-sm font-semibold text-ink">
          Scored via {providerLabel(winner.provider)}
          {winner.reason ? (
            <span className="font-normal text-ink-soft"> — {winner.reason}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-ink-faint">
          {chain.map((step, i) => (
            <span key={`${step.provider}-${i}`} className="inline-flex items-center gap-1">
              {i > 0 && <ArrowRight className="h-3 w-3 opacity-40" />}
              <span
                className={cn(
                  "chip h-6 px-2",
                  step.ok ? "chip-good" : "opacity-70",
                )}
                title={step.reason}
              >
                {providerLabel(step.provider)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
