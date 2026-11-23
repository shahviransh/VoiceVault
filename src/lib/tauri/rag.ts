import { invoke } from "@tauri-apps/api/core";

export type DocType =
  | "resume"
  | "story_bank"
  | "career_ops_prep"
  | "project_doc"
  | "profile_fact";

export type DocumentRecord = {
  id: string;
  title: string;
  file_path: string;
  doc_type: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type ChunkRecord = {
  id: string;
  doc_id: string;
  doc_type: string;
  heading?: string | null;
  content: string;
  chunk_index: number;
  score?: number | null;
};

export type PrepMetadata = {
  questions: string[];
  company_signals: string[];
  target_keywords: string[];
  things_to_avoid: string[];
};

export type ProfileFacts = {
  target_roles: string[];
  tech_stack: string[];
  key_metrics: string[];
  star_stories: string[];
};

export type RetrieveResult = {
  chunks: ChunkRecord[];
  prep_signals?: PrepMetadata | null;
  hidden_during_blind_practice: boolean;
};

export type OfflineStatus = {
  offline_ready: boolean;
  db_initialized: boolean;
  embedding_model_ready: boolean;
  embedding_backend: string;
  db_path: string;
  model_cache_dir: string;
};

export type IngestResult = {
  document: DocumentRecord;
  prep_metadata?: PrepMetadata | null;
};

export type SessionRecord = {
  id: string;
  mode: string;
  question: string;
  response: string;
  scores_json: string;
  created_at: string;
};

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("Tauri backend unavailable in browser-only mode");
  }
  return invoke<T>(cmd, args);
}

export const ragApi = {
  ingestDocument: (file_path: string, doc_type: DocType) =>
    call<IngestResult>("ingest_document", { file_path, doc_type }),

  updateProfileFacts: (profile_json: ProfileFacts) =>
    call<DocumentRecord>("update_profile_facts", { profile_json }),

  retrieveContext: (query: string, active_prep_doc_id?: string | null, top_k = 6) =>
    call<RetrieveResult>("retrieve_context_cmd", {
      query,
      active_prep_doc_id: active_prep_doc_id ?? null,
      top_k,
    }),

  listDocuments: () => call<DocumentRecord[]>("list_documents"),

  deleteDocument: (doc_id: string) => call<void>("delete_document", { doc_id }),

  getPrepMetadata: (doc_id: string) =>
    call<PrepMetadata | null>("get_prep_metadata", { doc_id }),

  getProfileFacts: () => call<ProfileFacts>("get_profile_facts"),

  offlineStatus: () => call<OfflineStatus>("offline_status"),

  getProofPoint: () => call<ChunkRecord | null>("get_proof_point"),

  saveSession: (input: {
    mode: string;
    question: string;
    response: string;
    scores_json: string;
  }) => call<SessionRecord>("save_practice_session", { input }),

  listSessions: (limit = 50) =>
    call<SessionRecord[]>("list_practice_sessions", { limit }),

  exportSessionMd: (session_id: string) =>
    call<string>("export_session_md", { session_id }),

  setEmbeddingPrefs: (ollama_url?: string, prefer_ollama?: boolean) =>
    call<void>("set_embedding_prefs", { ollama_url, prefer_ollama }),
};

/** In-memory browser fallback so `next dev` / static web still demos the UI. */
const browserStore: {
  docs: DocumentRecord[];
  chunks: ChunkRecord[];
  prep: Record<string, PrepMetadata>;
  facts: ProfileFacts;
  sessions: SessionRecord[];
} = {
  docs: [],
  chunks: [],
  prep: {},
  facts: { target_roles: [], tech_stack: [], key_metrics: [], star_stories: [] },
  sessions: [],
};

export const browserRag = {
  async ingestText(title: string, text: string, docType: DocType): Promise<IngestResult> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const parts = text.split(/\n(?=## )/).filter(Boolean);
    const chunks: ChunkRecord[] = parts.map((content, i) => ({
      id: crypto.randomUUID(),
      doc_id: id,
      doc_type: docType,
      heading: content.match(/^##\s+(.+)$/m)?.[1] ?? null,
      content,
      chunk_index: i,
      score: null,
    }));
    const doc: DocumentRecord = {
      id,
      title,
      file_path: title,
      doc_type: docType,
      chunk_count: chunks.length,
      created_at: now,
      updated_at: now,
    };
    browserStore.docs.unshift(doc);
    browserStore.chunks.push(...chunks);
    let prep_metadata: PrepMetadata | null = null;
    if (docType === "career_ops_prep") {
      prep_metadata = {
        questions: (text.match(/^.+\?$/gm) ?? []).map((q) => q.trim()),
        company_signals: [],
        target_keywords: [],
        things_to_avoid: [],
      };
      browserStore.prep[id] = prep_metadata;
    }
    return { document: doc, prep_metadata };
  },

  listDocuments: async () => browserStore.docs,
  deleteDocument: async (docId: string) => {
    browserStore.docs = browserStore.docs.filter((d) => d.id !== docId);
    browserStore.chunks = browserStore.chunks.filter((c) => c.doc_id !== docId);
    delete browserStore.prep[docId];
  },
  retrieveContext: async (query: string, activePrepDocId?: string | null) => {
    const q = query.toLowerCase().split(/\s+/);
    const scored = browserStore.chunks
      .map((c) => {
        const hay = c.content.toLowerCase();
        const score = q.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
        return { ...c, score };
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 6);
    return {
      chunks: scored,
      prep_signals: activePrepDocId ? browserStore.prep[activePrepDocId] ?? null : null,
      hidden_during_blind_practice: true,
    };
  },
  getPrepMetadata: async (docId: string) => browserStore.prep[docId] ?? null,
  getProfileFacts: async () => browserStore.facts,
  updateProfileFacts: async (facts: ProfileFacts) => {
    browserStore.facts = facts;
    return browserRag.ingestText(
      "profile_facts.md",
      [
        facts.target_roles.length ? `## Target Roles\n${facts.target_roles.map((x) => `- ${x}`).join("\n")}` : "",
        facts.tech_stack.length ? `## Tech Stack\n${facts.tech_stack.map((x) => `- ${x}`).join("\n")}` : "",
        facts.key_metrics.length ? `## Key Metrics\n${facts.key_metrics.map((x) => `- ${x}`).join("\n")}` : "",
        facts.star_stories.length ? `## STAR Stories\n${facts.star_stories.join("\n\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      "profile_fact",
    ).then((r) => r.document);
  },
  offlineStatus: async (): Promise<OfflineStatus> => ({
    offline_ready: true,
    db_initialized: true,
    embedding_model_ready: false,
    embedding_backend: "browser-fts-fallback",
    db_path: "(browser memory)",
    model_cache_dir: "(n/a)",
  }),
  getProofPoint: async () =>
    browserStore.chunks[Math.floor(Math.random() * Math.max(1, browserStore.chunks.length))] ??
    null,
  saveSession: async (input: {
    mode: string;
    question: string;
    response: string;
    scores_json: string;
  }) => {
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      ...input,
      created_at: new Date().toISOString(),
    };
    browserStore.sessions.unshift(session);
    return session;
  },
  listSessions: async () => browserStore.sessions,
  exportSessionMd: async (sessionId: string) => {
    const s = browserStore.sessions.find((x) => x.id === sessionId);
    if (!s) throw new Error("session not found");
    return `# VoiceVault Session Debrief\n\n## Question\n${s.question}\n\n## Response\n${s.response}\n\n## Scores\n\`\`\`json\n${s.scores_json}\n\`\`\`\n`;
  },
};

export async function listDocumentsSafe() {
  try {
    return await ragApi.listDocuments();
  } catch {
    return browserRag.listDocuments();
  }
}

export async function retrieveSafe(
  query: string,
  activePrepDocId?: string | null,
  topK = 6,
) {
  try {
    return await ragApi.retrieveContext(query, activePrepDocId, topK);
  } catch {
    return browserRag.retrieveContext(query, activePrepDocId);
  }
}

export async function offlineStatusSafe() {
  try {
    return await ragApi.offlineStatus();
  } catch {
    return browserRag.offlineStatus();
  }
}
