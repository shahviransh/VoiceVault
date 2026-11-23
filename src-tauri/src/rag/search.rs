use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::db::{
    bytes_to_f32, cosine_similarity, f32_to_bytes, ChunkRecord, PrepMetadata, RagResult, RagState,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrieveResult {
    pub chunks: Vec<ChunkRecord>,
    pub prep_signals: Option<PrepMetadata>,
    pub hidden_during_blind_practice: bool,
}

/// Hybrid search via Reciprocal Rank Fusion of sqlite-vec (or blob cosine) + FTS5 BM25.
pub fn retrieve_context(
    state: &RagState,
    query: &str,
    active_prep_doc_id: Option<&str>,
    top_k: usize,
) -> RagResult<RetrieveResult> {
    let k = top_k.max(1).min(25);
    let query_vec = {
        let mut emb = state.embedder.lock();
        emb.embed_query(query)
            .map_err(|e| super::db::RagError::Embed(e.to_string()))?
    };

    let vec_ranked = vector_search(state, &query_vec, k * 3)?;
    let fts_ranked = fts_search(state, query, k * 3)?;

    let fused = reciprocal_rank_fusion(&vec_ranked, &fts_ranked, 60);

    let conn = state.conn.lock();
    let mut chunks = Vec::new();
    for (chunk_id, rrf_score) in fused.into_iter().take(k) {
        let row = conn.query_row(
            "SELECT id, doc_id, doc_type, heading, content, chunk_index FROM chunks WHERE id = ?1",
            [&chunk_id],
            |r| {
                Ok(ChunkRecord {
                    id: r.get(0)?,
                    doc_id: r.get(1)?,
                    doc_type: r.get(2)?,
                    heading: r.get(3)?,
                    content: r.get(4)?,
                    chunk_index: r.get(5)?,
                    score: Some(rrf_score),
                })
            },
        );
        if let Ok(chunk) = row {
            // Prefer resume/story bank + active prep
            chunks.push(chunk);
        }
    }
    drop(conn);

    // Ensure prep-doc chunks for active prep are present when relevant
    if let Some(prep_id) = active_prep_doc_id {
        let has_prep = chunks.iter().any(|c| c.doc_id == prep_id);
        if !has_prep {
            let prep_hits = fts_search_in_doc(state, query, prep_id, 3)?;
            for (chunk_id, score) in prep_hits {
                if chunks.iter().any(|c| c.id == chunk_id) {
                    continue;
                }
                let conn = state.conn.lock();
                if let Ok(chunk) = conn.query_row(
                    "SELECT id, doc_id, doc_type, heading, content, chunk_index FROM chunks WHERE id = ?1",
                    [&chunk_id],
                    |r| {
                        Ok(ChunkRecord {
                            id: r.get(0)?,
                            doc_id: r.get(1)?,
                            doc_type: r.get(2)?,
                            heading: r.get(3)?,
                            content: r.get(4)?,
                            chunk_index: r.get(5)?,
                            score: Some(score),
                        })
                    },
                ) {
                    chunks.push(chunk);
                }
            }
        }
    }

    let prep_signals = match active_prep_doc_id {
        Some(id) => state.get_prep_metadata(id)?,
        None => None,
    };

    Ok(RetrieveResult {
        chunks,
        prep_signals,
        hidden_during_blind_practice: true,
    })
}

fn vector_search(
    state: &RagState,
    query_vec: &[f32],
    limit: usize,
) -> RagResult<Vec<(String, f64)>> {
    // Prefer sqlite-vec MATCH when available
    if let Ok(hits) = vec0_search(state, query_vec, limit) {
        if !hits.is_empty() {
            return Ok(hits);
        }
    }
    blob_cosine_search(state, query_vec, limit)
}

fn vec0_search(
    state: &RagState,
    query_vec: &[f32],
    limit: usize,
) -> RagResult<Vec<(String, f64)>> {
    let conn = state.conn.lock();
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='vec_chunks'",
        [],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Ok(vec![]);
    }

    let bytes = f32_to_bytes(query_vec);
    let mut stmt = conn.prepare(
        "SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![bytes, limit as i64], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
    })?;

    let mut out = Vec::new();
    for row in rows {
        let (id, distance) = row?;
        // Convert distance to similarity-like score for ranking display
        let score = 1.0 / (1.0 + distance);
        out.push((id, score));
    }
    Ok(out)
}

fn blob_cosine_search(
    state: &RagState,
    query_vec: &[f32],
    limit: usize,
) -> RagResult<Vec<(String, f64)>> {
    let conn = state.conn.lock();
    let mut stmt = conn.prepare("SELECT chunk_id, embedding FROM chunk_embeddings")?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
    })?;

    let mut scored: Vec<(String, f64)> = Vec::new();
    for row in rows {
        let (id, blob) = row?;
        let vec = bytes_to_f32(&blob);
        let sim = cosine_similarity(query_vec, &vec) as f64;
        scored.push((id, sim));
    }
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);
    Ok(scored)
}

fn fts_search(state: &RagState, query: &str, limit: usize) -> RagResult<Vec<(String, f64)>> {
    let fts_query = to_fts_query(query);
    if fts_query.is_empty() {
        return Ok(vec![]);
    }
    let conn = state.conn.lock();
    let mut stmt = conn.prepare(
        "SELECT chunk_id, bm25(fts_chunks) AS rank
         FROM fts_chunks
         WHERE fts_chunks MATCH ?1
         ORDER BY rank
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![fts_query, limit as i64], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
    });

    match rows {
        Ok(iter) => {
            let mut out = Vec::new();
            for row in iter {
                let (id, bm25) = row?;
                // bm25 is lower-is-better; invert for RRF display consistency
                let score = 1.0 / (1.0 + bm25.abs());
                out.push((id, score));
            }
            Ok(out)
        }
        Err(_) => Ok(vec![]),
    }
}

fn fts_search_in_doc(
    state: &RagState,
    query: &str,
    doc_id: &str,
    limit: usize,
) -> RagResult<Vec<(String, f64)>> {
    let fts_query = to_fts_query(query);
    if fts_query.is_empty() {
        return Ok(vec![]);
    }
    let conn = state.conn.lock();
    let mut stmt = conn.prepare(
        "SELECT chunk_id, bm25(fts_chunks) AS rank
         FROM fts_chunks
         WHERE fts_chunks MATCH ?1 AND doc_id = ?2
         ORDER BY rank
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![fts_query, doc_id, limit as i64], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, bm25) = row?;
        out.push((id, 1.0 / (1.0 + bm25.abs())));
    }
    Ok(out)
}

fn to_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .filter(|w| w.len() > 1)
        .map(|w| {
            let cleaned: String = w
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            cleaned
        })
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{w}\"*"))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn reciprocal_rank_fusion(
    list_a: &[(String, f64)],
    list_b: &[(String, f64)],
    k: u32,
) -> Vec<(String, f64)> {
    let mut scores: HashMap<String, f64> = HashMap::new();
    for (rank, (id, _)) in list_a.iter().enumerate() {
        *scores.entry(id.clone()).or_default() += 1.0 / (k as f64 + rank as f64 + 1.0);
    }
    for (rank, (id, _)) in list_b.iter().enumerate() {
        *scores.entry(id.clone()).or_default() += 1.0 / (k as f64 + rank as f64 + 1.0);
    }
    let mut fused: Vec<(String, f64)> = scores.into_iter().collect();
    fused.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    fused
}

/// Pull a single random-ish high-signal chunk for Proof-Point drills.
pub fn sample_proof_point(
    state: &RagState,
    preferred_doc_types: &[&str],
) -> RagResult<Option<ChunkRecord>> {
    let conn = state.conn.lock();
    let placeholders = preferred_doc_types
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = if preferred_doc_types.is_empty() {
        "SELECT id, doc_id, doc_type, heading, content, chunk_index FROM chunks ORDER BY RANDOM() LIMIT 1"
            .to_string()
    } else {
        format!(
            "SELECT id, doc_id, doc_type, heading, content, chunk_index FROM chunks
             WHERE doc_type IN ({placeholders}) ORDER BY RANDOM() LIMIT 1"
        )
    };

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = if preferred_doc_types.is_empty() {
        stmt.query([])?
    } else {
        stmt.query(rusqlite::params_from_iter(preferred_doc_types.iter()))?
    };

    if let Some(r) = rows.next()? {
        Ok(Some(ChunkRecord {
            id: r.get(0)?,
            doc_id: r.get(1)?,
            doc_type: r.get(2)?,
            heading: r.get(3)?,
            content: r.get(4)?,
            chunk_index: r.get(5)?,
            score: None,
        }))
    } else {
        Ok(None)
    }
}
