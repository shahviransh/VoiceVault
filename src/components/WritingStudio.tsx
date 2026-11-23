"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Lock, Mic, PenLine, Play, RotateCcw, Sparkles, Target } from "lucide-react";
import type { AppSettings, CalibratedScorecard, InterviewType } from "@/lib/ai/types";
import { INTERVIEW_TYPES } from "@/lib/ai/interview-types";
import { evaluateResponse } from "@/lib/ai/providers";
import {
  browserRag,
  isTauri,
  ragApi,
  retrieveSafe,
  type DocumentRecord,
  type PrepMetadata,
} from "@/lib/tauri/rag";
import { cn, downloadTextFile } from "@/lib/utils";
import { Scorecard } from "./Scorecard";
import { Card, PageHeader, Segmented } from "./ui/primitives";

const TIMER_PRESETS = [
  { value: "120", label: "2 min" },
  { value: "300", label: "5 min" },
  { value: "480", label: "8 min" },
  { value: "600", label: "10 min" },
] as const;

type TimerPreset = (typeof TIMER_PRESETS)[number]["value"];

export function WritingStudio({
  documents,
  settings,
  onBridgeToSpeaking,
}: {
  documents: DocumentRecord[];
  settings: AppSettings;
  onBridgeToSpeaking?: (seed: { prompt: string; writingCard: CalibratedScorecard }) => void;
}) {
  const prepDocs = documents.filter((d) => d.doc_type === "career_ops_prep");
  const [prepId, setPrepId] = useState("");
  const [prepMeta, setPrepMeta] = useState<PrepMetadata | null>(null);
  const [interviewType, setInterviewType] = useState<InterviewType>(
    settings.defaultInterviewType ?? "behavioral",
  );
  const [prompt, setPrompt] = useState(
    "Explain your system architecture tradeoff in under 150 words.",
  );
  const [preset, setPreset] = useState<TimerPreset>("480");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [pasteBlocked, setPasteBlocked] = useState(0);
  const [pasteFlash, setPasteFlash] = useState(false);
  const [card, setCard] = useState<CalibratedScorecard | null>(null);
  const [evidence, setEvidence] = useState<
    Awaited<ReturnType<typeof retrieveSafe>>["chunks"]
  >([]);
  const [status, setStatus] = useState("");
  const [scoring, setScoring] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const seconds = Number(preset);

  useEffect(() => {
    if (!prepId && prepDocs[0]) setPrepId(prepDocs[0].id);
  }, [prepDocs, prepId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!prepId) {
        setPrepMeta(null);
        return;
      }
      const meta = isTauri()
        ? await ragApi.getPrepMetadata(prepId)
        : await browserRag.getPrepMetadata(prepId);
      if (!cancelled) setPrepMeta(meta);
    })();
    return () => {
      cancelled = true;
    };
  }, [prepId]);

  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      setStatus("Time's up - score what you have.");
      return;
    }
    const id = window.setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [remaining]);

  const wordCount = useMemo(
    () => (draft.trim() ? draft.trim().split(/\s+/).length : 0),
    [draft],
  );
  const wordTarget = useMemo(() => {
    const m = prompt.match(/under\s+(\d+)\s+words/i);
    return m ? Number(m[1]) : 150;
  }, [prompt]);

  const running = remaining !== null && remaining > 0;
  const timeProgress = remaining === null ? 0 : 1 - remaining / seconds;
  const overTarget = wordCount > wordTarget;

  const startTimer = () => {
    setCard(null);
    setSessionId(null);
    setRemaining(seconds);
    setStatus("Focus Lock on - draft from memory");
  };

  const reset = () => {
    setRemaining(null);
    setDraft("");
    setCard(null);
    setSessionId(null);
    setStatus("");
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    setPasteBlocked((n) => n + 1);
    setPasteFlash(true);
    window.setTimeout(() => setPasteFlash(false), 700);
    setStatus("Paste blocked. Draft from memory.");
  };

  const scoreDraft = async () => {
    setScoring(true);
    setRemaining(null);
    setStatus("Retrieving evidence & scoring");
    const ctx = await retrieveSafe(prompt, prepId || null, 6);
    setEvidence(ctx.chunks);
    const scored = await evaluateResponse(
      {
        question: prompt,
        userResponse: draft,
        retrievedResumeChunks: ctx.chunks,
        activePrepDocSignals: ctx.prep_signals ?? prepMeta,
        mode: "writing",
        interviewType,
      },
      settings,
      undefined,
      (p) => setStatus(p.phase),
    );
    setCard(scored);
    setScoring(false);
    setStatus("Writing debrief ready");
    try {
      const payload = {
        mode: "writing",
        question: prompt,
        response: draft,
        scores_json: JSON.stringify(scored),
      };
      const session = isTauri()
        ? await ragApi.saveSession(payload)
        : await browserRag.saveSession(payload);
      setSessionId(session.id);
    } catch {
      /* session history is optional */
    }
  };

  const exportDebrief = async () => {
    if (!sessionId) return;
    const md = isTauri()
      ? await ragApi.exportSessionMd(sessionId)
      : await browserRag.exportSessionMd(sessionId);
    downloadTextFile(`voicevault-writing-${sessionId.slice(0, 8)}.md`, md);
  };

  const usePrepPrompt = () => {
    const qs = prepMeta?.questions ?? [];
    if (!qs.length) return;
    const q = qs[Math.floor(Math.random() * qs.length)];
    setPrompt(`In under 150 words, answer: ${q}`);
  };

  return (
    <div>
      <PageHeader
        index="03"
        kicker="Writing"
        title="Articulation drills"
        description="Timed prompts with Focus Lock. Score the draft, then bridge into a spoken retell."
        actions={
          <select
            value={prepId}
            onChange={(e) => setPrepId(e.target.value)}
            className="input h-10 w-auto min-w-[200px] py-0"
            aria-label="Prep doc"
          >
            <option value="">General</option>
            {prepDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        }
      />

      <div className="stagger space-y-4">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="kicker">Interview type</span>
            <Segmented
              value={interviewType}
              onChange={(v) => setInterviewType(v as InterviewType)}
              options={INTERVIEW_TYPES.map((t) => ({ value: t.id, label: t.label }))}
            />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="kicker flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-accent" /> Prompt
            </span>
            <button
              type="button"
              onClick={usePrepPrompt}
              disabled={!prepMeta?.questions?.length || running}
              className="btn btn-ghost btn-sm"
            >
              <Sparkles className="h-3.5 w-3.5" /> From prep doc
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            disabled={running}
            className="mt-3 w-full resize-none bg-transparent font-display text-2xl font-medium leading-snug tracking-tight text-ink outline-none"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Segmented value={preset} onChange={setPreset} options={[...TIMER_PRESETS]} />
            {remaining === null ? (
              <button type="button" onClick={startTimer} className="btn btn-primary">
                <Play className="h-4 w-4" fill="currentColor" /> Start drill
              </button>
            ) : (
              <button type="button" onClick={reset} className="btn btn-secondary">
                <RotateCcw className="h-4 w-4" /> Reset
              </button>
            )}
          </div>
        </Card>

        <Card
          className={cn(
            "overflow-hidden transition",
            pasteFlash && "ring-2 ring-danger",
            running && !pasteFlash && "ring-1 ring-accent-soft",
          )}
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <span className={cn("chip", running ? "chip-accent" : "")}>
              <Lock className="h-3 w-3" /> Focus Lock
              {pasteBlocked > 0 && (
                <span className="mono-num text-danger">· {pasteBlocked} blocked</span>
              )}
            </span>
            <span className="chip mono-num">
              <span className={overTarget ? "text-warn" : "text-ink"}>{wordCount}</span> / {wordTarget}{" "}
              words
            </span>
            <div className="ml-auto flex items-center gap-3">
              {remaining !== null && (
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-line-strong">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-1000 ease-linear"
                    style={{ width: `${timeProgress * 100}%` }}
                  />
                </div>
              )}
              <span
                className={cn(
                  "mono-num text-xl font-semibold",
                  remaining !== null && remaining <= 30 ? "text-danger" : "text-ink",
                )}
              >
                {fmt(remaining ?? seconds)}
              </span>
            </div>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={onPaste}
            onDrop={(e) => e.preventDefault()}
            rows={13}
            placeholder="Start typing from memory…"
            className="block w-full resize-y bg-transparent px-6 py-5 text-[15px] leading-7 text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={() => void scoreDraft()}
              disabled={!draft.trim() || scoring}
              className="btn btn-primary"
            >
              <PenLine className="h-4 w-4" /> {scoring ? "Scoring…" : "Score draft"}
            </button>
            {card && onBridgeToSpeaking && (
              <button
                type="button"
                onClick={() => onBridgeToSpeaking({ prompt, writingCard: card })}
                className="btn btn-secondary"
              >
                <Mic className="h-4 w-4" /> Retell aloud (bridge)
              </button>
            )}
            {sessionId && (
              <button type="button" onClick={() => void exportDebrief()} className="btn btn-secondary">
                <Download className="h-4 w-4" /> Export .md
              </button>
            )}
            {status && <span className="text-xs text-ink-soft">{status}</span>}
          </div>
        </Card>
      </div>

      {card && (
        <Scorecard
          card={card}
          said={draft}
          evidence={evidence}
          revealed
          onFollowUp={(q) => {
            setPrompt(`In under 150 words, answer: ${q}`);
            setCard(null);
            setStatus("Follow-up prompt loaded");
          }}
        />
      )}
    </div>
  );
}

function fmt(sec: number) {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
