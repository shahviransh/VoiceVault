use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::State;

use super::chunk::chunk_document;
use super::db::{
    f32_to_bytes, DocType, DocumentRecord, OfflineStatus, PrepMetadata, ProfileFacts, RagError,
    RagResult, RagState,
};
use super::parse::{extract_text, markdown_to_plain, parse_career_ops_prep};
use super::search::{retrieve_context, sample_proof_point, RetrieveResult};
use super::sessions::{
    export_session_markdown, list_sessions, save_session, SaveSessionInput, SessionRecord,
};
use super::db::ChunkRecord;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestResult {
    pub document: DocumentRecord,
    pub prep_metadata: Option<PrepMetadata>,
}

#[tauri::command]
pub fn ingest_document(
    state: State<'_, Arc<RagState>>,
    file_path: String,
    doc_type: String,
) -> Result<IngestResult, String> {
    ingest_document_inner(&state, &file_path, &doc_type).map_err(|e| e.to_string())
}

fn ingest_document_inner(
    state: &RagState,
    file_path: &str,
    doc_type: &str,
) -> RagResult<IngestResult> {
    let dtype = DocType::from_str(doc_type)?;
    let mut parsed = extract_text(file_path)?;

    let text_for_chunking = if file_path.ends_with(".md") || file_path.ends_with(".markdown") {
        // Keep heading markers for chunker; also produce prep metadata from raw md
        parsed.text.clone()
    } else {
        parsed.text.clone()
    };

    let prep = if dtype == DocType::CareerOpsPrep {
        let meta = parse_career_ops_prep(&text_for_chunking);
        parsed.prep = Some(meta.clone());
        Some(meta)
    } else {
        None
    };

    let plain = if file_path.ends_with(".md") || file_path.ends_with(".markdown") {
        // Prefer original markdown so ## headings survive
        text_for_chunking
    } else {
        markdown_to_plain(&text_for_chunking)
    };

    let chunks = chunk_document(&plain);
    if chunks.is_empty() {
        return Err(RagError::Parse("document produced no text chunks".into()));
    }

    let texts: Vec<String> = chunks
        .iter()
        .map(|c| {
            if let Some(h) = &c.heading {
                format!("{h}\n{}", c.content)
            } else {
                c.content.clone()
            }
        })
        .collect();

    let embeddings = {
        let mut emb = state.embedder.lock();
        emb.embed_texts(&texts)
            .map_err(|e| RagError::Embed(e.to_string()))?
    };

    let doc_id = RagState::new_id();
    let now = RagState::now();
    let title = Path::new(file_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&parsed.title)
        .to_string();

    {
        let conn = state.conn.lock();
        conn.execute(
            "INSERT INTO documents (id, title, file_path, doc_type, chunk_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                doc_id,
                title,
                file_path,
                dtype.as_str(),
                chunks.len() as i64,
                now,
                now
            ],
        )?;

        for (i, chunk) in chunks.iter().enumerate() {
            let chunk_id = RagState::new_id();
            conn.execute(
                "INSERT INTO chunks (id, doc_id, doc_type, heading, content, chunk_index, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    chunk_id,
                    doc_id,
                    dtype.as_str(),
                    chunk.heading,
                    chunk.content,
                    chunk.index as i64,
                    now
                ],
            )?;

            conn.execute(
                "INSERT INTO fts_chunks (chunk_id, doc_id, doc_type, heading, content)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    chunk_id,
                    doc_id,
                    dtype.as_str(),
                    chunk.heading.clone().unwrap_or_default(),
                    chunk.content
                ],
            )?;

            if let Some(vec) = embeddings.get(i) {
                let bytes = f32_to_bytes(vec);
                conn.execute(
                    "INSERT INTO chunk_embeddings (chunk_id, embedding, dim) VALUES (?1, ?2, ?3)",
                    params![chunk_id, bytes, vec.len() as i64],
                )?;

                // Best-effort vec0 insert
                let _ = conn.execute(
                    "INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?1, ?2)",
                    params![chunk_id, bytes],
                );
            }
        }

        if let Some(meta) = &prep {
            conn.execute(
                "INSERT INTO prep_metadata (doc_id, questions_json, company_signals_json, target_keywords_json, things_to_avoid_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    doc_id,
                    serde_json::to_string(&meta.questions).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(&meta.company_signals).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(&meta.target_keywords).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(&meta.things_to_avoid).unwrap_or_else(|_| "[]".into()),
                ],
            )?;
        }
    }

    Ok(IngestResult {
        document: DocumentRecord {
            id: doc_id,
            title,
            file_path: file_path.to_string(),
            doc_type: dtype.as_str().to_string(),
            chunk_count: chunks.len() as i64,
            created_at: now.clone(),
            updated_at: now,
        },
        prep_metadata: prep,
    })
}

#[tauri::command]
pub fn update_profile_facts(
    state: State<'_, Arc<RagState>>,
    profile_json: ProfileFacts,
) -> Result<DocumentRecord, String> {
    update_profile_facts_inner(&state, profile_json).map_err(|e| e.to_string())
}

fn update_profile_facts_inner(
    state: &RagState,
    facts: ProfileFacts,
) -> RagResult<DocumentRecord> {
    state.set_profile_facts(&facts)?;

    // Re-index as a synthetic profile_fact document
    let mut sections = Vec::new();
    if !facts.target_roles.is_empty() {
        sections.push(format!(
            "## Target Roles\n\n{}",
            facts
                .target_roles
                .iter()
                .map(|s| format!("- {s}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    if !facts.tech_stack.is_empty() {
        sections.push(format!(
            "## Tech Stack\n\n{}",
            facts
                .tech_stack
                .iter()
                .map(|s| format!("- {s}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    if !facts.key_metrics.is_empty() {
        sections.push(format!(
            "## Key Metrics\n\n{}",
            facts
                .key_metrics
                .iter()
                .map(|s| format!("- {s}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    if !facts.star_stories.is_empty() {
        sections.push(format!(
            "## STAR Stories\n\n{}",
            facts.star_stories.join("\n\n")
        ));
    }

    let body = sections.join("\n\n");
    let tmp = state.db_path.parent().unwrap_or(Path::new(".")).join("profile_facts.md");
    std::fs::write(&tmp, &body)?;

    // Remove previous profile_fact docs
    {
        let conn = state.conn.lock();
        let ids: Vec<String> = {
            let mut stmt =
                conn.prepare("SELECT id FROM documents WHERE doc_type = 'profile_fact'")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for id in ids {
            delete_document_inner_locked(&conn, &id)?;
        }
    }

    let result = ingest_document_inner(state, tmp.to_str().unwrap_or("profile_facts.md"), "profile_fact")?;
    Ok(result.document)
}

fn delete_document_inner_locked(conn: &rusqlite::Connection, doc_id: &str) -> RagResult<()> {
    // Clean FTS rows
    let chunk_ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM chunks WHERE doc_id = ?1")?;
        let rows = stmt.query_map([doc_id], |r| r.get(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for cid in &chunk_ids {
        let _ = conn.execute("DELETE FROM fts_chunks WHERE chunk_id = ?1", [cid]);
        let _ = conn.execute("DELETE FROM vec_chunks WHERE chunk_id = ?1", [cid]);
    }
    conn.execute("DELETE FROM documents WHERE id = ?1", [doc_id])?;
    Ok(())
}

#[tauri::command]
pub fn retrieve_context_cmd(
    state: State<'_, Arc<RagState>>,
    query: String,
    active_prep_doc_id: Option<String>,
    top_k: Option<u32>,
) -> Result<RetrieveResult, String> {
    retrieve_context(
        &state,
        &query,
        active_prep_doc_id.as_deref(),
        top_k.unwrap_or(6) as usize,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_documents(state: State<'_, Arc<RagState>>) -> Result<Vec<DocumentRecord>, String> {
    let conn = state.conn.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, file_path, doc_type, chunk_count, created_at, updated_at
             FROM documents ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DocumentRecord {
                id: r.get(0)?,
                title: r.get(1)?,
                file_path: r.get(2)?,
                doc_type: r.get(3)?,
                chunk_count: r.get(4)?,
                created_at: r.get(5)?,
                updated_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn delete_document(state: State<'_, Arc<RagState>>, doc_id: String) -> Result<(), String> {
    let conn = state.conn.lock();
    delete_document_inner_locked(&conn, &doc_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_prep_metadata(
    state: State<'_, Arc<RagState>>,
    doc_id: String,
) -> Result<Option<PrepMetadata>, String> {
    state.get_prep_metadata(&doc_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_profile_facts(state: State<'_, Arc<RagState>>) -> Result<ProfileFacts, String> {
    state.get_profile_facts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn offline_status(state: State<'_, Arc<RagState>>) -> Result<OfflineStatus, String> {
    Ok(state.offline_status())
}

#[tauri::command]
pub fn get_proof_point(
    state: State<'_, Arc<RagState>>,
) -> Result<Option<ChunkRecord>, String> {
    sample_proof_point(&state, &["resume", "story_bank", "project_doc", "career_ops_prep"])
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_practice_session(
    state: State<'_, Arc<RagState>>,
    input: SaveSessionInput,
) -> Result<SessionRecord, String> {
    save_session(&state, input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_practice_sessions(
    state: State<'_, Arc<RagState>>,
    limit: Option<i64>,
) -> Result<Vec<SessionRecord>, String> {
    list_sessions(&state, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_session_md(
    state: State<'_, Arc<RagState>>,
    session_id: String,
) -> Result<String, String> {
    export_session_markdown(&state, &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_embedding_prefs(
    state: State<'_, Arc<RagState>>,
    ollama_url: Option<String>,
    prefer_ollama: Option<bool>,
) -> Result<(), String> {
    let mut emb = state.embedder.lock();
    if let Some(url) = ollama_url {
        emb.set_ollama_url(url);
    }
    if let Some(prefer) = prefer_ollama {
        emb.set_prefer_ollama(prefer);
    }
    Ok(())
}
