import { buildRetrievalHints, generateFollowUps, heuristicCitations } from "./coach";
import { attachDelta } from "./delta";
import {
  analyzeDelivery,
  liveCheckpointsFromHeuristics,
  scoreWithHeuristics,
  type DeliveryTelemetry,
} from "./heuristics";
import {
  answersToScorecard,
  buildLiveCheckpointDefs,
  scoreLiveCheckpointsWithJev,
  scoreWithJev,
} from "./jev-scorer";
import type {
  AppSettings,
  CalibratedScorecard,
  FallbackStep,
  LiveCheckpoint,
  ScoringInput,
  SpeechMetrics,
  SystemOneAnswer,
} from "./types";

type ChromeLanguageModel = {
  availability: () => Promise<string>;
  create: (opts?: Record<string, unknown>) => Promise<{
    prompt: (input: string) => Promise<string>;
    destroy?: () => void;
  }>;
};

function getChromeLanguageModel(): ChromeLanguageModel | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { LanguageModel?: ChromeLanguageModel }).LanguageModel;
}

export type ProviderProgress = {
  phase: string;
  progress: number;
};

const RUBRIC_PROMPT = `You are an interview coach. Return ONLY valid JSON with this shape:
{
  "clarity_score": {"type":"score","score":0-9,"confidence":0-1},
  "structure_score": {"type":"score","score":0-9,"confidence":0-1},
  "conciseness_score": {"type":"score","score":0-9,"confidence":0-1},
  "evidence_alignment_score": {"type":"score","score":0-9,"confidence":0-1},
  "answered_prompt_directly": {"type":"noul","noul":0-1},
  "hit_prep_doc_signals": {"type":"noul","noul":0-1},
  "backed_by_real_experience": {"type":"noul","noul":0-1},
  "avoided_red_flags": {"type":"noul","noul":0-1},
  "primary_gap": {"type":"choice","choice":"Missed Prep Signals|Lacks Concrete Resume Evidence|Rambling / Too Long|Weak Structure|Strong Delivery","confidence":0-1},
  "delivery_tone": {"type":"choice","choice":"Confident & Crisp|Hesitant / Hedging|Overly Casual|Sounds Memorized","confidence":0-1},
  "evidence_chunk_ids": {"type":"choice","choice":"chunk-id-or-none","confidence":0-1}
}
Scores use 0-9 index (map later to 1-10). Prefer evidence_chunk_ids from retrieved chunk ids when claims are backed.`;

export async function evaluateResponse(
  input: ScoringInput,
  settings: AppSettings,
  telemetry?: DeliveryTelemetry,
  onProgress?: (p: ProviderProgress) => void,
): Promise<CalibratedScorecard> {
  const threshold = settings.confidenceThreshold ?? 0.7;
  const enriched: ScoringInput = {
    ...input,
    interviewType: input.interviewType ?? settings.defaultInterviewType ?? "general",
    speechMetrics: input.speechMetrics ?? (telemetry ? telemetryToSpeech(telemetry) : null),
  };

  const order = providerOrder(settings);
  const chain: FallbackStep[] = [];
  let card: CalibratedScorecard | null = null;

  for (const provider of order) {
    try {
      onProgress?.({ phase: `Trying ${providerLabelSafe(provider)}`, progress: 0.15 });

      if (provider === "jev") {
        if (settings.strictMindVaultMode) {
          chain.push({ provider, ok: false, reason: "Strict MindVault — cloud skipped" });
          continue;
        }
        if (!settings.jevApiKey) {
          chain.push({ provider, ok: false, reason: "No Jev API key" });
          continue;
        }
        card = await scoreWithJev(enriched, settings.jevApiKey, threshold);
        chain.push({ provider, ok: true, reason: "System One scored" });
        break;
      }
      if (provider === "chrome_prompt") {
        card = await scoreWithChromePrompt(enriched, threshold);
        chain.push({ provider, ok: true, reason: "Browser Prompt API" });
        break;
      }
      if (provider === "web_llm") {
        const { scoreWithWebLlm, scoreWithTransformersJs } = await import("./web-local");
        try {
          card = await scoreWithWebLlm(enriched, threshold, (phase, progress) =>
            onProgress?.({ phase, progress }),
          );
        } catch {
          card = await scoreWithTransformersJs(enriched, threshold);
        }
        chain.push({ provider, ok: true, reason: "In-browser local model" });
        break;
      }
      if (provider === "ollama") {
        card = await scoreWithOllama(enriched, settings.ollamaUrl, threshold, onProgress);
        chain.push({ provider, ok: true, reason: "Local Ollama" });
        break;
      }
      if (provider === "lmstudio") {
        card = await scoreWithLmStudio(
          enriched,
          settings.lmStudioUrl,
          settings.lmStudioModel,
          threshold,
          onProgress,
        );
        chain.push({ provider, ok: true, reason: "Local LM Studio" });
        break;
      }
      if (provider === "openai") {
        if (settings.strictMindVaultMode) {
          chain.push({ provider, ok: false, reason: "Strict mode blocks BYOK" });
          continue;
        }
        if (!settings.openaiApiKey) {
          chain.push({ provider, ok: false, reason: "No OpenAI key" });
          continue;
        }
        card = await scoreWithOpenAiCompatible(
          enriched,
          "https://api.openai.com/v1/chat/completions",
          settings.openaiApiKey,
          "gpt-4o-mini",
          threshold,
          "byok",
        );
        chain.push({ provider, ok: true, reason: "OpenAI BYOK" });
        break;
      }
      if (provider === "anthropic") {
        if (settings.strictMindVaultMode) {
          chain.push({ provider, ok: false, reason: "Strict mode blocks BYOK" });
          continue;
        }
        if (!settings.anthropicApiKey) {
          chain.push({ provider, ok: false, reason: "No Anthropic key" });
          continue;
        }
        card = await scoreWithAnthropic(enriched, settings.anthropicApiKey, threshold);
        chain.push({ provider, ok: true, reason: "Anthropic BYOK" });
        break;
      }
      if (provider === "gemini") {
        if (settings.strictMindVaultMode) {
          chain.push({ provider, ok: false, reason: "Strict mode blocks BYOK" });
          continue;
        }
        if (!settings.geminiApiKey) {
          chain.push({ provider, ok: false, reason: "No Gemini key" });
          continue;
        }
        card = await scoreWithGemini(enriched, settings.geminiApiKey, threshold);
        chain.push({ provider, ok: true, reason: "Gemini BYOK" });
        break;
      }
      if (provider === "heuristic") {
        card = scoreWithHeuristics(enriched, telemetry, threshold);
        chain.push({ provider, ok: true, reason: "Deterministic offline rules" });
        break;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[VoiceVault] provider ${provider} failed`, err);
      chain.push({ provider, ok: false, reason: truncate(reason, 120) });
    }
  }

  if (!card) {
    card = scoreWithHeuristics(enriched, telemetry, threshold);
    chain.push({ provider: "heuristic", ok: true, reason: "Final offline fallback" });
  }

  card.fallbackChain = chain;
  if (!card.citations?.length) {
    card.citations = heuristicCitations(enriched.userResponse, enriched.retrievedResumeChunks);
  }
  card.retrievalHints = buildRetrievalHints(card, enriched.retrievedResumeChunks);

  // Confidence-gated coaching + strict-mode deferral
  card = await applyCritiquePolicy(card, enriched, settings);

  // Follow-up interviewer prompts (best-effort)
  try {
    card.followUps = await generateFollowUps(enriched, card, settings);
  } catch {
    card.followUps = card.followUps ?? [];
  }

  return attachDelta(enriched.question, card);
}

async function applyCritiquePolicy(
  card: CalibratedScorecard,
  input: ScoringInput,
  settings: AppSettings,
): Promise<CalibratedScorecard> {
  if (!settings.enableCoachCritique) {
    return card;
  }

  const avgConf =
    (card.clarity.confidence +
      card.structure.confidence +
      card.conciseness.confidence +
      card.evidenceAlignment.confidence) /
    4;
  const threshold = settings.confidenceThreshold ?? 0.7;

  if (avgConf < threshold) {
    return {
      ...card,
      critique: undefined,
      critiqueDeferred: true,
      critiqueDeferredReason: `Critique hidden — average confidence ${(avgConf * 100).toFixed(0)}% below ${(threshold * 100).toFixed(0)}% threshold`,
    };
  }

  if (settings.strictMindVaultMode && settings.deferCritiqueInStrictMode) {
    // Score offline now; stash a deferred critique request for later sync
    stashDeferredCritique(input, card);
    return {
      ...card,
      critique: undefined,
      critiqueDeferred: true,
      critiqueDeferredReason:
        "Strict MindVault — scored locally; coach critique queued for later sync when cloud is allowed",
    };
  }

  if (settings.strictMindVaultMode) {
    return {
      ...card,
      critique: undefined,
      critiqueDeferred: true,
      critiqueDeferredReason: "Strict MindVault Mode blocks coach critique",
    };
  }

  const critique = await maybeCoachCritique(input, settings);
  return { ...card, critique, critiqueDeferred: false };
}

const DEFERRED_KEY = "voicevault.deferred-critique.v1";

function stashDeferredCritique(input: ScoringInput, card: CalibratedScorecard) {
  if (typeof window === "undefined") return;
  try {
    const prev = JSON.parse(localStorage.getItem(DEFERRED_KEY) || "[]") as unknown[];
    prev.push({
      at: Date.now(),
      question: input.question,
      response: input.userResponse.slice(0, 2000),
      overall: card.overall,
      primaryGap: card.primaryGap,
    });
    localStorage.setItem(DEFERRED_KEY, JSON.stringify(prev.slice(-20)));
  } catch {
    /* ignore */
  }
}

export function loadDeferredCritiques(): Array<{
  at: number;
  question: string;
  response: string;
  overall: number;
  primaryGap: string;
}> {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(DEFERRED_KEY) || "[]");
  } catch {
    return [];
  }
}

export async function syncDeferredCritiques(settings: AppSettings): Promise<number> {
  if (settings.strictMindVaultMode) return 0;
  const rows = loadDeferredCritiques();
  if (!rows.length) return 0;
  let synced = 0;
  for (const row of rows) {
    try {
      const critique = await maybeCoachCritique(
        {
          question: row.question,
          userResponse: row.response,
          retrievedResumeChunks: [],
        },
        settings,
      );
      if (critique) synced += 1;
    } catch {
      /* keep queued */
    }
  }
  if (synced) localStorage.removeItem(DEFERRED_KEY);
  return synced;
}

export async function evaluateLiveCheckpoints(
  transcript: string,
  question: string,
  input: Pick<ScoringInput, "activePrepDocSignals" | "retrievedResumeChunks" | "interviewType">,
  settings: AppSettings,
): Promise<LiveCheckpoint[]> {
  const interviewType = input.interviewType ?? settings.defaultInterviewType ?? "general";
  const defs = buildLiveCheckpointDefs(
    input.activePrepDocSignals,
    input.retrievedResumeChunks,
    interviewType,
  );

  // Prefer Jev mid-answer when key present and not strict; else local heuristics
  if (settings.jevApiKey && !settings.strictMindVaultMode) {
    try {
      return await scoreLiveCheckpointsWithJev(
        transcript,
        question,
        defs,
        settings.jevApiKey,
      );
    } catch {
      /* fall through */
    }
  }

  return liveCheckpointsFromHeuristics(
    transcript,
    input.activePrepDocSignals,
    input.retrievedResumeChunks,
    interviewType,
  );
}

export function buildTelemetry(
  text: string,
  durationSec: number,
  silenceGaps: number,
  earlyWpm: number,
  lateWpm: number,
  input: ScoringInput,
): DeliveryTelemetry {
  return analyzeDelivery(
    text,
    durationSec,
    silenceGaps,
    earlyWpm,
    lateWpm,
    input.activePrepDocSignals,
    input.retrievedResumeChunks.map((c) => c.content),
  );
}

export function telemetryToSpeech(tel: DeliveryTelemetry): SpeechMetrics {
  return {
    wpm: tel.wpm,
    fillersPer100: tel.fillersPer100,
    hedgeRatio: tel.hedgeRatio,
    silenceGaps: tel.silenceGaps,
    durationSec: tel.durationSec,
    earlyWpm: tel.earlyWpm,
    lateWpm: tel.lateWpm,
    fillerCount: tel.fillerCount,
    wordCount: tel.wordCount,
  };
}

/** Local-first cascade when Strict MindVault Mode is on. */
function providerOrder(settings: AppSettings): AppSettings["preferredProvider"][] {
  const preferred = settings.preferredProvider;
  const localFirst: AppSettings["preferredProvider"][] = [
    "lmstudio",
    "ollama",
    "chrome_prompt",
    "web_llm",
    "heuristic",
  ];
  const full: AppSettings["preferredProvider"][] = [
    "jev",
    "lmstudio",
    "ollama",
    "chrome_prompt",
    "web_llm",
    "openai",
    "anthropic",
    "gemini",
    "heuristic",
  ];

  const rest = settings.strictMindVaultMode ? localFirst : full;
  // If preferred is cloud under strict, ignore and start local
  if (settings.strictMindVaultMode && ["jev", "openai", "anthropic", "gemini"].includes(preferred)) {
    return rest;
  }
  return [preferred, ...rest.filter((p) => p !== preferred)];
}

function providerLabelSafe(id: string): string {
  return id;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

async function scoreWithChromePrompt(
  input: ScoringInput,
  threshold: number,
): Promise<CalibratedScorecard> {
  const LanguageModel = getChromeLanguageModel();
  if (!LanguageModel) {
    throw new Error("Chrome Prompt API unavailable");
  }
  const availability = await LanguageModel.availability();
  if (availability !== "readily" && availability !== "available" && availability !== "after-download") {
    throw new Error(`Prompt API: ${availability}`);
  }
  const session = await LanguageModel.create();
  try {
    const prompt = `${RUBRIC_PROMPT}\n\nInterview type: ${input.interviewType ?? "general"}\nSpeech: ${JSON.stringify(input.speechMetrics)}\nQuestion: ${input.question}\nResponse: ${input.userResponse}\nEvidence:\n${input.retrievedResumeChunks
      .map((c) => `[${c.id}] ${c.content}`)
      .join("\n---\n")}`;
    const raw = await session.prompt(prompt);
    const answers = extractJson(raw) as Record<string, SystemOneAnswer>;
    return answersToScorecard(answers, threshold, "browser", input);
  } finally {
    session.destroy?.();
  }
}

async function scoreWithOllama(
  input: ScoringInput,
  baseUrl: string,
  threshold: number,
  onProgress?: (p: ProviderProgress) => void,
): Promise<CalibratedScorecard> {
  onProgress?.({ phase: "Detecting Ollama models", progress: 0.25 });
  const root = baseUrl.replace(/\/$/, "") || "http://localhost:11434";
  const tags = await fetch(`${root}/api/tags`);
  if (!tags.ok) throw new Error("Ollama not reachable");
  const tagJson = (await tags.json()) as { models?: Array<{ name: string }> };
  const model = tagJson.models?.[0]?.name;
  if (!model) throw new Error("No Ollama models installed");

  onProgress?.({ phase: `Scoring via ${model}`, progress: 0.55 });
  const res = await fetch(`${root}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: RUBRIC_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            question: input.question,
            user_response: input.userResponse,
            interview_type: input.interviewType,
            speech_metrics: input.speechMetrics,
            evidence: input.retrievedResumeChunks.map((c) => ({
              id: c.id,
              content: c.content,
            })),
            prep: input.activePrepDocSignals,
          }),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama chat failed: ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const answers = extractJson(data.message?.content ?? "{}") as Record<
    string,
    SystemOneAnswer
  >;
  return answersToScorecard(answers, threshold, "ollama", input);
}

async function scoreWithLmStudio(
  input: ScoringInput,
  baseUrl: string,
  preferredModel: string,
  threshold: number,
  onProgress?: (p: ProviderProgress) => void,
): Promise<CalibratedScorecard> {
  onProgress?.({ phase: "Detecting LM Studio models", progress: 0.25 });
  const root = (baseUrl || "http://localhost:1234").replace(/\/$/, "");
  const models = await detectLmStudioModels(root);
  const model = preferredModel || models[0];
  if (!model) {
    throw new Error(
      "LM Studio not reachable — start the local server (default http://localhost:1234)",
    );
  }

  onProgress?.({ phase: `Scoring via LM Studio (${model})`, progress: 0.55 });
  return scoreWithOpenAiCompatible(
    input,
    `${root}/v1/chat/completions`,
    "lm-studio",
    model,
    threshold,
    "lmstudio",
  );
}

async function scoreWithOpenAiCompatible(
  input: ScoringInput,
  url: string,
  apiKey: string,
  model: string,
  threshold: number,
  engine: CalibratedScorecard["engine"] = "byok",
): Promise<CalibratedScorecard> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: RUBRIC_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            question: input.question,
            user_response: input.userResponse,
            interview_type: input.interviewType,
            speech_metrics: input.speechMetrics,
            evidence: input.retrievedResumeChunks.map((c) => ({
              id: c.id,
              content: c.content,
            })),
            prep: input.activePrepDocSignals,
          }),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible failed: ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const answers = extractJson(data.choices?.[0]?.message?.content ?? "{}") as Record<
    string,
    SystemOneAnswer
  >;
  return answersToScorecard(answers, threshold, engine, input);
}

async function scoreWithAnthropic(
  input: ScoringInput,
  apiKey: string,
  threshold: number,
): Promise<CalibratedScorecard> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `${RUBRIC_PROMPT}\n\n${JSON.stringify({
            question: input.question,
            user_response: input.userResponse,
            interview_type: input.interviewType,
            speech_metrics: input.speechMetrics,
            evidence: input.retrievedResumeChunks.map((c) => ({
              id: c.id,
              content: c.content,
            })),
          })}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic failed: ${res.status}`);
  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
  };
  const answers = extractJson(data.content?.[0]?.text ?? "{}") as Record<
    string,
    SystemOneAnswer
  >;
  return answersToScorecard(answers, threshold, "byok", input);
}

async function scoreWithGemini(
  input: ScoringInput,
  apiKey: string,
  threshold: number,
): Promise<CalibratedScorecard> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `${RUBRIC_PROMPT}\n\n${JSON.stringify({
                question: input.question,
                user_response: input.userResponse,
                interview_type: input.interviewType,
                speech_metrics: input.speechMetrics,
                evidence: input.retrievedResumeChunks.map((c) => ({
                  id: c.id,
                  content: c.content,
                })),
              })}`,
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini failed: ${res.status}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const answers = extractJson(text) as Record<string, SystemOneAnswer>;
  return answersToScorecard(answers, threshold, "byok", input);
}

async function maybeCoachCritique(
  input: ScoringInput,
  settings: AppSettings,
): Promise<string | undefined> {
  if (!settings.openaiApiKey && !settings.anthropicApiKey && !settings.geminiApiKey) {
    // Try LM Studio / Ollama briefly
    try {
      const { localOrCloudChat } = await import("./coach");
      return await localOrCloudChat({
        system:
          "Give 2-3 sentences of concise interview coaching. Do not rewrite a full answer.",
        user: `Q: ${input.question}\nA: ${input.userResponse}`,
        settings,
      });
    } catch {
      return undefined;
    }
  }
  try {
    if (settings.openaiApiKey) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Give 2-3 sentences of concise interview coaching. Do not rewrite a full answer.",
            },
            {
              role: "user",
              content: `Q: ${input.question}\nA: ${input.userResponse}`,
            },
          ],
        }),
      });
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content?.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function detectOllamaModels(
  baseUrl = "http://localhost:11434",
): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/** LM Studio OpenAI-compatible local server (default port 1234). */
export async function detectLmStudioModels(
  baseUrl = "http://localhost:1234",
): Promise<string[]> {
  try {
    const root = baseUrl.replace(/\/$/, "");
    const res = await fetch(`${root}/v1/models`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<{ id: string }>;
    };
    return (data.data ?? []).map((m) => m.id).filter(Boolean);
  } catch {
    return [];
  }
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  return JSON.parse(text);
}
