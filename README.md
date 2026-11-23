# VoiceVault

Distraction-free, offline-capable interview prep and speaking/writing practice studio.

VoiceVault pairs with **MindVault** (blocks external AI so you think independently) and **career-ops** (Markdown interview prep briefs). Instead of generating answers, it indexes *your* resume, project docs, and prep files into a **native Rust local RAG database**, retrieves personal context per question, and uses **Jev** (TypeSafe AI System One) plus local/free fallbacks to grade, verify factual alignment, and score delivery.

## Stack

- **Desktop:** Tauri v2 (Rust) — single binary, no Python sidecars
- **Frontend:** Next.js 15 static export + TypeScript + Tailwind + Lucide
- **RAG:** `rusqlite` (bundled) + `sqlite-vec` + FTS5 hybrid search, `fastembed` (`AllMiniLML6V2`), `pdf-extract`, `pulldown-cmark`
- **Speech:** Web Speech API + MediaRecorder
- **Scoring:** Jev System One → Chrome Prompt API / Ollama / BYOK → deterministic heuristics

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

1. **Knowledge Vault** — ingest resume / story-bank / career-ops prep / project docs; profile facts; retrieval tester
2. **Speaking Studio** — prep-doc mock interview, live transcript HUD, Noul checkpoint pills, calibrated scorecard
3. **Writing Studio** — timed drills with Focus Lock (paste blocked)
4. **30-Second Proof-Point** — defend a vault chunk, then answer a pushback prompt

## Settings

- Jev API key (`POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`)
- Ollama URL + prefer-Ollama embeddings for Rust RAG
- **LM Studio** local OpenAI-compatible server (`http://localhost:1234`) with model auto-detect
- Light / Dark / System theme toggle
- Strict MindVault Mode (local-first; coach critique off)
- Confidence threshold (default `0.70`) for low-confidence highlighting

## Data location

Desktop app data (SQLite + embedding model cache):

`$APP_DATA/voicevault.db` and `$APP_DATA/models/`

## License

See [LICENSE](./LICENSE).
