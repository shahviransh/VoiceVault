import type { InterviewType } from "./types";

export const INTERVIEW_TYPES: {
  id: InterviewType;
  label: string;
  blurb: string;
}[] = [
  { id: "behavioral", label: "Behavioral", blurb: "STAR ownership stories" },
  { id: "system_design", label: "System design", blurb: "Tradeoffs & scale" },
  { id: "product", label: "Product", blurb: "Users, metrics, bets" },
  { id: "coding_verbal", label: "Coding verbal", blurb: "Algorithms out loud" },
  { id: "general", label: "General", blurb: "Mixed interview coach" },
];

export function interviewTypeLabel(id: InterviewType): string {
  return INTERVIEW_TYPES.find((t) => t.id === id)?.label ?? id;
}

/** Rubric overlays injected into System One / LLM scoring prompts. */
export function structureInstructions(type: InterviewType, mode?: string): string {
  if (mode === "writing") {
    return "Rate logical flow with thesis-first writing structure.";
  }
  switch (type) {
    case "behavioral":
      return "Rate STAR alignment: Situation → Task → Action → Result with clear ownership.";
    case "system_design":
      return "Rate architecture clarity: requirements, API/data model, bottlenecks, tradeoffs, and scale path.";
    case "product":
      return "Rate product sense: user problem, metrics/success, options, recommendation, and risks.";
    case "coding_verbal":
      return "Rate verbal problem-solving: restated problem, approach, complexity, edge cases, and correctness checks.";
    default:
      return "Rate logical flow and interview-ready structure for a spoken answer.";
  }
}

export function clarityInstructions(type: InterviewType): string {
  switch (type) {
    case "system_design":
      return "Rate clarity of system explanation: components named, jargon used appropriately, listener can redraw the design.";
    case "coding_verbal":
      return "Rate clarity of algorithm narration: steps ordered, variables intentional, no hand-waving.";
    case "product":
      return "Rate clarity of product reasoning: crisp problem framing and decisive recommendation.";
    default:
      return "Rate clarity, pacing, and jargon-appropriate explanation in the candidate response.";
  }
}

export function evidenceInstructions(type: InterviewType): string {
  switch (type) {
    case "behavioral":
      return "Rate grounding in concrete resume/project facts, metrics, and personal ownership from retrieved context.";
    case "system_design":
      return "Rate use of prior systems experience from the vault as concrete analogies (not generic textbook designs).";
    case "product":
      return "Rate use of real product/ops metrics and outcomes from the vault vs generic frameworks.";
    case "coding_verbal":
      return "Rate whether complexity claims and approach map to real past engineering work when relevant.";
    default:
      return "Rate how well the response backs claims with concrete facts/projects from retrieved resume & prep context.";
  }
}

export function typeHintBlock(type: InterviewType): string {
  const map: Record<InterviewType, string> = {
    behavioral: "Interview type: behavioral — expect STAR, ownership, conflict/impact stories.",
    system_design: "Interview type: system design — expect requirements, components, tradeoffs, failure modes.",
    product: "Interview type: product — expect users, metrics, prioritization, recommendation.",
    coding_verbal: "Interview type: coding verbal — expect approach, complexity, edge cases spoken aloud.",
    general: "Interview type: general mixed interview.",
  };
  return map[type];
}
