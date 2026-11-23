"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Download,
  EyeOff,
  Mic,
  MessageSquareQuote,
  Shuffle,
  Sparkles,
  Square,
  Timer,
  Volume2,
} from "lucide-react";
import {
  companySignalPrompts,
  generateMockQuestions,
} from "@/lib/ai/coach";
import { INTERVIEW_TYPES } from "@/lib/ai/interview-types";
import type {
  AppSettings,
  BridgeCompare,
  CalibratedScorecard,
  GeneratedQuestion,
  InterviewType,
  LiveCheckpoint,
  SessionAttempt,
} from "@/lib/ai/types";
import {
  buildTelemetry,
  evaluateLiveCheckpoints,
  evaluateResponse,
  telemetryToSpeech,
} from "@/lib/ai/providers";
import type { DeliveryTelemetry } from "@/lib/ai/heuristics";
import {
  browserRag,
  isTauri,
  ragApi,
  retrieveSafe,
  type DocumentRecord,
  type PrepMetadata,
  type RetrieveResult,
} from "@/lib/tauri/rag";
import { LiveTranscriber, LocalAudioRecorder, speakAsInterviewer } from "@/lib/speech/recognition";
import { PaceTracker, countFillers } from "@/lib/speech/telemetry";
import { cn, downloadTextFile } from "@/lib/utils";
import { Scorecard } from "./Scorecard";
import { SessionCoachPanel } from "./SessionCoachPanel";
import { LiveWaveform } from "./ui/LiveWaveform";
import { Card, PageHeader, Segmented } from "./ui/primitives";

const FALLBACK_QUESTION = "Tell me about a time you owned a high-impact technical decision.";

export function SpeakingStudio({
  documents,
  settings,
  bridgeSeed,
  onBridgeComplete,
}: {
  documents: DocumentRecord[];
  settings: AppSettings;
  bridgeSeed?: {
    prompt: string;
    writingCard: CalibratedScorecard;
  } | null;
  onBridgeComplete?: () => void;
}) {
  const prepDocs = documents.filter((d) => d.doc_type === "career_ops_prep");
  const [prepId, setPrepId] = useState<string>("");
  const [prepMeta, setPrepMeta] = useState<PrepMetadata | null>(null);
  const [interviewType, setInterviewType] = useState<InterviewType>(
    settings.defaultInterviewType ?? "behavioral",
  );
  const [companyDrill, setCompanyDrill] = useState(false);
  const [question, setQuestion] = useState(FALLBACK_QUESTION);
  const [generated, setGenerated] = useState<GeneratedQuestion[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [checkpoints, setCheckpoints] = useState<LiveCheckpoint[]>([]);
  const [retrieved, setRetrieved] = useState<RetrieveResult | null>(null);
  const [card, setCard] = useState<CalibratedScorecard | null>(null);
  const [telemetry, setTelemetry] = useState<DeliveryTelemetry | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<SessionAttempt[]>([]);
  const [bridgeCompare, setBridgeCompare] = useState<BridgeCompare | null>(null);

  const transcriber = useRef(new LiveTranscriber());
  const recorder = useRef(new LocalAudioRecorder());
  const pace = useRef(new PaceTracker());
  const checkpointTimer = useRef<number | null>(null);
  const countdownTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!prepId && prepDocs[0]) setPrepId(prepDocs[0].id);
  }, [prepDocs, prepId]);

  useEffect(() => {
    if (bridgeSeed?.prompt) {
      setQuestion(bridgeSeed.prompt);
      setStatus("Writing → Speaking bridge — retell your draft out loud");
    }
  }, [bridgeSeed]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!prepId) {
        setPrepMeta(null);
        return;
      }
      try {
        const meta = isTauri()
          ? await ragApi.getPrepMetadata(prepId)
          : await browserRag.getPrepMetadata(prepId);
        if (!cancelled) {
          setPrepMeta(meta);
          if (!bridgeSeed && meta?.questions?.[0]) setQuestion(meta.questions[0]);
        }
      } catch {
        if (!cancelled) setPrepMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prepId, bridgeSeed]);

  useEffect(() => {
    if (!recording) return;
    const start = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((Date.now() - start) / 1000), 250);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(
    () => () => {
      if (countdownTimer.current) window.clearInterval(countdownTimer.current);
      if (checkpointTimer.current) window.clearInterval(checkpointTimer.current);
    },
    [],
  );

  const questions = useMemo(() => {
    if (companyDrill) return companySignalPrompts(prepMeta);
    if (generated.length) return generated.map((g) => g.text);
    return prepMeta?.questions ?? [];
  }, [prepMeta, companyDrill, generated]);

  const shuffleQuestion = () => {
    if (!questions.length) {
      setQuestion(FALLBACK_QUESTION);
      return;
    }
    setQuestion(questions[Math.floor(Math.random() * questions.length)]);
  };

  const generateQuestions = async () => {
    setGenBusy(true);
    setStatus("Generating personal mock set…");
    try {
      const ctx = await retrieveSafe(
        prepMeta?.target_keywords?.join(" ") || "interview experience ownership impact",
        prepId || null,
        10,
      );
      const qs = await generateMockQuestions(
        ctx.chunks,
        ctx.prep_signals ?? prepMeta,
        settings,
        interviewType,
        6,
      );
      setGenerated(qs);
      if (qs[0]) setQuestion(qs[0].text);
      setCompanyDrill(false);
      setStatus(`Generated ${qs.length} questions`);
    } catch (e) {
      setStatus(String(e));
    } finally {
      setGenBusy(false);
    }
  };

  const cancelCountdown = () => {
    if (countdownTimer.current) window.clearInterval(countdownTimer.current);
    countdownTimer.current = null;
    setCountdown(null);
  };

  const startPrepCountdown = () => {
    setCountdown(30);
    countdownTimer.current = window.setInterval(() => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          cancelCountdown();
          void beginRecording();
          return null;
        }
        return c - 1;
      });
    }, 1000);
  };

  const beginRecording = async () => {
    cancelCountdown();
    setCard(null);
    setTelemetry(null);
    setBridgeCompare(null);
    setRevealed(false);
    setTranscript("");
    setCheckpoints([]);
    setSessionId(null);
    setAudioUrl(null);
    setStatus("Listening");
    setRecording(true);
    pace.current.start();

    const ctx = await retrieveSafe(question, prepId || null, 6);
    setRetrieved(ctx);

    try {
      await recorder.current.start();
      setStream(recorder.current.getStream());
    } catch {
      setStatus("Mic unavailable — transcript-only mode");
    }

    transcriber.current.start({
      onPartial: (text) => {
        setTranscript(text);
        pace.current.tick(text);
      },
      onFinal: (text) => {
        setTranscript(text);
        pace.current.tick(text);
      },
      onError: (msg) => setStatus(msg),
    });

    const intervalMs = Math.max(8, settings.checkpointIntervalSec || 25) * 1000;
    if (checkpointTimer.current) window.clearInterval(checkpointTimer.current);
    checkpointTimer.current = window.setInterval(async () => {
      const text = transcriber.current.getFinalText();
      if (!text.trim()) return;
      const cps = await evaluateLiveCheckpoints(
        text,
        question,
        {
          activePrepDocSignals: ctx.prep_signals ?? prepMeta,
          retrievedResumeChunks: ctx.chunks,
          interviewType,
        },
        settings,
      );
      setCheckpoints(cps);
    }, intervalMs);
  };

  const stopAndScore = async () => {
    setRecording(false);
    setScoring(true);
    if (checkpointTimer.current) {
      window.clearInterval(checkpointTimer.current);
      checkpointTimer.current = null;
    }
    transcriber.current.stop();
    const blob = await recorder.current.stop();
    setStream(null);
    if (blob) setAudioUrl(URL.createObjectURL(blob));

    const text = transcriber.current.getFinalText() || transcript;
    setTranscript(text);
    setStatus("Scoring");

    const snap = pace.current.snapshot();
    const ctx = retrieved ?? (await retrieveSafe(question, prepId || null, 6));
    setRetrieved(ctx);

    const input = {
      question,
      userResponse: text,
      retrievedResumeChunks: ctx.chunks,
      activePrepDocSignals: ctx.prep_signals ?? prepMeta,
      mode: bridgeSeed ? ("bridge" as const) : ("speaking" as const),
      interviewType,
    };
    const tel = buildTelemetry(
      text,
      snap.durationSec,
      snap.silenceGaps,
      snap.earlyWpm,
      snap.lateWpm,
      input,
    );
    setTelemetry(tel);

    const scored = await evaluateResponse(
      { ...input, speechMetrics: telemetryToSpeech(tel) },
      settings,
      tel,
      (p) => setStatus(p.phase),
    );
    setCard(scored);
    setRevealed(true);
    setScoring(false);
    setStatus("Debrief ready");

    if (bridgeSeed?.writingCard) {
      setBridgeCompare({
        writingStructure: bridgeSeed.writingCard.structure.score,
        speakingStructure: scored.structure.score,
        writingOverall: bridgeSeed.writingCard.overall,
        speakingOverall: scored.overall,
        structureDelta: scored.structure.score - bridgeSeed.writingCard.structure.score,
      });
      onBridgeComplete?.();
    }

    setAttempts((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        question,
        overall: scored.overall,
        primaryGap: scored.primaryGap,
        interviewType,
        mode: bridgeSeed ? "bridge" : companyDrill ? "company_drill" : "speaking",
        at: Date.now(),
      },
    ]);

    try {
      const payload = {
        mode: bridgeSeed ? "bridge" : "speaking",
        question,
        response: text,
        scores_json: JSON.stringify({ card: scored, telemetry: tel }),
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
    downloadTextFile(`voicevault-speaking-${sessionId.slice(0, 8)}.md`, md);
  };

  const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  const fillers = countFillers(transcript);
  const liveWpm = recording
    ? elapsed > 3
      ? (words / elapsed) * 60
      : 0
    : (telemetry?.wpm ?? 0);
  const paceTone =
    liveWpm === 0 ? "text-ink" : liveWpm < 110 || liveWpm > 175 ? "text-warn" : "text-good";

  return (
    <div>
      <PageHeader
        index="02"
        kicker="Speaking"
        title={bridgeSeed ? "Bridge retell" : "Mock interview"}
        description={
          bridgeSeed
            ? "Speak the same outline you just wrote. We’ll compare structure scores."
            : "Answer out loud. Mid-answer checkpoints, company-signal drills, and calibrated scorecards with vault citations."
        }
        actions={
          <select
            value={prepId}
            onChange={(e) => setPrepId(e.target.value)}
            className="input h-10 w-auto min-w-[220px] py-0"
            aria-label="Active prep doc"
          >
            <option value="">General Profile Mode</option>
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
            <button
              type="button"
              onClick={() => {
                setCompanyDrill((v) => !v);
                if (!companyDrill) {
                  const qs = companySignalPrompts(prepMeta);
                  if (qs[0]) setQuestion(qs[0]);
                }
              }}
              disabled={recording || !prepMeta}
              className={cn("btn btn-sm", companyDrill ? "btn-primary" : "btn-secondary")}
            >
              <Building2 className="h-3.5 w-3.5" /> Company-signal drill
            </button>
            <button
              type="button"
              onClick={() => void generateQuestions()}
              disabled={recording || genBusy}
              className="btn btn-secondary btn-sm"
            >
              <Sparkles className="h-3.5 w-3.5" /> {genBusy ? "Generating…" : "Generate mock set"}
            </button>
          </div>
        </Card>

        <Card className="relative overflow-hidden p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="kicker flex items-center gap-2">
              <MessageSquareQuote className="h-3.5 w-3.5 text-accent" /> Interviewer asks
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => speakAsInterviewer(question)}
                disabled={recording}
                className="btn btn-ghost btn-sm"
              >
                <Volume2 className="h-3.5 w-3.5" /> Read aloud
              </button>
              <button
                type="button"
                onClick={shuffleQuestion}
                disabled={recording}
                className="btn btn-ghost btn-sm"
              >
                <Shuffle className="h-3.5 w-3.5" /> Shuffle
              </button>
            </div>
          </div>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            disabled={recording}
            className="mt-3 w-full resize-none bg-transparent font-display text-2xl font-medium leading-snug tracking-tight text-ink outline-none placeholder:text-ink-faint sm:text-[1.75rem]"
          />
          {questions.length > 1 && !recording && (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {questions.slice(0, 8).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuestion(q)}
                  className={cn(
                    "chip h-auto max-w-[280px] shrink-0 py-1.5 text-left leading-snug",
                    q === question && "chip-accent",
                  )}
                  title={q}
                >
                  <span className="truncate">{q}</span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="relative overflow-hidden p-5">
          {recording && (
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{
                background:
                  "radial-gradient(600px 200px at 15% 50%, color-mix(in srgb, var(--danger) 10%, transparent), transparent 70%)",
              }}
            />
          )}
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => void (recording ? stopAndScore() : beginRecording())}
                disabled={scoring}
                aria-label={recording ? "Stop and score" : "Start answer"}
                className="group relative grid h-20 w-20 shrink-0 place-items-center rounded-full disabled:opacity-50"
              >
                {recording && (
                  <>
                    <span className="absolute inset-0 rounded-full bg-danger/40 animate-ping-slow" />
                    <span
                      className="absolute inset-0 rounded-full bg-danger/30 animate-ping-slow"
                      style={{ animationDelay: "0.9s" }}
                    />
                  </>
                )}
                <span
                  className={cn(
                    "relative grid h-[72px] w-[72px] place-items-center rounded-full border transition duration-200 group-hover:scale-105",
                    recording
                      ? "border-transparent bg-danger text-white shadow-[0_10px_30px_-8px_var(--danger)]"
                      : "border-transparent bg-linear-to-b from-accent-2 to-accent text-accent-fg shadow-[0_12px_30px_-10px_var(--glow)]",
                  )}
                >
                  {recording ? (
                    <Square className="h-6 w-6" fill="currentColor" />
                  ) : (
                    <Mic className="h-7 w-7" />
                  )}
                </span>
              </button>
              <div className="min-w-[132px]">
                <div className="kicker flex items-center gap-1.5">
                  {recording ? (
                    <>
                      <span className="dot text-danger animate-breathe" /> On air
                    </>
                  ) : scoring ? (
                    "Scoring"
                  ) : countdown !== null ? (
                    "Prep time"
                  ) : (
                    "Ready"
                  )}
                </div>
                <div className="mono-num mt-1 text-3xl font-semibold text-ink">
                  {countdown !== null ? `0:${String(countdown).padStart(2, "0")}` : fmtTime(elapsed)}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  {countdown === null ? (
                    <button
                      type="button"
                      onClick={startPrepCountdown}
                      disabled={recording || scoring}
                      className="btn btn-secondary btn-sm h-7"
                    >
                      <Timer className="h-3.5 w-3.5" /> 30s prep
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void beginRecording()}
                        className="btn btn-primary btn-sm h-7"
                      >
                        Start now
                      </button>
                      <button
                        type="button"
                        onClick={cancelCountdown}
                        className="btn btn-ghost btn-sm h-7"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="card-inset min-w-0 flex-1 px-4 py-3">
              <LiveWaveform stream={stream} active={recording} height={76} />
            </div>

            <div className="grid grid-cols-3 gap-2 lg:w-[260px]">
              <Hud label="WPM" value={String(Math.round(liveWpm))} tone={paceTone} />
              <Hud label="Fillers" value={String(fillers)} tone={fillers > 5 ? "text-warn" : "text-ink"} />
              <Hud label="Words" value={String(words)} />
            </div>
          </div>
          {status && !recording && (
            <p className="relative mt-4 text-xs text-ink-soft">
              <span className="kicker mr-2">Status</span>
              {status}
            </p>
          )}
        </Card>

        {!!checkpoints.length && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="kicker mr-1">Live checkpoints</span>
            {checkpoints.map((c) => (
              <span
                key={c.id}
                className={cn("chip h-8 px-3 transition-all", c.hit && "chip-good")}
                style={c.hit ? { boxShadow: "0 0 18px -6px var(--good)" } : undefined}
              >
                <span className={cn("dot", !c.hit && "opacity-30")} />
                {c.label}
              </span>
            ))}
          </div>
        )}

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="kicker">Live transcript</span>
            {!revealed && (
              <span className="chip">
                <EyeOff className="h-3 w-3" /> Blind practice
              </span>
            )}
          </div>
          <p
            className={cn(
              "min-h-28 whitespace-pre-wrap text-[15px] leading-relaxed",
              transcript ? "text-ink" : "text-ink-faint",
              recording && "caret",
            )}
          >
            {transcript || (recording ? "" : "Press the mic and start talking — your words appear here.")}
          </p>
          {(audioUrl || sessionId) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              {audioUrl && <audio controls src={audioUrl} className="h-10 min-w-0 flex-1" />}
              {sessionId && (
                <button
                  type="button"
                  onClick={() => void exportDebrief()}
                  className="btn btn-secondary btn-sm"
                >
                  <Download className="h-3.5 w-3.5" /> Export debrief .md
                </button>
              )}
            </div>
          )}
        </Card>
      </div>

      {card && (
        <Scorecard
          card={card}
          telemetry={telemetry}
          said={transcript}
          evidence={retrieved?.chunks ?? []}
          revealed={revealed}
          bridgeCompare={bridgeCompare}
          onFollowUp={(q) => {
            setQuestion(q);
            setCard(null);
            setStatus("Follow-up loaded — press mic when ready");
          }}
        />
      )}

      <SessionCoachPanel attempts={attempts} settings={settings} />
    </div>
  );
}

function Hud({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card-inset px-3 py-2.5">
      <div className="kicker">{label}</div>
      <div className={cn("mono-num mt-1 text-2xl font-semibold", tone)}>{value}</div>
    </div>
  );
}

function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
