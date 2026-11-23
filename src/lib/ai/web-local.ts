/**
 * Optional in-browser local models.
 * Install when needed:
 *   npm install @mlc-ai/web-llm
 *   npm install @huggingface/transformers
 *
 * These packages are large; VoiceVault loads them only when preferred
 * and present, then falls back to heuristics if import fails.
 */

import { answersToScorecard } from "./jev-scorer";
import type { CalibratedScorecard, ScoringInput, SystemOneAnswer } from "./types";

const RUBRIC = `Return ONLY JSON with clarity_score, structure_score, conciseness_score, evidence_alignment_score (each {type:"score",score:0-9,confidence:0-1}), answered_prompt_directly, hit_prep_doc_signals, backed_by_real_experience, avoided_red_flags (each {type:"noul",noul:0-1}), primary_gap and delivery_tone (each {type:"choice",choice:string,confidence:0-1}).`;

export async function scoreWithWebLlm(
  input: ScoringInput,
  threshold: number,
  onProgress?: (phase: string, progress: number) => void,
): Promise<CalibratedScorecard> {
  // Dynamic import keeps the static bundle free of the multi-hundred-MB runtime
  const mod = await import(/* webpackIgnore: true */ "@mlc-ai/web-llm").catch(() => null);
  if (!mod) {
    throw new Error("@mlc-ai/web-llm not installed");
  }

  const { CreateMLCEngine } = mod as {
    CreateMLCEngine: (
      model: string,
      opts?: { initProgressCallback?: (p: { progress: number; text: string }) => void },
    ) => Promise<{
      chat: {
        completions: {
          create: (req: {
            messages: Array<{ role: string; content: string }>;
            response_format?: { type: string };
          }) => Promise<{ choices: Array<{ message: { content: string } }> }>;
        };
      };
    }>;
  };

  onProgress?.("Downloading local WebLLM model…", 0.1);
  const engine = await CreateMLCEngine("Llama-3.2-1B-Instruct-q4f16_1-MLC", {
    initProgressCallback: (p) => onProgress?.(p.text, p.progress),
  });

  const result = await engine.chat.completions.create({
    messages: [
      { role: "system", content: RUBRIC },
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
    response_format: { type: "json_object" },
  });

  const raw = result.choices[0]?.message?.content ?? "{}";
  const answers = JSON.parse(raw) as Record<string, SystemOneAnswer>;
  return answersToScorecard(answers, threshold, "browser");
}

export async function scoreWithTransformersJs(
  input: ScoringInput,
  threshold: number,
): Promise<CalibratedScorecard> {
  const mod = await import(/* webpackIgnore: true */ "@huggingface/transformers").catch(
    () => null,
  );
  if (!mod) {
    throw new Error("@huggingface/transformers not installed");
  }

  const { pipeline } = mod as {
    pipeline: (
      task: string,
      model: string,
    ) => Promise<(input: string, opts?: Record<string, unknown>) => Promise<unknown>>;
  };

  const generator = await pipeline("text-generation", "onnx-community/Qwen2.5-0.5B-Instruct");
  const prompt = `${RUBRIC}\n\nQ: ${input.question}\nA: ${input.userResponse}`;
  const out = (await generator(prompt, {
    max_new_tokens: 400,
    temperature: 0.2,
  })) as Array<{ generated_text?: string }>;

  const text = out[0]?.generated_text ?? "{}";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const json = start >= 0 && end > start ? text.slice(start, end + 1) : "{}";
  const answers = JSON.parse(json) as Record<string, SystemOneAnswer>;
  return answersToScorecard(answers, threshold, "browser");
}
