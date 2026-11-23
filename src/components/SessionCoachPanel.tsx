"use client";

import { useState } from "react";
import { ClipboardList, Loader2, Sparkles } from "lucide-react";
import { summarizeSession } from "@/lib/ai/coach";
import type { AppSettings, SessionAttempt, SessionCoachSummary } from "@/lib/ai/types";
import { Card } from "./ui/primitives";

export function SessionCoachPanel({
  attempts,
  settings,
}: {
  attempts: SessionAttempt[];
  settings: AppSettings;
}) {
  const [summary, setSummary] = useState<SessionCoachSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (attempts.length < 1) return null;

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      setSummary(await summarizeSession(attempts, settings));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="kicker flex items-center gap-2">
            <ClipboardList className="h-3.5 w-3.5 text-accent" /> Session coach
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {attempts.length} attempt{attempts.length === 1 ? "" : "s"} this session - synthesize gaps
            and a next-day plan.
          </p>
        </div>
        <button type="button" onClick={() => void run()} disabled={busy} className="btn btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Synthesizing…" : "End-of-session summary"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {summary && (
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <List title="Top gaps" items={summary.topGaps} />
          <List title="Wins" items={summary.wins} />
          <List title="Practice plan" items={summary.practicePlan} />
          <div className="sm:col-span-3 flex flex-wrap gap-2">
            <span className="chip mono-num">avg {summary.averageOverall.toFixed(1)} /10</span>
            <span className="chip">{summary.attemptCount} reps</span>
            <span className="chip">{summary.engine}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="card-inset p-3">
      <div className="kicker mb-2">{title}</div>
      <ul className="space-y-1.5 text-sm text-ink-soft">
        {items.map((item) => (
          <li key={item} className="leading-snug">
            · {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
