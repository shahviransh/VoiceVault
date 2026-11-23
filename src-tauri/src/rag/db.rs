use parking_lot::Mutex;
use rusqlite::{ffi::sqlite3_auto_extension, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sqlite_vec::sqlite3_vec_init;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use thiserror::Error;
use uuid::Uuid;

use super::embed::{EmbeddingEngine, EMBEDDING_DIM};

#[derive(Debug, Error)]
pub enum RagError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("embedding error: {0}")]
    Embed(String),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Other(String),
}

pub type RagResult<T> = Result<T, RagError>;

impl Serialize for RagError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DocType {
    Resume,
    StoryBank,
    CareerOpsPrep,
    ProjectDoc,
    ProfileFact,
}

impl DocType {
    pub fn from_str(s: &str) -> RagResult<Self> {
        match s {
            "resume" => Ok(Self::Resume),
            "story_bank" => Ok(Self::StoryBank),
            "career_ops_prep" => Ok(Self::CareerOpsPrep),
            "project_doc" => Ok(Self::ProjectDoc),
            "profile_fact" => Ok(Self::ProfileFact),
            other => Err(RagError::Other(format!("unknown doc_type: {other}"))),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Resume => "resume",
            Self::StoryBank => "story_bank",
            Self::CareerOpsPrep => "career_ops_prep",
            Self::ProjectDoc => "project_doc",
            Self::ProfileFact => "profile_fact",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentRecord {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub doc_type: String,
    pub chunk_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkRecord {
    pub id: String,
    pub doc_id: String,
    pub doc_type: String,
    pub heading: Option<String>,
    pub content: String,
    pub chunk_index: i64,
    pub score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PrepMetadata {
    pub questions: Vec<String>,
    pub company_signals: Vec<String>,
    pub target_keywords: Vec<String>,
    pub things_to_avoid: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileFacts {
    pub target_roles: Vec<String>,
    pub tech_stack: Vec<String>,
    pub key_metrics: Vec<String>,
    pub star_stories: Vec<String>,
}

impl Default for ProfileFacts {
    fn default() -> Self {
        Self {
            target_roles: vec![],
            tech_stack: vec![],
            key_metrics: vec![],
            star_stories: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfflineStatus {
    pub offline_ready: bool,
    pub db_initialized: bool,
    pub embedding_model_ready: bool,
    pub embedding_backend: String,
    pub db_path: String,
    pub model_cache_dir: String,
}

pub struct RagState {
    pub conn: Mutex<Connection>,
    pub embedder: Mutex<EmbeddingEngine>,
    pub db_path: PathBuf,
    pub model_cache_dir: PathBuf,
}

impl RagState {
    pub fn initialize(app_data: &Path) -> RagResult<Arc<Self>> {
        std::fs::create_dir_all(app_data)?;
        let db_path = app_data.join("voicevault.db");
        let model_cache_dir = app_data.join("models");
        std::fs::create_dir_all(&model_cache_dir)?;

        unsafe {
            sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite3_vec_init as *const (),
            )));
        }

        let conn = Connection::open(&db_path)?;
        Self::migrate(&conn)?;

        let embedder = EmbeddingEngine::new(&model_cache_dir)
            .map_err(|e| RagError::Embed(e.to_string()))?;

        Ok(Arc::new(Self {
            conn: Mutex::new(conn),
            embedder: Mutex::new(embedder),
            db_path,
            model_cache_dir,
        }))
    }

    fn migrate(conn: &Connection) -> RagResult<()> {
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                file_path TEXT NOT NULL,
                doc_type TEXT NOT NULL,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                doc_type TEXT NOT NULL,
                heading TEXT,
                content TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chunk_embeddings (
                chunk_id TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
                embedding BLOB NOT NULL,
                dim INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS prep_metadata (
                doc_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
                questions_json TEXT NOT NULL DEFAULT '[]',
                company_signals_json TEXT NOT NULL DEFAULT '[]',
                target_keywords_json TEXT NOT NULL DEFAULT '[]',
                things_to_avoid_json TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS profile_facts (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                facts_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                mode TEXT NOT NULL,
                question TEXT NOT NULL,
                response TEXT NOT NULL,
                scores_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
                chunk_id UNINDEXED,
                doc_id UNINDEXED,
                doc_type UNINDEXED,
                heading,
                content,
                tokenize = 'porter'
            );
            "#,
        )?;

        // sqlite-vec virtual table for cosine / L2 distance search
        let vec_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='vec_chunks'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if !vec_exists {
            let ddl = format!(
                "CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[{EMBEDDING_DIM}])"
            );
            // Some sqlite-vec builds prefer rowid linkage — fall back to blob-only search if create fails
            if let Err(err) = conn.execute(&ddl, []) {
                log::warn!("vec_chunks create failed ({err}); using blob cosine fallback");
            }
        }

        Ok(())
    }

    pub fn offline_status(&self) -> OfflineStatus {
        let emb = self.embedder.lock();
        OfflineStatus {
            offline_ready: emb.is_local_ready(),
            db_initialized: self.db_path.exists(),
            embedding_model_ready: emb.is_local_ready(),
            embedding_backend: emb.backend_name().to_string(),
            db_path: self.db_path.display().to_string(),
            model_cache_dir: self.model_cache_dir.display().to_string(),
        }
    }

    pub fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    pub fn new_id() -> String {
        Uuid::new_v4().to_string()
    }

    pub fn get_profile_facts(&self) -> RagResult<ProfileFacts> {
        let conn = self.conn.lock();
        let json: Option<String> = conn
            .query_row(
                "SELECT facts_json FROM profile_facts WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        match json {
            Some(j) => Ok(serde_json::from_str(&j)
                .map_err(|e| RagError::Other(e.to_string()))?),
            None => Ok(ProfileFacts::default()),
        }
    }

    pub fn set_profile_facts(&self, facts: &ProfileFacts) -> RagResult<()> {
        let conn = self.conn.lock();
        let json = serde_json::to_string(facts).map_err(|e| RagError::Other(e.to_string()))?;
        conn.execute(
            "INSERT INTO profile_facts (id, facts_json) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET facts_json = excluded.facts_json",
            [&json],
        )?;
        Ok(())
    }

    pub fn get_prep_metadata(&self, doc_id: &str) -> RagResult<Option<PrepMetadata>> {
        let conn = self.conn.lock();
        let row = conn
            .query_row(
                "SELECT questions_json, company_signals_json, target_keywords_json, things_to_avoid_json
                 FROM prep_metadata WHERE doc_id = ?1",
                [doc_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;

        Ok(row.map(|(q, s, k, a)| PrepMetadata {
            questions: serde_json::from_str(&q).unwrap_or_default(),
            company_signals: serde_json::from_str(&s).unwrap_or_default(),
            target_keywords: serde_json::from_str(&k).unwrap_or_default(),
            things_to_avoid: serde_json::from_str(&a).unwrap_or_default(),
        }))
    }
}

pub fn f32_to_bytes(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

pub fn bytes_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom < f32::EPSILON {
        0.0
    } else {
        dot / denom
    }
}
