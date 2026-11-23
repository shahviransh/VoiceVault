"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Mic, Quote, Shuffle, Swords, Zap } from "lucide-react";
import type { AppSettings, CalibratedScorecard } from "@/lib/ai/types";
import { evaluateResponse } from "@/lib/ai/providers";
import { browserRag, isTauri, ragApi, type ChunkRecord } from "@/lib/tauri/rag";
import { LiveTranscriber } from "@/lib/speech/recognition";
import { cn } from "@/lib/utils";
import { Scorecard } from "./Scorecard";
import { Card, EmptyState, PageHeader, Segmented } from "./ui/primitives";

type Phase = "idle" | "defend" | "pushback" | "done";

const STEPS: { id: Phase; label: string }[] = [
  { id: "idle", label: "Pull" },
  { id: "defend", label: "Defend" },
  { id: "pushback", label: "Pushback" },
  { id: "done", label: "Debrief" },
];

const DEFEND_SECONDS = 30;

export function ProofPointMode({ settings }: { settings: AppSettings }) {
  const [chunk, setChunk] = useState<ChunkRecord | null>(null);
  const [mode, setMode] = useState<"speaking" | "writing">("speaking");
  const [response, setResponse] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [followAnswer, setFollowAnswer] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [card, setCard] = useState<CalibratedScorecard | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [scoring, setScoring] = useState(false);
  const [status, setStatus] = useState("");
  const transcriber = useRef(new LiveTranscriber());

  const recording = remaining !== null;

  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      transcriber.current.stop();
      setRemaining(null);
      setPhase("pushback");
      return;
    }
    const id = window.setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [remaining]);

  useEffect(() => () => transcriber.current.abort(), []);

  const pullChunk = async () => {
    setStatus("");
    setCard(null);
    setResponse("");
    setFollowAnswer("");
    try {
      const c = isTauri() ? await ragApi.getProofPoint() : await browserRag.getProofPoint();
      if (!c) {
        setStatus("Vault is empty — ingest documents first.");
        return;
      }
      setChunk(c);
      setFollowUp(buildPushback(c));
      setPhase("defend");
    } catch (e) {
      setStatus(String(e));
    }
  };

  const startSpeak = () => {
    setResponse("");
    setRemaining(DEFEND_SECONDS);
    transcriber.current.start({
      onPartial: setResponse,
      onFinal: setResponse,
      onError: (m) => setStatus(m),
    });
  };

  const stopEarly = () => {
    transcriber.current.stop();
    setRemaining(null);
    setPhase("pushback");
  };

  const scoreAll = async () => {
    if (!chunk) return;
    setScoring(true);
    const combined = `Defense:\n${response}\n\nFollow-up (${followUp}):\n${followAnswer}`;
    const scored = await evaluateResponse(
      {
        question: `Defend this proof-point: ${chunk.heading || chunk.content.slice(0, 120)}`,
        userResponse: combined,
        retrievedResumeChunks: [chunk],
        activePrepDocSignals: null,
        mode: "proof_point",
        interviewType: settings.defaultInterviewType ?? "behavioral",
      },
      settings,
    );
    setCard(scored);
    setScoring(false);
    setPhase("done");
  };

  const stepIndex = STEPS.findIndex((s) => s.id === phase);

  return (
    <div>
      <PageHeader
        index="04"
        kicker="Proof-Point"
        title="30-second defense"
        description="VoiceVault pulls a claim from your own vault. Defend it fast, then survive a targeted pushback."
        actions={
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "speaking", label: "Spoken", icon: Mic },
              { value: "writing", label: "Written", icon: Quote },
            ]}
          />
        }
      />

      <div className="stagger space-y-4">
        <Card className="p-4">
          <ol className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              return (
                <li key={s.id} className="flex flex-1 items-center gap-2">
                  <span
                    className={cn(
                      "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition mono-num",
                      done && "border-transparent bg-good text-bg",
                      current && "border-transparent bg-accent text-accent-fg shadow-[0_0_16px_-4px_var(--glow)]",
                      !done && !current && "border-line-strong text-ink-faint",
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      "hidden text-sm font-semibold sm:block",
                      current ? "text-ink" : "text-ink-faint",
                    )}
                  >
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && (
                    <span
                      className={cn("h-px flex-1", done ? "bg-good" : "bg-line-strong")}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </Card>

        {chunk ? (
          <Card className="relative overflow-hidden p-6">
            <Quote className="absolute -right-2 -top-4 h-28 w-28 text-accent opacity-[0.07]" />
            <div className="relative flex flex-wrap items-center gap-2">
              <span className="kicker">Proof-point</span>
              <span className="chip chip-accent">{chunk.doc_type.replace(/_/g, " ")}</span>
              {chunk.heading && <span className="text-sm font-semibold text-ink-soft">{chunk.heading}</span>}
              <button type="button" onClick={() => void pullChunk()} className="btn btn-ghost btn-sm ml-auto">
                <Shuffle className="h-3.5 w-3.5" /> Another
              </button>
            </div>
            <p className="relative mt-4 line-clamp-6 whitespace-pre-wrap border-l-2 border-accent pl-4 text-[15px] leading-relaxed text-ink">
              {chunk.content}
            </p>
          </Card>
        ) : (
          <Card className="p-6">
            <EmptyState
              icon={Zap}
              title="Pull a proof-point to begin"
              body="A random chunk from your resume, story bank, or prep docs becomes the claim you have to defend."
            />
            <div className="mt-4 flex justify-center">
              <button type="button" onClick={() => void pullChunk()} className="btn btn-primary">
                <Zap className="h-4 w-4" /> Pull proof-point
              </button>
            </div>
            {status && <p className="mt-3 text-center text-xs text-ink-soft">{status}</p>}
          </Card>
        )}

        {phase === "defend" && (
          <Card className="p-5 animate-rise">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="kicker">Your defense</span>
              {mode === "speaking" && (
                <>
                  {recording ? (
                    <button type="button" onClick={stopEarly} className="btn btn-danger btn-sm ml-auto">
                      Stop · <span className="mono-num">{remaining}s</span>
                    </button>
                  ) : (
                    <button type="button" onClick={startSpeak} className="btn btn-primary btn-sm ml-auto">
                      <Mic className="h-3.5 w-3.5" /> Start 30s
                    </button>
                  )}
                </>
              )}
            </div>
            {recording && (
              <div className="mb-3 h-1 overflow-hidden rounded-full bg-line-strong">
                <div
                  className="h-full rounded-full bg-danger transition-all duration-1000 ease-linear"
                  style={{ width: `${((remaining ?? 0) / DEFEND_SECONDS) * 100}%` }}
                />
              </div>
            )}
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={6}
              placeholder={mode === "speaking" ? "Your spoken defense appears here…" : "Defend the claim in a few tight sentences…"}
              className={cn("input resize-y leading-relaxed", recording && "caret")}
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setPhase("pushback")}
                disabled={recording || !response.trim()}
                className="btn btn-secondary"
              >
                Continue to pushback <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </Card>
        )}

        {phase === "pushback" && (
          <Card className="relative overflow-hidden p-5 animate-rise">
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-1"
              style={{ background: "linear-gradient(var(--accent-2), var(--accent))" }}
            />
            <div className="kicker flex items-center gap-2">
              <Swords className="h-3.5 w-3.5 text-accent" /> Interviewer pushback
            </div>
            <p className="mt-2 font-display text-xl font-medium leading-snug text-ink">{followUp}</p>
            <textarea
              value={followAnswer}
              onChange={(e) => setFollowAnswer(e.target.value)}
              rows={5}
              className="input mt-4 resize-y leading-relaxed"
              placeholder="Hold your ground with specifics…"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void scoreAll()}
                disabled={scoring || !followAnswer.trim()}
                className="btn btn-primary"
              >
                {scoring ? "Scoring…" : "Score round"}
              </button>
            </div>
          </Card>
        )}
      </div>

      {card && chunk && (
        <Scorecard
          card={card}
          said={`${response}\n\n${followAnswer}`.trim()}
          evidence={[chunk]}
          revealed
          onFollowUp={(q) => {
            setFollowUp(q);
            setFollowAnswer("");
            setPhase("pushback");
            setCard(null);
          }}
        />
      )}
    </div>
  );
}

function buildPushback(chunk: ChunkRecord): string {
  const hint = chunk.heading || chunk.content.split(/\s+/).slice(0, 8).join(" ");
  const prompts = [
    `What would you have done differently on "${hint}"?`,
    `How did you measure success for "${hint}"?`,
    `What was the hardest tradeoff in "${hint}"?`,
    `Who disagreed with your approach on "${hint}", and how did you resolve it?`,
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}
