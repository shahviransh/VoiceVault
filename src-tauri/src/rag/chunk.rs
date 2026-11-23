use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextChunk {
    pub heading: Option<String>,
    pub content: String,
    pub index: usize,
}

/// Split by Markdown headings (## / ###) then semantic paragraphs (~300–500 tokens with overlap).
pub fn chunk_document(text: &str) -> Vec<TextChunk> {
    let sections = split_by_headings(text);
    let mut chunks = Vec::new();
    let mut index = 0usize;

    for (heading, body) in sections {
        let parts = split_with_overlap(&body, 420, 60);
        for part in parts {
            let content = part.trim().to_string();
            if content.is_empty() {
                continue;
            }
            chunks.push(TextChunk {
                heading: heading.clone(),
                content,
                index,
            });
            index += 1;
        }
    }

    if chunks.is_empty() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            chunks.push(TextChunk {
                heading: None,
                content: trimmed.to_string(),
                index: 0,
            });
        }
    }

    chunks
}

fn split_by_headings(text: &str) -> Vec<(Option<String>, String)> {
    let mut sections: Vec<(Option<String>, String)> = Vec::new();
    let mut current_heading: Option<String> = None;
    let mut current_body = String::new();

    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("## ") || trimmed.starts_with("### ") {
            if !current_body.trim().is_empty() || current_heading.is_some() {
                sections.push((current_heading.take(), current_body.clone()));
                current_body.clear();
            }
            current_heading = Some(trimmed.trim_start_matches('#').trim().to_string());
        } else {
            current_body.push_str(line);
            current_body.push('\n');
        }
    }

    if !current_body.trim().is_empty() || current_heading.is_some() {
        sections.push((current_heading, current_body));
    }

    if sections.is_empty() {
        sections.push((None, text.to_string()));
    }

    sections
}

fn split_with_overlap(text: &str, target_tokens: usize, overlap: usize) -> Vec<String> {
    let paragraphs: Vec<String> = text
        .split("\n\n")
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();

    if paragraphs.is_empty() {
        let words: Vec<&str> = text.split_whitespace().collect();
        if words.is_empty() {
            return vec![];
        }
        return window_words(&words, target_tokens, overlap);
    }

    let mut out: Vec<String> = Vec::new();
    let mut buf: Vec<String> = Vec::new();
    let mut token_count = 0usize;

    for para in paragraphs {
        let words = para.split_whitespace().count().max(1);
        if token_count + words > target_tokens && !buf.is_empty() {
            let joined = buf.join("\n\n");
            out.push(joined.clone());
            let overlap_text = keep_last_tokens(&joined, overlap);
            buf.clear();
            token_count = 0;
            if !overlap_text.is_empty() {
                token_count = overlap_text.split_whitespace().count();
                buf.push(overlap_text);
            }
        }
        token_count += words;
        buf.push(para);
    }

    if !buf.is_empty() {
        out.push(buf.join("\n\n"));
    }

    out
}

fn window_words(words: &[&str], target: usize, overlap: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut start = 0usize;
    while start < words.len() {
        let end = (start + target).min(words.len());
        out.push(words[start..end].join(" "));
        if end >= words.len() {
            break;
        }
        start = end.saturating_sub(overlap);
    }
    out
}

fn keep_last_tokens(text: &str, n: usize) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() <= n {
        return text.to_string();
    }
    words[words.len() - n..].join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_headings() {
        let text = "## Experience\n\nBuilt VoiceVault.\n\n### Impact\n\nGrew usage 40%.";
        let chunks = chunk_document(text);
        assert!(!chunks.is_empty());
        assert!(chunks
            .iter()
            .any(|c| c.heading.as_deref() == Some("Experience")));
    }
}
