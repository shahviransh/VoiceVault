import type {
  CalibratedScorecard,
  ChoiceAnswer,
  DeliveryTone,
  LiveCheckpoint,
  NoulAnswer,
  PrepSignals,
  PrimaryGap,
  RetrievedChunk,
  ScoreAnswer,
  ScoringInput,
  SystemOneAnswer,
} from "./types";

const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";

const SCORE_CRITERIA_1_TO_10 = [
  "1 — Severely unclear or off-topic",
  "2 — Very weak",
  "3 — Weak",
  "4 — Below average",
  "5 — Adequate but thin",
  "6 — Solid with gaps",
  "7 — Good",
  "8 — Strong",
  "9 — Excellent",
  "10 — Exceptional interview-ready",
];

type QuestionDef =
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

function buildState(input: ScoringInput): string {
  const chunks = input.retrievedResumeChunks
    .slice(0, 8)
    .map((c, i) => `[${i + 1}] (${c.doc_type}${c.heading ? ` / ${c.heading}` : ""})\n${c.content}`)
    .join("\n\n");

  const signals = input.activePrepDocSignals;
  const signalBlock = signals
    ? [
        `Company signals: ${signals.company_signals.join("; ") || "n/a"}`,
        `Target keywords: ${signals.target_keywords.join("; ") || "n/a"}`,
        `Things to avoid: ${signals.things_to_avoid.join("; ") || "n/a"}`,
      ].join("\n")
    : "No active prep doc signals.";

  return JSON.stringify(
    {
      question: input.question,
      user_response: input.userResponse,
      retrieved_resume_chunks: chunks,
      active_prep_doc_signals: signalBlock,
      mode: input.mode ?? "speaking",
    },
    null,
    0,
  );
}

function buildQuestions(input: ScoringInput): Record<string, QuestionDef> {
  const isWriting = input.mode === "writing";
  return {
    clarity_score: {
      type: "score",
      instructions:
        "Rate clarity, pacing, and jargon-appropriate explanation in the candidate response.",
      criteria: SCORE_CRITERIA_1_TO_10,
    },
    structure_score: {
      type: "score",
      instructions: isWriting
        ? "Rate logical flow with thesis-first writing structure."
        : "Rate logical flow and STAR alignment for a behavioral/spoken interview answer.",
      criteria: SCORE_CRITERIA_1_TO_10,
    },
    conciseness_score: {
      type: "score",
      instructions: "Rate signal-to-noise: high information density without rambling.",
      criteria: SCORE_CRITERIA_1_TO_10,
    },
    evidence_alignment_score: {
      type: "score",
      instructions:
        "Rate how well the response backs claims with concrete facts/projects from retrieved resume & prep context.",
      criteria: SCORE_CRITERIA_1_TO_10,
    },
    answered_prompt_directly: {
      type: "noul",
      instructions: "Did the user directly answer the specific question asked?",
      criteria: {
        true: "Directly addresses the asked question",
        false: "Dodges, reframes, or misses the ask",
      },
    },
    hit_prep_doc_signals: {
      type: "noul",
      instructions:
        "Did the user cover company signals/keywords from the active prep doc (if any)?",
      criteria: {
        true: "Hits prep signals/keywords",
        false: "Misses prep signals or none present and no relevant themes",
      },
    },
    backed_by_real_experience: {
      type: "noul",
      instructions:
        "Did the user reference actual projects/metrics from indexed profile rather than generic hypotheticals?",
      criteria: {
        true: "Grounded in real experience/evidence",
        false: "Generic or hypothetical without personal evidence",
      },
    },
    avoided_red_flags: {
      type: "noul",
      instructions: "Did the user avoid anti-patterns listed in their prep doc?",
      criteria: {
        true: "Avoided listed red flags / anti-patterns",
        false: "Hit one or more listed red flags",
      },
    },
    primary_gap: {
      type: "choice",
      instructions: "What is the primary coaching gap for this answer?",
      criteria: {
        "Missed Prep Signals": "Failed to hit company/prep keywords and signals",
        "Lacks Concrete Resume Evidence": "Claims not backed by resume/project facts",
        "Rambling / Too Long": "Low signal-to-noise, meandering",
        "Weak Structure": "Poor STAR/thesis flow",
        "Strong Delivery": "Overall strong; no major gap",
      },
    },
    delivery_tone: {
      type: "choice",
      instructions: "Classify delivery tone of the response.",
      criteria: {
        "Confident & Crisp": "Clear, decisive, composed",
        "Hesitant / Hedging": "Lots of hedging or uncertainty markers",
        "Overly Casual": "Too informal for interview context",
        "Sounds Memorized": "Stiff/recited sounding delivery",
      },
    },
  };
}

export function buildLiveCheckpointDefs(
  signals?: PrepSignals | null,
  chunks: RetrievedChunk[] = [],
): Array<{ id: string; label: string; instructions: string }> {
  const defs: Array<{ id: string; label: string; instructions: string }> = [];

  const keywords = [
    ...(signals?.target_keywords ?? []),
    ...(signals?.company_signals ?? []),
  ].slice(0, 3);

  keywords.forEach((kw, i) => {
    defs.push({
      id: `ckpt_kw_${i}`,
      label: kw,
      instructions: `Has the speaker covered or clearly referenced: "${kw}"?`,
    });
  });

  const evidenceHints = chunks
    .filter((c) => c.doc_type === "resume" || c.doc_type === "story_bank" || c.doc_type === "project_doc")
    .slice(0, 2)
    .map((c) => (c.heading || c.content.split(/\s+/).slice(0, 6).join(" ")).trim());

  evidenceHints.forEach((hint, i) => {
    defs.push({
      id: `ckpt_ev_${i}`,
      label: hint.slice(0, 40),
      instructions: `Has the speaker grounded the answer in evidence related to: "${hint}"?`,
    });
  });

  if (defs.length < 3) {
    defs.push(
      {
        id: "ckpt_direct",
        label: "Direct answer",
        instructions: "Is the speaker directly answering the question asked so far?",
      },
      {
        id: "ckpt_metric",
        label: "Concrete metric",
        instructions: "Has the speaker mentioned a concrete metric, outcome, or number?",
      },
      {
        id: "ckpt_ownership",
        label: "Ownership",
        instructions: "Has the speaker clarified their personal ownership/role?",
      },
    );
  }

  return defs.slice(0, 5);
}

export async function scoreWithJev(
  input: ScoringInput,
  apiKey: string,
  confidenceThreshold = 0.7,
): Promise<CalibratedScorecard> {
  if (!apiKey.trim()) {
    throw new Error("Jev API key missing");
  }

  const body = {
    model: "jev-latest",
    state: buildState(input),
    questions: buildQuestions(input),
  };

  const res = await fetch(SYSTEM_ONE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jev System One error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    answers: Record<string, SystemOneAnswer>;
  };

  return answersToScorecard(data.answers, confidenceThreshold, "jev");
}

export async function scoreLiveCheckpointsWithJev(
  transcript: string,
  question: string,
  defs: Array<{ id: string; label: string; instructions: string }>,
  apiKey: string,
): Promise<LiveCheckpoint[]> {
  if (!apiKey.trim() || !transcript.trim() || defs.length === 0) {
    return defs.map((d) => ({ ...d, probability: 0, hit: false }));
  }

  const questions: Record<string, QuestionDef> = {};
  for (const d of defs) {
    questions[d.id] = {
      type: "noul",
      instructions: d.instructions,
    };
  }

  const res = await fetch(SYSTEM_ONE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "jev-latest",
      state: JSON.stringify({ question, live_transcript: transcript }),
      questions,
    }),
  });

  if (!res.ok) {
    return defs.map((d) => ({ ...d, probability: 0, hit: false }));
  }

  const data = (await res.json()) as { answers: Record<string, SystemOneAnswer> };
  return defs.map((d) => {
    const ans = data.answers[d.id] as NoulAnswer | undefined;
    const probability = ans?.noul ?? 0;
    return { ...d, probability, hit: probability >= 0.55 };
  });
}

export function answersToScorecard(
  answers: Record<string, SystemOneAnswer>,
  confidenceThreshold: number,
  engine: CalibratedScorecard["engine"],
): CalibratedScorecard {
  const clarity = asScore(answers.clarity_score, confidenceThreshold);
  const structure = asScore(answers.structure_score, confidenceThreshold);
  const conciseness = asScore(answers.conciseness_score, confidenceThreshold);
  const evidence = asScore(answers.evidence_alignment_score, confidenceThreshold);

  const primary = asChoice(answers.primary_gap) as {
    choice: PrimaryGap;
    confidence: number;
  };
  const tone = asChoice(answers.delivery_tone) as {
    choice: DeliveryTone;
    confidence: number;
  };

  const overall =
    (clarity.score + structure.score + conciseness.score + evidence.score) / 4;

  return {
    engine,
    clarity,
    structure,
    conciseness,
    evidenceAlignment: evidence,
    answeredPromptDirectly: asNoul(answers.answered_prompt_directly),
    hitPrepDocSignals: asNoul(answers.hit_prep_doc_signals),
    backedByRealExperience: asNoul(answers.backed_by_real_experience),
    avoidedRedFlags: asNoul(answers.avoided_red_flags),
    primaryGap: primary.choice,
    primaryGapConfidence: primary.confidence,
    deliveryTone: tone.choice,
    deliveryToneConfidence: tone.confidence,
    overall,
    raw: answers,
  };
}

/** Map TypeSafe 0–9 score index continuum onto 1–10 display scale. */
function scoreToTen(raw: number, legendSize = 10): number {
  if (legendSize <= 1) return raw;
  const maxIndex = legendSize - 1;
  const normalized = (raw / maxIndex) * 9 + 1;
  return Math.max(1, Math.min(10, Math.round(normalized * 10) / 10));
}

function asScore(
  answer: SystemOneAnswer | undefined,
  threshold: number,
): { score: number; confidence: number; lowConfidence: boolean } {
  if (!answer || answer.type !== "score") {
    return { score: 5, confidence: 0, lowConfidence: true };
  }
  const s = answer as ScoreAnswer;
  const legendSize = Object.keys(s.legend ?? s.probabilities).length || 10;
  const score = scoreToTen(s.score, legendSize);
  return {
    score,
    confidence: s.confidence,
    lowConfidence: s.confidence < threshold,
  };
}

function asNoul(answer: SystemOneAnswer | undefined): number {
  if (!answer || answer.type !== "noul") return 0;
  return (answer as NoulAnswer).noul;
}

function asChoice(answer: SystemOneAnswer | undefined): {
  choice: string;
  confidence: number;
} {
  if (!answer || answer.type !== "choice") {
    return { choice: "Weak Structure", confidence: 0 };
  }
  const c = answer as ChoiceAnswer;
  return { choice: c.choice, confidence: c.confidence };
}
