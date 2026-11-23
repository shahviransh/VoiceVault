export type ScoreAnswer = {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  legend?: Record<string, string>;
  confidence: number;
};

export type NoulAnswer = {
  type: "noul";
  noul: number;
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type SystemOneAnswer = ScoreAnswer | NoulAnswer | ChoiceAnswer;

export type PrimaryGap =
  | "Missed Prep Signals"
  | "Lacks Concrete Resume Evidence"
  | "Rambling / Too Long"
  | "Weak Structure"
  | "Strong Delivery";

export type DeliveryTone =
  | "Confident & Crisp"
  | "Hesitant / Hedging"
  | "Overly Casual"
  | "Sounds Memorized";

export type InterviewType =
  | "behavioral"
  | "system_design"
  | "product"
  | "coding_verbal"
  | "general";

export type RetrievedChunk = {
  id: string;
  doc_id: string;
  doc_type: string;
  heading?: string | null;
  content: string;
  chunk_index: number;
  score?: number | null;
};

export type PrepSignals = {
  questions: string[];
  company_signals: string[];
  target_keywords: string[];
  things_to_avoid: string[];
};

export type SpeechMetrics = {
  wpm: number;
  fillersPer100: number;
  hedgeRatio: number;
  silenceGaps: number;
  durationSec: number;
  earlyWpm: number;
  lateWpm: number;
  fillerCount?: number;
  wordCount?: number;
};

export type ScoringInput = {
  question: string;
  userResponse: string;
  retrievedResumeChunks: RetrievedChunk[];
  activePrepDocSignals?: PrepSignals | null;
  mode?: "speaking" | "writing" | "proof_point" | "bridge";
  interviewType?: InterviewType;
  speechMetrics?: SpeechMetrics | null;
};

export type LiveCheckpoint = {
  id: string;
  label: string;
  instructions: string;
  probability: number;
  hit: boolean;
};

export type EvidenceCitation = {
  chunkId: string;
  reason: string;
  strength: number;
};

export type ScoreDelta = {
  clarity: number;
  structure: number;
  conciseness: number;
  evidenceAlignment: number;
  overall: number;
  previousOverall: number;
};

export type FallbackStep = {
  provider: AiProviderKind;
  ok: boolean;
  reason?: string;
};

export type RetrievalHint = {
  docType: string;
  label: string;
  reason: string;
};

export type CalibratedScorecard = {
  engine: "jev" | "browser" | "ollama" | "lmstudio" | "byok" | "heuristic";
  clarity: { score: number; confidence: number; lowConfidence: boolean };
  structure: { score: number; confidence: number; lowConfidence: boolean };
  conciseness: { score: number; confidence: number; lowConfidence: boolean };
  evidenceAlignment: { score: number; confidence: number; lowConfidence: boolean };
  answeredPromptDirectly: number;
  hitPrepDocSignals: number;
  backedByRealExperience: number;
  avoidedRedFlags: number;
  primaryGap: PrimaryGap;
  primaryGapConfidence: number;
  deliveryTone: DeliveryTone;
  deliveryToneConfidence: number;
  overall: number;
  liveCheckpoints?: LiveCheckpoint[];
  critique?: string;
  /** Critique withheld until confidence clears threshold or strict sync later */
  critiqueDeferred?: boolean;
  critiqueDeferredReason?: string;
  citations?: EvidenceCitation[];
  delta?: ScoreDelta | null;
  fallbackChain?: FallbackStep[];
  retrievalHints?: RetrievalHint[];
  followUps?: string[];
  raw?: Record<string, SystemOneAnswer>;
};

export type AiProviderKind =
  | "jev"
  | "chrome_prompt"
  | "web_llm"
  | "ollama"
  | "lmstudio"
  | "openai"
  | "anthropic"
  | "gemini"
  | "heuristic";

/** Prefer web_llm when @mlc-ai/web-llm or @huggingface/transformers is installed. */

export type AppSettings = {
  jevApiKey: string;
  ollamaUrl: string;
  preferOllamaEmbeddings: boolean;
  lmStudioUrl: string;
  lmStudioModel: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  strictMindVaultMode: boolean;
  confidenceThreshold: number;
  preferredProvider: AiProviderKind;
  enableCoachCritique: boolean;
  defaultInterviewType: InterviewType;
  checkpointIntervalSec: number;
  deferCritiqueInStrictMode: boolean;
};

export type GeneratedQuestion = {
  text: string;
  interviewType: InterviewType;
  difficulty: "easy" | "medium" | "hard";
  focus: string;
};

export type StarSkeleton = {
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  sourceHint: string;
};

export type SessionAttempt = {
  id: string;
  question: string;
  overall: number;
  primaryGap: PrimaryGap;
  interviewType: InterviewType;
  mode: string;
  at: number;
};

export type SessionCoachSummary = {
  topGaps: string[];
  wins: string[];
  practicePlan: string[];
  averageOverall: number;
  attemptCount: number;
  engine: string;
};

export type ProviderHealth = {
  id: AiProviderKind;
  label: string;
  status: "ok" | "warn" | "down" | "skip";
  detail: string;
};

export type BridgeCompare = {
  writingStructure: number;
  speakingStructure: number;
  writingOverall: number;
  speakingOverall: number;
  structureDelta: number;
};
