use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;

use super::db::{PrepMetadata, RagError, RagResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedDocument {
    pub title: String,
    pub text: String,
    pub prep: Option<PrepMetadata>,
}

pub fn extract_text(file_path: &str) -> RagResult<ParsedDocument> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(RagError::NotFound(file_path.to_string()));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document")
        .to_string();

    let text = match ext.as_str() {
        "pdf" => extract_pdf(path)?,
        "md" | "markdown" | "txt" => {
            std::fs::read_to_string(path).map_err(RagError::Io)?
        }
        other => {
            return Err(RagError::Parse(format!(
                "unsupported file type: .{other} (use .pdf, .md, or .txt)"
            )));
        }
    };

    Ok(ParsedDocument {
        title,
        text,
        prep: None,
    })
}

fn extract_pdf(path: &Path) -> RagResult<String> {
    pdf_extract::extract_text(path).map_err(|e| RagError::Parse(e.to_string()))
}

/// Strip markdown to plain-ish text while preserving heading structure markers.
pub fn markdown_to_plain(md: &str) -> String {
    use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

    let mut out = String::new();
    let parser = Parser::new_ext(md, Options::all());
    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                out.push('\n');
                out.push_str(&"#".repeat(level as usize));
                out.push(' ');
            }
            Event::End(TagEnd::Heading(_)) => out.push('\n'),
            Event::Start(Tag::Paragraph) => {}
            Event::End(TagEnd::Paragraph) => out.push_str("\n\n"),
            Event::Start(Tag::Item) => out.push_str("- "),
            Event::End(TagEnd::Item) => out.push('\n'),
            Event::Text(t) | Event::Code(t) => out.push_str(&t),
            Event::SoftBreak | Event::HardBreak => out.push('\n'),
            _ => {}
        }
    }
    out
}

/// Parse career-ops style prep docs for structured signals.
pub fn parse_career_ops_prep(text: &str) -> PrepMetadata {
    let mut meta = PrepMetadata::default();
    let lower = text.to_lowercase();

    // Extract interview questions: lines ending with ? or under Questions headings
    let q_re = Regex::new(r"(?m)^(?:[-*]\s+|\d+[.)]\s+)?(.+\?)\s*$").unwrap();
    for cap in q_re.captures_iter(text) {
        let q = cap[1].trim().to_string();
        if q.len() > 8 && !meta.questions.contains(&q) {
            meta.questions.push(q);
        }
    }

    meta.company_signals = extract_section_bullets(
        text,
        &[
            "company signals",
            "signals",
            "what they care about",
            "company values",
            "culture signals",
        ],
    );
    meta.target_keywords = extract_section_bullets(
        text,
        &[
            "keywords",
            "target keywords",
            "talking points",
            "must cover",
            "key themes",
        ],
    );
    meta.things_to_avoid = extract_section_bullets(
        text,
        &[
            "things to avoid",
            "avoid",
            "red flags",
            "anti-patterns",
            "do not",
            "don't",
        ],
    );

    // Keyword fallback from common interview signal phrases
    if meta.target_keywords.is_empty() {
        for kw in [
            "ownership",
            "impact",
            "system design",
            "tradeoff",
            "collaboration",
            "leadership",
            "metrics",
            "scalability",
        ] {
            if lower.contains(kw) {
                meta.target_keywords.push(kw.to_string());
            }
        }
    }

    meta
}

fn extract_section_bullets(text: &str, headings: &[&str]) -> Vec<String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    let mut capturing = false;

    for line in lines {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();

        let is_heading = trimmed.starts_with('#')
            || (trimmed.len() < 80
                && headings.iter().any(|h| lower.contains(h))
                && !trimmed.starts_with('-')
                && !trimmed.starts_with('*'));

        if is_heading && headings.iter().any(|h| lower.contains(h)) {
            capturing = true;
            continue;
        }

        if capturing {
            if trimmed.starts_with('#') {
                break;
            }
            if trimmed.starts_with('-') || trimmed.starts_with('*') || trimmed.starts_with('•') {
                let item = trimmed
                    .trim_start_matches(['-', '*', '•', ' '])
                    .trim()
                    .to_string();
                if !item.is_empty() {
                    out.push(item);
                }
            } else if trimmed.is_empty() && !out.is_empty() {
                // allow blank lines inside section
            } else if !trimmed.is_empty()
                && !trimmed.starts_with('#')
                && out.is_empty()
            {
                out.push(trimmed.to_string());
            } else if !trimmed.is_empty()
                && headings.iter().any(|h| lower.contains(h)) == false
                && trimmed.ends_with(':')
            {
                break;
            }
        }
    }

    out
}
