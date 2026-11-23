use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const EMBEDDING_DIM: usize = 384;

#[derive(Debug, Error)]
pub enum EmbedError {
    #[error("embedding failed: {0}")]
    Embed(String),
    #[error("ollama embedding failed: {0}")]
    Ollama(String),
}

pub struct EmbeddingEngine {
    local: Option<TextEmbedding>,
    #[allow(dead_code)]
    cache_dir: PathBuf,
    ollama_url: String,
    prefer_ollama: bool,
}

impl EmbeddingEngine {
    pub fn new(cache_dir: &Path) -> Result<Self, EmbedError> {
        std::fs::create_dir_all(cache_dir).ok();
        let opts = InitOptions::new(EmbeddingModel::AllMiniLML6V2)
            .with_cache_dir(cache_dir.to_path_buf())
            .with_show_download_progress(true);

        let local = match TextEmbedding::try_new(opts) {
            Ok(model) => Some(model),
            Err(err) => {
                log::warn!("local fastembed unavailable: {err}");
                None
            }
        };

        Ok(Self {
            local,
            cache_dir: cache_dir.to_path_buf(),
            ollama_url: "http://localhost:11434".into(),
            prefer_ollama: false,
        })
    }

    pub fn is_local_ready(&self) -> bool {
        self.local.is_some()
    }

    pub fn backend_name(&self) -> &'static str {
        if self.prefer_ollama {
            "ollama"
        } else if self.local.is_some() {
            "fastembed:AllMiniLML6V2"
        } else {
            "unavailable"
        }
    }

    pub fn set_ollama_url(&mut self, url: String) {
        self.ollama_url = url;
    }

    pub fn set_prefer_ollama(&mut self, prefer: bool) {
        self.prefer_ollama = prefer;
    }

    pub fn embed_texts(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        if self.prefer_ollama {
            if let Ok(vecs) = self.embed_via_ollama(texts) {
                return Ok(vecs);
            }
        }

        if let Some(model) = self.local.as_mut() {
            let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
            return model
                .embed(refs, None)
                .map_err(|e| EmbedError::Embed(e.to_string()));
        }

        // Last resort: try Ollama even if not preferred
        self.embed_via_ollama(texts)
    }

    pub fn embed_query(&mut self, query: &str) -> Result<Vec<f32>, EmbedError> {
        let mut out = self.embed_texts(&[query.to_string()])?;
        out.pop()
            .ok_or_else(|| EmbedError::Embed("empty embedding".into()))
    }

    fn embed_via_ollama(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| EmbedError::Ollama(e.to_string()))?;

        let mut vectors = Vec::with_capacity(texts.len());
        for text in texts {
            let body = serde_json::json!({
                "model": "nomic-embed-text",
                "prompt": text
            });
            let url = format!("{}/api/embeddings", self.ollama_url.trim_end_matches('/'));
            let resp = client
                .post(&url)
                .json(&body)
                .send()
                .map_err(|e| EmbedError::Ollama(e.to_string()))?;
            if !resp.status().is_success() {
                return Err(EmbedError::Ollama(format!("status {}", resp.status())));
            }
            let json: serde_json::Value = resp
                .json()
                .map_err(|e| EmbedError::Ollama(e.to_string()))?;
            let embedding = json
                .get("embedding")
                .and_then(|v| v.as_array())
                .ok_or_else(|| EmbedError::Ollama("missing embedding field".into()))?
                .iter()
                .filter_map(|x| x.as_f64().map(|f| f as f32))
                .collect::<Vec<_>>();
            vectors.push(embedding);
        }
        Ok(vectors)
    }
}
