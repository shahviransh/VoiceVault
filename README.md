# VoiceVault

Distraction-free, offline-capable interview prep and speaking/writing practice studio.

VoiceVault pairs with **MindVault** (blocks external AI so you think independently) and **career-ops** (Markdown interview prep briefs). Instead of generating answers, it indexes *your* resume, project docs, and prep files into a **native Rust local RAG database**, retrieves personal context per question, and uses **Jev** (TypeSafe AI System One) plus local/free fallbacks to grade, verify factual alignment, and score delivery.

## Stack

- **Desktop:** Tauri v2 (Rust) - single binary, no Python sidecars
- **Frontend:** Next.js 15 static export + TypeScript + Tailwind + Lucide
- **RAG:** `rusqlite` (bundled) + `sqlite-vec` + FTS5 hybrid search, `fastembed` (`AllMiniLML6V2`), `pdf-extract`, `pulldown-cmark`
- **Speech:** Web Speech API + MediaRecorder
- **Scoring:** Jev System One → LM Studio / Ollama / Chrome Prompt API / BYOK → deterministic heuristics

## Quick start

```bash
npm install
npm run tauri:dev
```

Web-only UI preview (browser RAG fallback, no native embeddings):

```bash
npm run dev
```

Production desktop build:

```bash
npm run tauri:build
```

## Practice modes

1. **Knowledge Vault** - ingest resume / story-bank / career-ops prep / project docs; profile facts; STAR skeleton drafts; retrieval tester
2. **Speaking Studio** - interview-type rubrics, company-signal drill, personal mock-question generation, mid-answer checkpoints, follow-ups, delta vs last attempt, session coach summary
3. **Writing Studio** - timed drills with Focus Lock, then **Writing → Speaking bridge** retell
4. **30-Second Proof-Point** - defend a vault chunk, then answer a pushback prompt

## AI / Jev features

- Adaptive System One rubrics by interview type (behavioral / system design / product / coding verbal)
- Evidence citations highlighted on the scorecard
- Confidence-gated coach critique (+ Strict MindVault defer-and-sync later)
- Explicit fallback chain banner (Jev → LM Studio → Ollama → heuristics)
- Provider health strip in the sidebar
- Speech metrics (WPM, fillers, hedges, silence) fused into scoring
- Retrieval hints when the vault is missing the docs you need

## Settings

- Jev API key (`POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`)
- Ollama URL + prefer-Ollama embeddings for Rust RAG
- **LM Studio** local OpenAI-compatible server (`http://localhost:1234`) with model auto-detect
- Default interview type + mid-answer checkpoint interval
- Light / Dark / System theme toggle
- Strict MindVault Mode (local-first; optional deferred critique)
- Confidence threshold (default `0.70`) for low-confidence highlighting

## Data location

Desktop app data (SQLite + embedding model cache):

`$APP_DATA/voicevault.db` and `$APP_DATA/models/`

## Agent prompt - generate VoiceVault vault files

Paste this into **career-ops**, Cursor, ChatGPT, Claude, or any other agent that can read a resume / LinkedIn / portfolio. It produces Markdown VoiceVault can ingest directly (prep docs are parsed for signals; other docs are chunked on `##` / `###` headings).

```text
You are preparing interview practice material for VoiceVault, an offline interview
prep studio. VoiceVault does NOT want polished final answers. It wants MY evidence
and company-specific coaching signals so it can retrieve, grade, and push back.

Given the profile / resume / notes I provide (and optional target company + role),
output ONLY the Markdown files below. Use real facts from my materials. If a metric
or detail is missing, write `[add metric]` or `[unknown]` - never invent employers,
titles, or numbers.

Rules:
- Prefer concrete ownership, metrics, tradeoffs, and decisions over buzzwords.
- Keep language first-person where it is my experience.
- Use `##` / `###` headings so VoiceVault can chunk cleanly.
- Do not write a full "perfect interview answer" script.

────────────────────────────────────────
FILE 1 - career-ops prep (ingest as: career_ops_prep)
Filename: {company-or-role}-prep.md

Exact section headings VoiceVault parses (keep these names):

# {Company} - {Role} Interview Prep

## Company Signals
- 4–8 bullets: what this company rewards in interviews (ownership, shipping, etc.)

## Target Keywords
- 5–10 short phrases I should naturally hit (product/tech language for THIS role)

## Things to Avoid
- 4–8 anti-patterns / red flags for THIS company or my habits

## Likely Questions
1. …
2. …
(5–10 questions: mix behavioral + role-specific)

────────────────────────────────────────
FILE 2 - story bank (ingest as: story_bank)
Filename: story-bank.md

## STAR - {short title}
**Situation:** …
**Task:** …
**Action:** … (my personal actions; clarify "I" vs team)
**Result:** … (metric or `[add metric]`)

(Produce 4–8 stories covering: impact, conflict, failure/learning, leadership,
technical depth, ambiguity.)

────────────────────────────────────────
FILE 3 - project docs (ingest as: project_doc)
Filename: projects.md

## {Project name}
### Problem
### Constraints
### Architecture / approach
### Tradeoffs
### Outcome
### What I personally owned

(1–4 projects.)

────────────────────────────────────────
FILE 4 - resume evidence notes (ingest as: resume)
Filename: resume-notes.md

## Roles
### {Title} - {Company} ({dates})
- bullets with stack + impact

## Skills / stack
## Education / misc (optional)

────────────────────────────────────────
FILE 5 - profile facts (paste into VoiceVault → Profile facts, or save as profile_facts.md)
Filename: profile-facts.md

## Target Roles
- one role per line

## Tech Stack
- one item per line

## Key Metrics
- one measurable outcome per line

## STAR Stories
(paste short STAR blocks; blank line between stories)

────────────────────────────────────────
After the files, add a short checklist:
- Which VoiceVault doc type to select for each file
- Any `[add metric]` / `[unknown]` gaps I should fill before practicing
```

Example fixtures live in [`fixtures/sample-career-ops-prep.md`](fixtures/sample-career-ops-prep.md) and [`fixtures/sample-story-bank.md`](fixtures/sample-story-bank.md).

## License

See [LICENSE](./LICENSE).
