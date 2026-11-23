import type {
  CalibratedScorecard,
  DeliveryTone,
  LiveCheckpoint,
  PrepSignals,
  PrimaryGap,
  ScoringInput,
} from "./types";
import { buildLiveCheckpointDefs } from "./jev-scorer";

const FILLERS = ["um", "uh", "erm", "like", "basically", "literally", "you know", "sort of", "kind of"];
const HEDGES = ["maybe", "kind of", "sort of", "i think", "i guess", "probably", "possibly", "not sure"];

export type DeliveryTelemetry = {
  wordCount: number;
  durationSec: number;
  wpm: number;
  earlyWpm: number;
  lateWpm: number;
  fillerCount: number;
  fillersPer100: number;
  hedgeCount: number;
  hedgeRatio: number;
  silenceGaps: number;
  keywordOverlap: number;
  ngramOverlap: number;
};

export function analyzeDelivery(
  text: string,
  durationSec: number,
  silenceGaps = 0,
  earlyWpm = 0,
  lateWpm = 0,
  prep?: PrepSignals | null,
  chunkTexts: string[] = [],
): DeliveryTelemetry {
  const words = tokenize(text);
  const wordCount = words.length;
  const wpm = durationSec > 0 ? (wordCount / durationSec) * 60 : 0;
  const lower = text.toLowerCase();

  let fillerCount = 0;
  for (const f of FILLERS) {
    const re = new RegExp(`\\b${escapeReg(f)}\\b`, "gi");
    fillerCount += (lower.match(re) ?? []).length;
  }

  let hedgeCount = 0;
  for (const h of HEDGES) {
    const re = new RegExp(`\\b${escapeReg(h)}\\b`, "gi");
    hedgeCount += (lower.match(re) ?? []).length;
  }

  const corpus = [
    ...(prep?.target_keywords ?? []),
    ...(prep?.company_signals ?? []),
    ...chunkTexts,
  ]
    .join(" ")
    .toLowerCase();

  const keywordOverlap = overlapRatio(words, tokenize(corpus));
  const ngramOverlap = jaccard(ngrams(words, 2), ngrams(tokenize(corpus), 2));

  return {
    wordCount,
    durationSec,
    wpm: round1(wpm),
    earlyWpm: round1(earlyWpm || wpm),
    lateWpm: round1(lateWpm || wpm),
    fillerCount,
    fillersPer100: wordCount ? round1((fillerCount / wordCount) * 100) : 0,
    hedgeCount,
    hedgeRatio: wordCount ? round1(hedgeCount / wordCount) : 0,
    silenceGaps,
    keywordOverlap: round1(keywordOverlap),
    ngramOverlap: round1(ngramOverlap),
  };
}

export function scoreWithHeuristics(
  input: ScoringInput,
  telemetry?: DeliveryTelemetry,
  confidenceThreshold = 0.7,
): CalibratedScorecard {
  const tel =
    telemetry ??
    analyzeDelivery(
      input.userResponse,
      Math.max(30, tokenize(input.userResponse).length / 2),
      0,
      0,
      0,
      input.activePrepDocSignals,
      input.retrievedResumeChunks.map((c) => c.content),
    );

  const clarity = clamp(
    10 -
      tel.fillersPer100 * 0.8 -
      (tel.wpm > 180 ? 1.5 : 0) -
      (tel.wpm < 90 && tel.wordCount > 40 ? 1 : 0),
    1,
    10,
  );

  const structure = estimateStructure(input.userResponse, input.mode);
  const conciseness = clamp(
    10 - Math.max(0, tel.wordCount - 220) / 40 - tel.hedgeRatio * 8,
    1,
    10,
  );
  const evidence = clamp(3 + tel.keywordOverlap * 5 + tel.ngramOverlap * 4, 1, 10);

  const answered = directAnswerScore(input.question, input.userResponse);
  const hitSignals = tel.keywordOverlap;
  const backed = Math.min(1, tel.ngramOverlap * 1.4 + tel.keywordOverlap * 0.5);
  const avoided = estimateAvoided(input.userResponse, input.activePrepDocSignals);

  let primaryGap: PrimaryGap = "Strong Delivery";
  if (hitSignals < 0.15 && (input.activePrepDocSignals?.target_keywords.length ?? 0) > 0) {
    primaryGap = "Missed Prep Signals";
  } else if (backed < 0.2) {
    primaryGap = "Lacks Concrete Resume Evidence";
  } else if (tel.wordCount > 280 || tel.fillersPer100 > 6) {
    primaryGap = "Rambling / Too Long";
  } else if (structure < 5.5) {
    primaryGap = "Weak Structure";
  }

  let deliveryTone: DeliveryTone = "Confident & Crisp";
  if (tel.hedgeRatio > 0.04 || tel.fillersPer100 > 5) {
    deliveryTone = "Hesitant / Hedging";
  } else if (/\b(lol|gonna|wanna|stuff|things)\b/i.test(input.userResponse)) {
    deliveryTone = "Overly Casual";
  } else if (tel.wpm > 0 && Math.abs(tel.earlyWpm - tel.lateWpm) < 5 && tel.hedgeRatio < 0.01) {
    deliveryTone = "Sounds Memorized";
  }

  const conf = clamp(0.45 + tel.wordCount / 400, 0.4, 0.85);

  const mk = (score: number) => ({
    score: round1(score),
    confidence: round1(conf),
    lowConfidence: conf < confidenceThreshold,
  });

  return {
    engine: "heuristic",
    clarity: mk(clarity),
    structure: mk(structure),
    conciseness: mk(conciseness),
    evidenceAlignment: mk(evidence),
    answeredPromptDirectly: round1(answered),
    hitPrepDocSignals: round1(hitSignals),
    backedByRealExperience: round1(backed),
    avoidedRedFlags: round1(avoided),
    primaryGap,
    primaryGapConfidence: round1(conf),
    deliveryTone,
    deliveryToneConfidence: round1(conf),
    overall: round1((clarity + structure + conciseness + evidence) / 4),
  };
}

export function liveCheckpointsFromHeuristics(
  transcript: string,
  signals?: PrepSignals | null,
  chunks: ScoringInput["retrievedResumeChunks"] = [],
): LiveCheckpoint[] {
  const defs = buildLiveCheckpointDefs(signals, chunks);
  const lower = transcript.toLowerCase();
  return defs.map((d) => {
    const tokens = tokenize(d.label);
    const hits = tokens.filter((t) => t.length > 2 && lower.includes(t)).length;
    const probability = tokens.length ? hits / tokens.length : 0;
    return { ...d, probability: round1(probability), hit: probability >= 0.45 };
  });
}

function estimateStructure(text: string, mode?: string): number {
  const lower = text.toLowerCase();
  let score = 5;
  if (mode === "writing") {
    if (/^[A-Z]/.test(text.trim())) score += 0.5;
    if (text.includes("\n") || /however|therefore|because|tradeoff/.test(lower)) score += 1;
  } else {
    if (/situation|challenge|problem|context/.test(lower)) score += 1;
    if (/action|i (led|built|designed|implemented|owned)/.test(lower)) score += 1.2;
    if (/result|impact|outcome|increased|reduced|%\b/.test(lower)) score += 1.2;
  }
  return clamp(score, 1, 10);
}

function directAnswerScore(question: string, answer: string): number {
  const qTokens = new Set(tokenize(question).filter((t) => t.length > 3));
  const aTokens = new Set(tokenize(answer));
  if (qTokens.size === 0) return answer.trim() ? 0.6 : 0;
  let hit = 0;
  for (const t of qTokens) if (aTokens.has(t)) hit += 1;
  return clamp(hit / qTokens.size + (answer.length > 40 ? 0.2 : 0), 0, 1);
}

function estimateAvoided(text: string, prep?: PrepSignals | null): number {
  const avoids = prep?.things_to_avoid ?? [];
  if (!avoids.length) return 0.75;
  const lower = text.toLowerCase();
  const hits = avoids.filter((a) => lower.includes(a.toLowerCase())).length;
  return clamp(1 - hits / avoids.length, 0, 1);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%\s_-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function ngrams(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    out.add(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function overlapRatio(words: string[], corpus: string[]): number {
  if (!words.length || !corpus.length) return 0;
  const set = new Set(corpus);
  const meaningful = words.filter((w) => w.length > 3);
  if (!meaningful.length) return 0;
  const hits = meaningful.filter((w) => set.has(w)).length;
  return hits / meaningful.length;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 100) / 100;
}
