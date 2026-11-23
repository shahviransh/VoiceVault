"use client";

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  EyeOff,
  Link2,
  Minus,
  Quote,
  X,
} from "lucide-react";
import type { CalibratedScorecard, RetrievedChunk } from "@/lib/ai/types";
import type { DeliveryTelemetry } from "@/lib/ai/heuristics";
import { cn } from "@/lib/utils";
import { FallbackBanner } from "./FallbackBanner";
import { SegmentMeter } from "./ui/primitives";
import { ScoreRing } from "./ui/ScoreRing";

const ENGINE_LABEL: Record<CalibratedScorecard["engine"], string> = {
  jev: "Jev · System One",
  browser: "In-browser model",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  byok: "Cloud BYOK",
  heuristic: "Heuristic engine",
};

export function Scorecard({
  card,
  telemetry,
  said,
  evidence,
  revealed,
  onFollowUp,
  bridgeCompare,
}: {
  card: CalibratedScorecard;
  telemetry?: DeliveryTelemetry | null;
  said: string;
  evidence: RetrievedChunk[];
  revealed: boolean;
  onFollowUp?: (q: string) => void;
  bridgeCompare?: {
    writingStructure: number;
    speakingStructure: number;
    writingOverall: number;
    speakingOverall: number;
  } | null;
}) {
  const metrics = [
    { label: "Clarity", m: card.clarity, delta: card.delta?.clarity },
    { label: "Structure", m: card.structure, delta: card.delta?.structure },
    { label: "Conciseness", m: card.conciseness, delta: card.delta?.conciseness },
    { label: "Evidence alignment", m: card.evidenceAlignment, delta: card.delta?.evidenceAlignment },
  ];
  const nouls = [
    { label: "Answered directly", v: card.answeredPromptDirectly },
    { label: "Hit prep signals", v: card.hitPrepDocSignals },
    { label: "Real experience", v: card.backedByRealExperience },
    { label: "Avoided red flags", v: card.avoidedRedFlags },
  ];
  const strong = card.primaryGap === "Strong Delivery";
  const citedIds = new Set(card.citations?.map((c) => c.chunkId) ?? []);

  return (
    <section className="stagger mt-8 space-y-4">
      <FallbackBanner chain={card.fallbackChain} />

      <div className="card relative overflow-hidden p-6">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl"
          style={{ background: "var(--halo-1)" }}
        />
        <div className="relative flex flex-wrap items-center gap-6">
          <ScoreRing value={card.overall} />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="kicker">Debrief</span>
              <span className="chip">{ENGINE_LABEL[card.engine]}</span>
              {card.delta && (
                <span
                  className={cn(
                    "chip mono-num",
                    card.delta.overall > 0 && "chip-good",
                    card.delta.overall < 0 && "chip-warn",
                  )}
                >
                  <DeltaIcon v={card.delta.overall} /> vs last{" "}
                  {card.delta.previousOverall.toFixed(1)} → {fmtDelta(card.delta.overall)}
                </span>
              )}
            </div>
            <div>
              <div className="kicker mb-1">Primary gap</div>
              <h3
                className={cn(
                  "font-display text-2xl font-semibold tracking-tight sm:text-3xl",
                  strong ? "text-good" : "text-ink",
                )}
              >
                {card.primaryGap}
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="chip chip-accent">Tone: {card.deliveryTone}</span>
              <span className="chip mono-num">
                gap conf {(card.primaryGapConfidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {bridgeCompare && (
        <div className="card grid gap-3 p-4 sm:grid-cols-2">
          <div className="card-inset p-3">
            <div className="kicker">Writing → Speaking bridge</div>
            <p className="mt-2 text-sm text-ink-soft">
              Structure {bridgeCompare.writingStructure.toFixed(1)} →{" "}
              <span className="font-semibold text-ink">
                {bridgeCompare.speakingStructure.toFixed(1)}
              </span>{" "}
              ({fmtDelta(bridgeCompare.speakingStructure - bridgeCompare.writingStructure)})
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              Overall {bridgeCompare.writingOverall.toFixed(1)} →{" "}
              {bridgeCompare.speakingOverall.toFixed(1)}
            </p>
          </div>
          <p className="self-center text-sm text-ink-soft">
            Retelling out loud should keep structure while tightening delivery. Aim for speaking
            structure ≥ writing structure.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {metrics.map(({ label, m, delta }) => (
          <div key={label} className="card p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-ink">{label}</span>
              <span className="mono-num text-lg font-semibold text-ink">
                {m.score.toFixed(1)}
                <span className="text-xs text-ink-faint"> /10</span>
                {typeof delta === "number" && (
                  <span
                    className={cn(
                      "ml-2 text-xs",
                      delta > 0 && "text-good",
                      delta < 0 && "text-warn",
                      delta === 0 && "text-ink-faint",
                    )}
                  >
                    {fmtDelta(delta)}
                  </span>
                )}
              </span>
            </div>
            <SegmentMeter value={m.score} />
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex flex-1 items-center gap-2">
                <span className="kicker">conf</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-line-strong">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${m.confidence * 100}%`,
                      background: m.lowConfidence ? "var(--warn)" : "var(--ink-soft)",
                    }}
                  />
                </div>
                <span className="mono-num text-[11px] text-ink-soft">
                  {(m.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            {m.lowConfidence && (
              <div className="chip chip-warn mt-3">
                <AlertTriangle className="h-3 w-3" /> Low Confidence — Ambiguous Answer
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {nouls.map(({ label, v }) => {
          const hit = v >= 0.55;
          return (
            <div
              key={label}
              className={cn(
                "card p-4 transition",
                hit && "ring-1 ring-[color-mix(in_srgb,var(--good)_35%,transparent)]",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-full",
                    hit ? "bg-good text-bg" : "bg-surface-2 text-ink-faint",
                  )}
                >
                  {hit ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </span>
                <span className={cn("mono-num text-xl font-semibold", hit ? "text-good" : "text-ink-soft")}>
                  {(v * 100).toFixed(0)}
                  <span className="text-xs">%</span>
                </span>
              </div>
              <div className="mt-3 text-xs font-medium text-ink-soft">{label}</div>
            </div>
          );
        })}
      </div>

      {telemetry && (
        <div className="card grid grid-cols-2 divide-line p-0 sm:grid-cols-4 sm:divide-x">
          <Stat label="Avg WPM" value={telemetry.wpm.toFixed(0)} sub="target 120–160" />
          <Stat
            label="Early → late"
            value={`${telemetry.earlyWpm.toFixed(0)} → ${telemetry.lateWpm.toFixed(0)}`}
            sub="pace drift"
          />
          <Stat label="Fillers /100" value={telemetry.fillersPer100.toFixed(1)} sub={`${telemetry.fillerCount} total`} />
          <Stat label="Silence gaps" value={String(telemetry.silenceGaps)} sub="> 2.5s pauses" />
        </div>
      )}

      {card.critique && (
        <div className="card flex gap-3 border-l-2 p-4" style={{ borderLeftColor: "var(--accent)" }}>
          <Quote className="h-4 w-4 shrink-0 text-accent" />
          <p className="text-sm leading-relaxed text-ink-soft">{card.critique}</p>
        </div>
      )}

      {card.critiqueDeferred && (
        <div className="card flex gap-3 border-l-2 p-4" style={{ borderLeftColor: "var(--warn)" }}>
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
          <div>
            <div className="text-sm font-semibold text-ink">Coach critique deferred</div>
            <p className="mt-1 text-sm text-ink-soft">
              {card.critiqueDeferredReason ?? "Critique withheld for this attempt."}
            </p>
          </div>
        </div>
      )}

      {!!card.followUps?.length && (
        <div className="card p-5">
          <div className="kicker mb-3">Interviewer follow-ups</div>
          <ul className="space-y-2">
            {card.followUps.map((q) => (
              <li key={q} className="flex flex-wrap items-start justify-between gap-2 card-inset p-3">
                <p className="flex-1 text-sm leading-relaxed text-ink">{q}</p>
                {onFollowUp && (
                  <button
                    type="button"
                    onClick={() => onFollowUp(q)}
                    className="btn btn-secondary btn-sm"
                  >
                    Practice this
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!card.retrievalHints?.length && (
        <div className="card p-5">
          <div className="kicker mb-3">Vault suggestions</div>
          <ul className="space-y-2">
            {card.retrievalHints.map((h) => (
              <li key={`${h.docType}-${h.reason}`} className="card-inset p-3">
                <span className="chip chip-accent h-6">{h.label}</span>
                <p className="mt-2 text-sm text-ink-soft">{h.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card p-5">
          <div className="kicker mb-3">What you said</div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {said || <span className="text-ink-faint">—</span>}
          </p>
        </div>
        <div className="card p-5">
          <div className="kicker mb-3">{revealed ? "From your vault" : "Blind practice"}</div>
          {revealed ? (
            evidence.length ? (
              <ul className="space-y-3">
                {evidence.map((c) => {
                  const cited = citedIds.has(c.id);
                  const citation = card.citations?.find((x) => x.chunkId === c.id);
                  return (
                    <li
                      key={c.id}
                      className={cn(
                        "card-inset p-3 transition",
                        cited && "ring-1 ring-[color-mix(in_srgb,var(--accent)_45%,transparent)]",
                      )}
                    >
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="chip chip-accent h-6">{c.doc_type.replace(/_/g, " ")}</span>
                        {c.heading && (
                          <span className="truncate text-xs font-semibold text-ink-soft">{c.heading}</span>
                        )}
                        {cited && (
                          <span className="chip chip-good h-6">
                            <Link2 className="h-3 w-3" /> Cited
                            {citation ? ` · ${(citation.strength * 100).toFixed(0)}%` : ""}
                          </span>
                        )}
                      </div>
                      {citation && (
                        <p className="mb-1.5 text-[11px] text-accent">{citation.reason}</p>
                      )}
                      <p className="line-clamp-5 text-sm leading-relaxed text-ink-soft">{c.content}</p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-faint">No chunks retrieved.</p>
            )
          ) : (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <EyeOff className="h-4 w-4" /> Evidence stays hidden until you finish.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DeltaIcon({ v }: { v: number }) {
  if (v > 0) return <ArrowUpRight className="h-3 w-3" />;
  if (v < 0) return <ArrowDownRight className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

function fmtDelta(n: number): string {
  if (n > 0) return `+${n.toFixed(1)}`;
  if (n < 0) return n.toFixed(1);
  return "±0";
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="p-4">
      <div className="kicker">{label}</div>
      <div className="mono-num mt-1.5 text-xl font-semibold text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-faint">{sub}</div>
    </div>
  );
}
