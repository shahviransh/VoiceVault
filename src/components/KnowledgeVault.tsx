"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookMarked,
  ClipboardType,
  FileText,
  FolderGit2,
  Loader2,
  Search,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  UserRound,
} from "lucide-react";
import { generateStarSkeletons } from "@/lib/ai/coach";
import type { AppSettings, StarSkeleton } from "@/lib/ai/types";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
  browserRag,
  isTauri,
  listDocumentsSafe,
  ragApi,
  retrieveSafe,
  type DocType,
  type DocumentRecord,
  type ProfileFacts,
  type RetrieveResult,
} from "@/lib/tauri/rag";
import { cn } from "@/lib/utils";
import { Card, CardHeader, EmptyState, FieldLabel, PageHeader, Segmented } from "./ui/primitives";

const DOC_TYPES: { value: DocType; label: string; icon: typeof FileText }[] = [
  { value: "resume", label: "Resume", icon: FileText },
  { value: "story_bank", label: "Story bank", icon: BookMarked },
  { value: "career_ops_prep", label: "Prep doc", icon: Target },
  { value: "project_doc", label: "Project", icon: FolderGit2 },
];

const DOC_ICON: Record<string, typeof FileText> = {
  resume: FileText,
  story_bank: BookMarked,
  career_ops_prep: Target,
  project_doc: FolderGit2,
  profile_fact: UserRound,
};

const DOC_LABEL: Record<string, string> = {
  resume: "Resume",
  story_bank: "Story bank",
  career_ops_prep: "career-ops prep",
  project_doc: "Project doc",
  profile_fact: "Profile facts",
};

export function KnowledgeVault({
  documents,
  onDocumentsChange,
  settings = DEFAULT_SETTINGS,
}: {
  documents: DocumentRecord[];
  onDocumentsChange: (docs: DocumentRecord[]) => void;
  settings?: AppSettings;
}) {
  const [docType, setDocType] = useState<DocType>("resume");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<RetrieveResult | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [stars, setStars] = useState<StarSkeleton[]>([]);
  const [starBusy, setStarBusy] = useState(false);
  const [factDraft, setFactDraft] = useState({
    target_roles: "",
    tech_stack: "",
    key_metrics: "",
    star_stories: "",
  });

  const refresh = useCallback(async () => {
    onDocumentsChange(await listDocumentsSafe());
  }, [onDocumentsChange]);

  useEffect(() => {
    (async () => {
      try {
        const facts = isTauri() ? await ragApi.getProfileFacts() : await browserRag.getProfileFacts();
        setFactDraft({
          target_roles: facts.target_roles.join("\n"),
          tech_stack: facts.tech_stack.join("\n"),
          key_metrics: facts.key_metrics.join("\n"),
          star_stories: facts.star_stories.join("\n\n"),
        });
      } catch {
        /* no saved facts yet */
      }
    })();
  }, []);

  const totalChunks = documents.reduce((n, d) => n + d.chunk_count, 0);

  const ingestPath = async (path: string) => {
    setBusy(true);
    setMessage(`Indexing ${path.split(/[\\/]/).pop()}…`);
    try {
      await ragApi.ingestDocument(path, docType);
      await refresh();
      setMessage(`Indexed ${path.split(/[\\/]/).pop()}`);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFiles = async () => {
    if (!isTauri()) {
      setMessage("The file picker runs in the desktop app. Drop a file or paste text instead.");
      setShowPaste(true);
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: [{ name: "Docs", extensions: ["pdf", "md", "txt", "markdown"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) await ingestPath(p);
    } catch (e) {
      setMessage(String(e));
    }
  };

  const ingestPasted = async (text: string, title: string) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await browserRag.ingestText(title || "pasted.md", text, docType);
      await refresh();
      setMessage(`Indexed ${title || "pasted document"}`);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const withPath = file as File & { path?: string };
    if (isTauri() && typeof withPath.path === "string") {
      await ingestPath(withPath.path);
      return;
    }
    await ingestPasted(await file.text(), file.name);
  };

  const remove = async (id: string) => {
    try {
      if (isTauri()) await ragApi.deleteDocument(id);
      else await browserRag.deleteDocument(id);
      await refresh();
    } catch (e) {
      setMessage(String(e));
    }
  };

  const testRetrieve = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const prep = documents.find((d) => d.doc_type === "career_ops_prep");
      setResult(await retrieveSafe(query, prep?.id ?? null, 6));
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveFacts = async () => {
    const next: ProfileFacts = {
      target_roles: splitLines(factDraft.target_roles),
      tech_stack: splitLines(factDraft.tech_stack),
      key_metrics: splitLines(factDraft.key_metrics),
      star_stories: factDraft.star_stories
        .split(/\n\n+/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    setBusy(true);
    try {
      if (isTauri()) await ragApi.updateProfileFacts(next);
      else await browserRag.updateProfileFacts(next);
      await refresh();
      setMessage("Profile facts re-indexed");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const draftStars = async () => {
    setStarBusy(true);
    setMessage("Drafting STAR skeletons from vault…");
    try {
      const ctx = await retrieveSafe("impact ownership leadership project results metrics", null, 10);
      const drafts = await generateStarSkeletons(ctx.chunks, settings);
      setStars(drafts);
      setMessage(
        drafts.length
          ? `Drafted ${drafts.length} STAR skeletons — edit before treating as answers`
          : "No story-ready chunks found — ingest resume / story bank / projects first",
      );
    } catch (e) {
      setMessage(String(e));
    } finally {
      setStarBusy(false);
    }
  };

  const applyStarToFacts = (s: StarSkeleton) => {
    const block = [
      s.title,
      `Situation: ${s.situation}`,
      `Task: ${s.task}`,
      `Action: ${s.action}`,
      `Result: ${s.result}`,
    ].join("\n");
    setFactDraft((prev) => ({
      ...prev,
      star_stories: prev.star_stories.trim() ? `${prev.star_stories.trim()}\n\n${block}` : block,
    }));
    setMessage(`Added "${s.title}" into Profile facts — review, then Save & re-index`);
  };

  const maxScore = Math.max(...(result?.chunks.map((c) => c.score ?? 0) ?? [0]), 0.0001);

  return (
    <div>
      <PageHeader
        index="01"
        kicker="Knowledge Vault"
        title="Your evidence, indexed"
        description="Resume, story bank, project docs, and career-ops prep briefs — chunked and embedded locally so every score is grounded in what you've actually done."
        actions={
          <>
            <span className="chip h-8 px-3">
              <span className="mono-num text-ink">{documents.length}</span> docs
            </span>
            <span className="chip h-8 px-3">
              <span className="mono-num text-ink">{totalChunks}</span> chunks
            </span>
          </>
        }
      />

      <div className="stagger space-y-4">
        <Card
          className={cn(
            "relative overflow-hidden border-dashed p-6 transition",
            dragging && "border-accent ring-4 ring-accent-soft",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div
            className="pointer-events-none absolute -left-20 -top-28 h-64 w-64 rounded-full blur-3xl"
            style={{ background: "var(--halo-1)" }}
          />
          <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-linear-to-b from-accent-2 to-accent text-accent-fg shadow-[0_12px_28px_-10px_var(--glow)]">
              {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <UploadCloud className="h-6 w-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-xl font-semibold text-ink">
                {dragging ? "Release to index" : "Drop a PDF, Markdown, or text file"}
              </h3>
              <p className="mt-1 text-sm text-ink-soft">
                Split by headings, embedded on-device, stored in SQLite + sqlite-vec + FTS5.
              </p>
              <Segmented
                className="mt-4"
                value={docType}
                onChange={setDocType}
                options={DOC_TYPES}
              />
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <button type="button" onClick={pickFiles} disabled={busy} className="btn btn-primary">
                Browse files
              </button>
              <button
                type="button"
                onClick={() => setShowPaste((v) => !v)}
                className="btn btn-ghost btn-sm"
              >
                <ClipboardType className="h-3.5 w-3.5" /> {showPaste ? "Hide" : "Paste text"}
              </button>
            </div>
          </div>
          {showPaste && <PasteIngest onIngest={ingestPasted} busy={busy} />}
          {message && (
            <p className="relative mt-4 text-xs text-ink-soft">
              <span className="kicker mr-2">Log</span>
              {message}
            </p>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="p-5 lg:col-span-2">
            <CardHeader
              icon={FileText}
              title="Indexed documents"
              subtitle="Everything VoiceVault can cite back to you"
            />
            {documents.length ? (
              <ul className="space-y-2">
                {documents.map((d) => {
                  const Icon = DOC_ICON[d.doc_type] ?? FileText;
                  return (
                    <li
                      key={d.id}
                      className="group flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 transition hover:border-line-strong"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink">{d.title}</div>
                        <div className="text-[11px] text-ink-faint">
                          {DOC_LABEL[d.doc_type] ?? d.doc_type} ·{" "}
                          <span className="mono-num">{d.chunk_count}</span> chunks
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(d.id)}
                        className="btn btn-ghost btn-icon h-8 w-8 opacity-60 hover:text-danger group-hover:opacity-100"
                        aria-label={`Delete ${d.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={FileText}
                title="Vault is empty"
                body="Start with your resume and one career-ops prep brief — that's enough for grounded scoring."
              />
            )}
          </Card>

          <Card className="p-5 lg:col-span-3">
            <CardHeader
              icon={Search}
              title="Retrieval tester"
              subtitle="Hybrid search: vector cosine + BM25, fused with RRF"
            />
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void testRetrieve();
              }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Tell me about reducing latency"
                className="input"
              />
              <button type="submit" disabled={busy || !query.trim()} className="btn btn-secondary">
                Retrieve
              </button>
            </form>
            {result ? (
              <ol className="mt-4 space-y-2">
                {result.chunks.map((c, i) => (
                  <li key={c.id} className="card-inset p-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="mono-num text-[11px] text-ink-faint">#{i + 1}</span>
                      <span className="chip chip-accent h-5 px-2 text-[10px]">
                        {DOC_LABEL[c.doc_type] ?? c.doc_type}
                      </span>
                      {c.heading && (
                        <span className="truncate text-xs font-semibold text-ink-soft">{c.heading}</span>
                      )}
                      {typeof c.score === "number" && (
                        <span className="ml-auto flex items-center gap-1.5">
                          <span className="h-1 w-12 overflow-hidden rounded-full bg-line-strong">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${(c.score / maxScore) * 100}%` }}
                            />
                          </span>
                          <span className="mono-num text-[10px] text-ink-faint">{c.score.toFixed(3)}</span>
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-3 text-sm leading-relaxed text-ink-soft">{c.content}</p>
                  </li>
                ))}
                {!result.chunks.length && (
                  <li className="text-sm text-ink-faint">No matching chunks.</li>
                )}
              </ol>
            ) : (
              <p className="mt-4 text-xs text-ink-faint">
                Type a sample interview question to preview what the scorer will see.
              </p>
            )}
          </Card>
        </div>

        <Card className="p-5">
          <CardHeader
            icon={Sparkles}
            title="Story-bank enrichment"
            subtitle="Draft STAR skeletons from indexed docs — edit them; never memorize AI-final answers"
            actions={
              <button
                type="button"
                onClick={() => void draftStars()}
                disabled={starBusy || !documents.length}
                className="btn btn-secondary btn-sm"
              >
                {starBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Draft STAR skeletons
              </button>
            }
          />
          {stars.length ? (
            <ul className="space-y-3">
              {stars.map((s) => (
                <li key={`${s.title}-${s.sourceHint}`} className="card-inset p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-display text-base font-semibold text-ink">{s.title}</div>
                      <div className="kicker mt-1">{s.sourceHint}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => applyStarToFacts(s)}
                      className="btn btn-ghost btn-sm"
                    >
                      Add to profile facts
                    </button>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm text-ink-soft sm:grid-cols-2">
                    <div>
                      <dt className="kicker">Situation</dt>
                      <dd>{s.situation}</dd>
                    </div>
                    <div>
                      <dt className="kicker">Task</dt>
                      <dd>{s.task}</dd>
                    </div>
                    <div>
                      <dt className="kicker">Action</dt>
                      <dd>{s.action}</dd>
                    </div>
                    <div>
                      <dt className="kicker">Result</dt>
                      <dd>{s.result}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-faint">
              Skeletons stay editable drafts aligned with MindVault — you own the final stories.
            </p>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader
            icon={UserRound}
            title="Profile facts"
            subtitle="Quick facts that re-index into the vault automatically"
            actions={
              <button type="button" onClick={saveFacts} disabled={busy} className="btn btn-primary btn-sm">
                Save & re-index
              </button>
            }
          />
          <div className="grid gap-3 md:grid-cols-2">
            <FactField
              label="Target roles"
              hint="one per line"
              value={factDraft.target_roles}
              onChange={(v) => setFactDraft((s) => ({ ...s, target_roles: v }))}
              placeholder="Staff Platform Engineer"
            />
            <FactField
              label="Tech stack"
              hint="one per line"
              value={factDraft.tech_stack}
              onChange={(v) => setFactDraft((s) => ({ ...s, tech_stack: v }))}
              placeholder={"Rust\nPostgres\nKubernetes"}
            />
            <FactField
              label="Key metrics"
              hint="one per line"
              value={factDraft.key_metrics}
              onChange={(v) => setFactDraft((s) => ({ ...s, key_metrics: v }))}
              placeholder="Cut checkout p95 from 900ms → 240ms"
            />
            <FactField
              label="STAR stories"
              hint="blank line between"
              value={factDraft.star_stories}
              onChange={(v) => setFactDraft((s) => ({ ...s, star_stories: v }))}
              placeholder="Situation… Task… Action… Result…"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function FactField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={placeholder}
        className="input resize-y leading-relaxed"
      />
    </label>
  );
}

function PasteIngest({
  onIngest,
  busy,
}: {
  onIngest: (text: string, title: string) => Promise<void>;
  busy: boolean;
}) {
  const [title, setTitle] = useState("pasted.md");
  const [text, setText] = useState("");
  return (
    <div className="relative mt-5 grid gap-2 border-t border-line pt-5 animate-fade">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="input"
        placeholder="Filename"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Paste Markdown or plain text…"
        className="input resize-y"
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={() => void onIngest(text, title).then(() => setText(""))}
        className="btn btn-secondary justify-self-start"
      >
        Index pasted text
      </button>
    </div>
  );
}

function splitLines(s: string): string[] {
  return s
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
