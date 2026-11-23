import type { CalibratedScorecard, ScoreDelta } from "./types";

const KEY = "voicevault.attempt-history.v1";

export type AttemptSnapshot = {
  questionKey: string;
  overall: number;
  clarity: number;
  structure: number;
  conciseness: number;
  evidenceAlignment: number;
  at: number;
};

function normalizeQuestion(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 240);
}

function loadAll(): AttemptSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AttemptSnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(rows: AttemptSnapshot[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(rows.slice(-80)));
}

export function findPreviousAttempt(question: string): AttemptSnapshot | null {
  const key = normalizeQuestion(question);
  const rows = loadAll().filter((r) => r.questionKey === key);
  if (!rows.length) return null;
  return rows[rows.length - 1] ?? null;
}

export function recordAttempt(question: string, card: CalibratedScorecard) {
  const rows = loadAll();
  rows.push({
    questionKey: normalizeQuestion(question),
    overall: card.overall,
    clarity: card.clarity.score,
    structure: card.structure.score,
    conciseness: card.conciseness.score,
    evidenceAlignment: card.evidenceAlignment.score,
    at: Date.now(),
  });
  saveAll(rows);
}

export function computeDelta(
  card: CalibratedScorecard,
  previous: AttemptSnapshot | null,
): ScoreDelta | null {
  if (!previous) return null;
  const d = (a: number, b: number) => Math.round((a - b) * 10) / 10;
  return {
    clarity: d(card.clarity.score, previous.clarity),
    structure: d(card.structure.score, previous.structure),
    conciseness: d(card.conciseness.score, previous.conciseness),
    evidenceAlignment: d(card.evidenceAlignment.score, previous.evidenceAlignment),
    overall: d(card.overall, previous.overall),
    previousOverall: previous.overall,
  };
}

export function attachDelta(question: string, card: CalibratedScorecard): CalibratedScorecard {
  const previous = findPreviousAttempt(question);
  const delta = computeDelta(card, previous);
  recordAttempt(question, card);
  return { ...card, delta };
}
