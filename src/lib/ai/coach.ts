import type {
  AppSettings,
  CalibratedScorecard,
  GeneratedQuestion,
  InterviewType,
  PrepSignals,
  RetrievedChunk,
  RetrievalHint,
  SessionAttempt,
  SessionCoachSummary,
  ScoringInput,
  StarSkeleton,
} from "./types";

const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";

type LocalChatOpts = {
  system: string;
  user: string;
  settings: AppSettings;
};

/** Prefer Jev → LM Studio → Ollama → OpenAI for generative coach tasks. */
export async function localOrCloudChat(opts: LocalChatOpts): Promise<string> {
  const { system, user, settings } = opts;
  const strict = settings.strictMindVaultMode;

  if (settings.jevApiKey && !strict) {
    try {
      return await jevFreeform(system, user, settings.jevApiKey);
    } catch {
      /* fall through */
    }
  }

  if (settings.lmStudioUrl) {
    try {
      const models = await fetchModels(`${settings.lmStudioUrl.replace(/\/$/, "")}/v1/models`);
      const model = settings.lmStudioModel || models[0];
      if (model) {
        return await openAiChat(
          `${settings.lmStudioUrl.replace(/\/$/, "")}/v1/chat/completions`,
          "lm-studio",
          model,
          system,
          user,
        );
      }
    } catch {
      /* fall through */
    }
  }

  try {
    const root = settings.ollamaUrl.replace(/\/$/, "") || "http://localhost:11434";
    const tags = await fetch(`${root}/api/tags`);
    if (tags.ok) {
      const tagJson = (await tags.json()) as { models?: Array<{ name: string }> };
      const model = tagJson.models?.[0]?.name;
      if (model) {
        const res = await fetch(`${root}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { message?: { content?: string } };
          if (data.message?.content) return data.message.content;
        }
      }
    }
  } catch {
    /* fall through */
  }

  if (!strict && settings.openaiApiKey) {
    return openAiChat(
      "https://api.openai.com/v1/chat/completions",
      settings.openaiApiKey,
      "gpt-4o-mini",
      system,
      user,
    );
  }

  throw new Error("No generative provider available (Jev / LM Studio / Ollama / BYOK)");
}

async function jevFreeform(system: string, user: string, apiKey: string): Promise<string> {
  const res = await fetch(SYSTEM_ONE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "jev-latest",
      state: JSON.stringify({ system, user }),
      questions: {
        reply: {
          type: "choice",
          instructions: "Produce a concise coaching reply. Put the full reply text as the choice string (max 600 chars).",
          criteria: {
            ok: "A valid coaching reply",
          },
        },
      },
    }),
  });
  // System One choice isn't ideal for free text — prefer chat-shaped BYOK/local.
  // If Jev rejects or shape is wrong, throw to fall through.
  if (!res.ok) throw new Error(`Jev ${res.status}`);
  throw new Error("Jev freeform not suitable — use local/chat provider");
}

async function openAiChat(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`chat failed ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty chat response");
  return text;
}

async function fetchModels(url: string): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return (data.data ?? []).map((m) => m.id).filter(Boolean);
}

function extractJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart >= 0 && (start < 0 || arrStart < start) && arrEnd > arrStart) {
    return JSON.parse(text.slice(arrStart, arrEnd + 1)) as T;
  }
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1)) as T;
  }
  return JSON.parse(text) as T;
}

export async function generateMockQuestions(
  chunks: RetrievedChunk[],
  prep: PrepSignals | null | undefined,
  settings: AppSettings,
  interviewType: InterviewType,
  count = 6,
): Promise<GeneratedQuestion[]> {
  const evidence = chunks
    .slice(0, 10)
    .map((c) => `(${c.doc_type}) ${c.heading ?? ""}: ${c.content.slice(0, 280)}`)
    .join("\n");
  const system =
    "You generate personal mock interview questions from the candidate's own vault. Return ONLY JSON array of {text, interviewType, difficulty, focus}. Do not invent employers not in context. Prefer questions that force evidence from the vault.";
  const user = JSON.stringify({
    interviewType,
    count,
    prep,
    evidence,
  });

  try {
    const raw = await localOrCloudChat({ system, user, settings });
    const parsed = extractJson<GeneratedQuestion[]>(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.slice(0, count).map((q) => ({
        text: String(q.text),
        interviewType: (q.interviewType as InterviewType) || interviewType,
        difficulty: (q.difficulty as GeneratedQuestion["difficulty"]) || "medium",
        focus: String(q.focus || "evidence"),
      }));
    }
  } catch {
    /* heuristic fallback */
  }

  return heuristicQuestions(chunks, prep, interviewType, count);
}

function heuristicQuestions(
  chunks: RetrievedChunk[],
  prep: PrepSignals | null | undefined,
  interviewType: InterviewType,
  count: number,
): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  for (const q of prep?.questions ?? []) {
    out.push({ text: q, interviewType, difficulty: "medium", focus: "prep doc" });
  }
  for (const c of chunks.slice(0, 4)) {
    const hint = c.heading || c.content.split(/\s+/).slice(0, 8).join(" ");
    out.push({
      text: `Walk me through your ownership on: ${hint}. What decision did you make and what was the measurable result?`,
      interviewType,
      difficulty: "medium",
      focus: c.doc_type,
    });
  }
  const kw = prep?.target_keywords?.[0];
  if (kw) {
    out.push({
      text: `How would you apply experience with ${kw} to this role's biggest challenge?`,
      interviewType,
      difficulty: "hard",
      focus: "keyword",
    });
  }
  if (!out.length) {
    out.push({
      text: "Tell me about a high-impact technical decision you owned end-to-end.",
      interviewType,
      difficulty: "medium",
      focus: "general",
    });
  }
  return out.slice(0, count);
}

export async function generateStarSkeletons(
  chunks: RetrievedChunk[],
  settings: AppSettings,
): Promise<StarSkeleton[]> {
  const evidence = chunks
    .filter((c) => ["resume", "story_bank", "project_doc"].includes(c.doc_type))
    .slice(0, 8)
    .map((c) => `(${c.doc_type}/${c.heading ?? "section"}) ${c.content.slice(0, 400)}`)
    .join("\n\n");

  const system =
    "Draft STAR story skeletons the candidate can edit. Return ONLY JSON array of {title, situation, task, action, result, sourceHint}. Keep bullets short. Do NOT invent metrics not present; mark unknowns as [add metric]. These are drafts, not final answers.";
  try {
    const raw = await localOrCloudChat({
      system,
      user: evidence || "No chunks — return empty array.",
      settings,
    });
    const parsed = extractJson<StarSkeleton[]>(raw);
    if (Array.isArray(parsed)) return parsed.slice(0, 5);
  } catch {
    /* heuristic */
  }

  return chunks
    .filter((c) => ["resume", "story_bank", "project_doc"].includes(c.doc_type))
    .slice(0, 3)
    .map((c) => ({
      title: c.heading || "Untitled story",
      situation: `Context from vault: ${c.content.slice(0, 120)}…`,
      task: "Clarify the goal / constraint you owned. [edit]",
      action: "List 2–3 concrete actions you personally took. [edit]",
      result: "Add a measurable outcome. [add metric]",
      sourceHint: `${c.doc_type}${c.heading ? ` · ${c.heading}` : ""}`,
    }));
}

export async function generateFollowUps(
  input: ScoringInput,
  card: CalibratedScorecard,
  settings: AppSettings,
): Promise<string[]> {
  const system =
    "You are a tough but fair interviewer. Return ONLY JSON array of 1-2 short follow-up questions grounded in the candidate's answer and vault evidence. Push on metrics, tradeoffs, or ownership gaps. No coaching advice.";
  try {
    const raw = await localOrCloudChat({
      system,
      user: JSON.stringify({
        question: input.question,
        answer: input.userResponse.slice(0, 1200),
        primaryGap: card.primaryGap,
        citations: card.citations,
        prep: input.activePrepDocSignals,
        chunks: input.retrievedResumeChunks.slice(0, 4).map((c) => ({
          id: c.id,
          heading: c.heading,
          snippet: c.content.slice(0, 200),
        })),
      }),
      settings,
    });
    const parsed = extractJson<string[]>(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map(String).slice(0, 2);
    }
  } catch {
    /* heuristic */
  }

  const followUps: string[] = [];
  if (card.primaryGap === "Lacks Concrete Resume Evidence") {
    followUps.push("What specific metric or artifact proves that claim?");
  } else if (card.primaryGap === "Missed Prep Signals") {
    const kw = input.activePrepDocSignals?.target_keywords?.[0];
    followUps.push(
      kw
        ? `How does that experience map to ${kw} for this company?`
        : "How does that map to what this company cares about most?",
    );
  } else if (card.primaryGap === "Weak Structure") {
    followUps.push("Can you restate that in Situation → Action → Result in under 60 seconds?");
  } else {
    followUps.push("What would you do differently if you had to ship that again in half the time?");
  }
  if (card.citations?.[0]) {
    followUps.push("Walk me through your personal ownership on that project — what did only you decide?");
  }
  return followUps.slice(0, 2);
}

export function buildRetrievalHints(card: CalibratedScorecard, chunks: RetrievedChunk[]): RetrievalHint[] {
  const types = new Set(chunks.map((c) => c.doc_type));
  const hints: RetrievalHint[] = [];

  if (card.evidenceAlignment.score < 6 || card.primaryGap === "Lacks Concrete Resume Evidence") {
    if (!types.has("resume")) {
      hints.push({
        docType: "resume",
        label: "Resume",
        reason: "Evidence score is thin — ingest a resume with roles, stack, and metrics.",
      });
    }
    if (!types.has("project_doc")) {
      hints.push({
        docType: "project_doc",
        label: "Project docs",
        reason: "Add project write-ups so answers can cite real architecture and outcomes.",
      });
    }
    if (!types.has("story_bank")) {
      hints.push({
        docType: "story_bank",
        label: "Story bank",
        reason: "A STAR story bank helps retrieval surface ownership narratives.",
      });
    }
  }

  if (card.hitPrepDocSignals < 0.45 || card.primaryGap === "Missed Prep Signals") {
    if (!types.has("career_ops_prep")) {
      hints.push({
        docType: "career_ops_prep",
        label: "career-ops prep",
        reason: "Prep signals were missed — index a company prep Markdown brief.",
      });
    } else {
      hints.push({
        docType: "career_ops_prep",
        label: "Prep keywords",
        reason: "Prep is indexed but keywords weren't hit — rehearse company-signal drill next.",
      });
    }
  }

  if (card.backedByRealExperience < 0.45 && !/[0-9]+%|\b\d{2,}\b/.test(chunks.map((c) => c.content).join(" "))) {
    hints.push({
      docType: "profile_fact",
      label: "Key metrics",
      reason: "Vault lacks numeric impact — add key metrics in Profile facts.",
    });
  }

  return hints.slice(0, 4);
}

export function heuristicCitations(
  response: string,
  chunks: RetrievedChunk[],
): { chunkId: string; reason: string; strength: number }[] {
  const lower = response.toLowerCase();
  const tokens = new Set(
    lower
      .replace(/[^a-z0-9%\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3),
  );
  return chunks
    .map((c) => {
      const words = c.content
        .toLowerCase()
        .replace(/[^a-z0-9%\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 3);
      const hits = words.filter((w) => tokens.has(w)).length;
      const strength = words.length ? Math.min(1, hits / Math.min(40, words.length)) : 0;
      return {
        chunkId: c.id,
        reason: c.heading
          ? `Overlaps vault section "${c.heading}"`
          : `Overlaps ${c.doc_type.replace(/_/g, " ")} evidence`,
        strength: Math.round(strength * 100) / 100,
      };
    })
    .filter((c) => c.strength >= 0.08)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4);
}

export async function summarizeSession(
  attempts: SessionAttempt[],
  settings: AppSettings,
): Promise<SessionCoachSummary> {
  const averageOverall =
    attempts.reduce((s, a) => s + a.overall, 0) / Math.max(1, attempts.length);

  const gapCounts = new Map<string, number>();
  for (const a of attempts) {
    gapCounts.set(a.primaryGap, (gapCounts.get(a.primaryGap) ?? 0) + 1);
  }
  const topGaps = [...gapCounts.entries()]
    .filter(([g]) => g !== "Strong Delivery")
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g)
    .slice(0, 3);

  const wins = attempts
    .filter((a) => a.overall >= 7 || a.primaryGap === "Strong Delivery")
    .map((a) => `Solid on "${a.question.slice(0, 60)}" (${a.overall.toFixed(1)})`)
    .slice(0, 3);

  const practicePlan = [
    topGaps[0]
      ? `Tomorrow: 3 reps focused on ${topGaps[0].toLowerCase()}.`
      : "Tomorrow: 3 mixed behavioral reps with company-signal drill on.",
    "Do one Writing → Speaking bridge on your weakest prompt.",
    "Add any missing metrics/docs suggested by retrieval hints before the next session.",
  ];

  try {
    const raw = await localOrCloudChat({
      system:
        "Summarize a practice session. Return ONLY JSON {topGaps:string[], wins:string[], practicePlan:string[]}. Be specific and actionable. Max 3 items each.",
      user: JSON.stringify({ attempts, topGaps, wins }),
      settings,
    });
    const parsed = extractJson<Pick<SessionCoachSummary, "topGaps" | "wins" | "practicePlan">>(raw);
    return {
      topGaps: parsed.topGaps?.length ? parsed.topGaps.slice(0, 3) : topGaps,
      wins: parsed.wins?.length ? parsed.wins.slice(0, 3) : wins.length ? wins : ["Showed up and completed reps."],
      practicePlan: parsed.practicePlan?.length ? parsed.practicePlan.slice(0, 3) : practicePlan,
      averageOverall: Math.round(averageOverall * 10) / 10,
      attemptCount: attempts.length,
      engine: "ai",
    };
  } catch {
    return {
      topGaps: topGaps.length ? topGaps : ["Keep stacking reps — no dominant gap yet."],
      wins: wins.length ? wins : ["Completed the session — consistency is the win."],
      practicePlan,
      averageOverall: Math.round(averageOverall * 10) / 10,
      attemptCount: attempts.length,
      engine: "heuristic",
    };
  }
}

/** Build company-signal rehearsal prompts from prep metadata. */
export function companySignalPrompts(prep: PrepSignals | null | undefined): string[] {
  if (!prep) return [];
  const out: string[] = [];
  for (const kw of prep.target_keywords.slice(0, 4)) {
    out.push(
      `In 90 seconds, show how your experience connects to "${kw}" for this company — cite a real project.`,
    );
  }
  for (const signal of prep.company_signals.slice(0, 3)) {
    out.push(`How would you contribute given this company signal: ${signal}?`);
  }
  for (const avoid of prep.things_to_avoid.slice(0, 3)) {
    out.push(
      `Answer without falling into "${avoid}". Tell a relevant story that stays on the right side of that anti-pattern.`,
    );
  }
  return out;
}
