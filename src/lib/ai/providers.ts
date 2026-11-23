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
  LiveCheckpoint,
  ScoringInput,
  SystemOneAnswer,
} from "./types";

declare global {
  interface Window {
    LanguageModel?: {
      availability: () => Promise<string>;
      create: (opts?: Record<string, unknown>) => Promise<{
        prompt: (input: string) => Promise<string>;
        destroy?: () => void;
      }>;
    };
  }
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
  "delivery_tone": {"type":"choice","choice":"Confident & Crisp|Hesitant / Hedging|Overly Casual|Sounds Memorized","confidence":0-1}
}
Scores use 0-9 index (map later to 1-10).`;

export async function evaluateResponse(
  input: ScoringInput,
  settings: AppSettings,
  telemetry?: DeliveryTelemetry,
  onProgress?: (p: ProviderProgress) => void,
): Promise<CalibratedScorecard> {
  const threshold = settings.confidenceThreshold ?? 0.7;
  const order = providerOrder(settings);

  for (const provider of order) {
    try {
      onProgress?.({ phase: `Trying ${provider}`, progress: 0.15 });
      if (provider === "jev" && settings.jevApiKey) {
        const card = await scoreWithJev(input, settings.jevApiKey, threshold);
        if (settings.enableCoachCritique && !settings.strictMindVaultMode) {
          card.critique = await maybeCoachCritique(input, settings);
        }
        return card;
      }
      if (provider === "chrome_prompt") {
        return await scoreWithChromePrompt(input, threshold);
      }
      if (provider === "web_llm") {
        const { scoreWithWebLlm, scoreWithTransformersJs } = await import("./web-local");
        try {
          return await scoreWithWebLlm(input, threshold, (phase, progress) =>
            onProgress?.({ phase, progress }),
          );
        } catch {
          return await scoreWithTransformersJs(input, threshold);
        }
      }
      if (provider === "ollama") {
        return await scoreWithOllama(input, settings.ollamaUrl, threshold, onProgress);
      }
      if (provider === "lmstudio") {
        return await scoreWithLmStudio(
          input,
          settings.lmStudioUrl,
          settings.lmStudioModel,
          threshold,
          onProgress,
        );
      }
      if (provider === "openai" && settings.openaiApiKey && !settings.strictMindVaultMode) {
        return await scoreWithOpenAiCompatible(
          input,
          "https://api.openai.com/v1/chat/completions",
          settings.openaiApiKey,
          "gpt-4o-mini",
          threshold,
          "byok",
        );
      }
      if (provider === "anthropic" && settings.anthropicApiKey && !settings.strictMindVaultMode) {
        return await scoreWithAnthropic(input, settings.anthropicApiKey, threshold);
      }
      if (provider === "gemini" && settings.geminiApiKey && !settings.strictMindVaultMode) {
        return await scoreWithGemini(input, settings.geminiApiKey, threshold);
      }
      if (provider === "heuristic") {
        return scoreWithHeuristics(input, telemetry, threshold);
      }
    } catch (err) {
      console.warn(`[VoiceVault] provider ${provider} failed`, err);
    }
  }

  return scoreWithHeuristics(input, telemetry, threshold);
}

export async function evaluateLiveCheckpoints(
  transcript: string,
  question: string,
  input: Pick<ScoringInput, "activePrepDocSignals" | "retrievedResumeChunks">,
  settings: AppSettings,
): Promise<LiveCheckpoint[]> {
  const defs = buildLiveCheckpointDefs(
    input.activePrepDocSignals,
    input.retrievedResumeChunks,
  );

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

function providerOrder(settings: AppSettings): AppSettings["preferredProvider"][] {
  const preferred = settings.preferredProvider;
  const rest: AppSettings["preferredProvider"][] = [
    "jev",
    "chrome_prompt",
    "web_llm",
    "ollama",
    "lmstudio",
    "openai",
    "anthropic",
    "gemini",
    "heuristic",
  ];
  return [preferred, ...rest.filter((p) => p !== preferred)];
}

async function scoreWithChromePrompt(
  input: ScoringInput,
  threshold: number,
): Promise<CalibratedScorecard> {
  if (typeof window === "undefined" || !window.LanguageModel) {
    throw new Error("Chrome Prompt API unavailable");
  }
  const availability = await window.LanguageModel.availability();
  if (availability !== "readily" && availability !== "available" && availability !== "after-download") {
    throw new Error(`Prompt API: ${availability}`);
  }
  const session = await window.LanguageModel.create();
  try {
    const prompt = `${RUBRIC_PROMPT}\n\nQuestion: ${input.question}\nResponse: ${input.userResponse}\nEvidence:\n${input.retrievedResumeChunks
      .map((c) => c.content)
      .join("\n---\n")}`;
    const raw = await session.prompt(prompt);
    const answers = extractJson(raw) as Record<string, SystemOneAnswer>;
    return answersToScorecard(answers, threshold, "browser");
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
            evidence: input.retrievedResumeChunks.map((c) => c.content),
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
  return answersToScorecard(answers, threshold, "ollama");
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
            evidence: input.retrievedResumeChunks.map((c) => c.content),
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
  return answersToScorecard(answers, threshold, engine);
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
            evidence: input.retrievedResumeChunks.map((c) => c.content),
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
  return answersToScorecard(answers, threshold, "byok");
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
                evidence: input.retrievedResumeChunks.map((c) => c.content),
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
  return answersToScorecard(answers, threshold, "byok");
}

async function maybeCoachCritique(
  input: ScoringInput,
  settings: AppSettings,
): Promise<string | undefined> {
  if (!settings.openaiApiKey && !settings.anthropicApiKey && !settings.geminiApiKey) {
    return undefined;
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
