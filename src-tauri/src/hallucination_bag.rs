use std::path::PathBuf;
use std::sync::OnceLock;

use aho_corasick::{AhoCorasick, AhoCorasickBuilder, MatchKind};
use serde::Deserialize;

use crate::types::TranscriptionSegment;

const DEFAULT_RESOURCE_RELATIVE_PATH: &str = "resources/text/hallucinations_dict.json";
const MIN_WORDS_FOR_SPLIT_SAFETY: usize = 4;

#[derive(Debug, Clone)]
pub struct BoHMatchResult {
    pub sanitized_text: String,
    pub matched: bool,
}

#[derive(Debug, Deserialize)]
struct BoHDictionary {
    version: u32,
    languages: BoHLanguages,
}

#[derive(Debug, Deserialize)]
struct BoHLanguages {
    en: Vec<String>,
    ru: Vec<String>,
    #[serde(default)]
    multi: Vec<String>,
}

#[derive(Debug)]
struct BoHEngine {
    ac: AhoCorasick,
}

static BOH_ENGINE: OnceLock<Option<BoHEngine>> = OnceLock::new();

pub struct HallucinationBag;

impl HallucinationBag {
    pub fn enabled() -> bool {
        match std::env::var("TRANSCRIBE_BOH_ENABLED") {
            Ok(value) => {
                let normalized = value.trim().to_ascii_lowercase();
                !matches!(normalized.as_str(), "0" | "false" | "off")
            }
            // BoH filtering is enabled by default and can be explicitly disabled
            // via TRANSCRIBE_BOH_ENABLED=0/false/off.
            Err(_) => true,
        }
    }

    pub fn sanitize_segment_text(segment: &TranscriptionSegment) -> BoHMatchResult {
        if !Self::enabled() {
            return BoHMatchResult {
                sanitized_text: segment.text.clone(),
                matched: false,
            };
        }

        let Some(engine) = Self::engine() else {
            return BoHMatchResult {
                sanitized_text: segment.text.clone(),
                matched: false,
            };
        };

        let lower = segment.text.to_lowercase();
        if lower.trim().is_empty() {
            return BoHMatchResult {
                sanitized_text: segment.text.clone(),
                matched: false,
            };
        }

        let mut matched = false;
        let mut to_remove = vec![false; lower.len()];

        for m in engine.ac.find_iter(lower.as_str()) {
            matched = true;
            for index in m.start()..m.end() {
                if let Some(flag) = to_remove.get_mut(index) {
                    *flag = true;
                }
            }
        }

        if !matched {
            return BoHMatchResult {
                sanitized_text: segment.text.clone(),
                matched: false,
            };
        }

        let mut sanitized = String::with_capacity(lower.len());
        for (index, ch) in lower.char_indices() {
            if !to_remove.get(index).copied().unwrap_or(false) {
                sanitized.push(ch);
            }
        }

        let normalized = collapse_whitespace(sanitized.trim());
        if normalized.is_empty() {
            return BoHMatchResult {
                // Entire segment was matched by BoH dictionary patterns.
                // Return empty text so caller can drop this segment.
                sanitized_text: String::new(),
                matched: true,
            };
        }

        let original_words = segment.text.split_whitespace().count();
        let cleaned_words = normalized.split_whitespace().count();
        if original_words > MIN_WORDS_FOR_SPLIT_SAFETY && cleaned_words <= MIN_WORDS_FOR_SPLIT_SAFETY {
            return BoHMatchResult {
                sanitized_text: segment.text.clone(),
                matched: true,
            };
        }

        BoHMatchResult {
            sanitized_text: normalized,
            matched: true,
        }
    }

    fn engine() -> Option<&'static BoHEngine> {
        BOH_ENGINE
            .get_or_init(|| {
                let dictionary = load_dictionary().ok()?;
                if dictionary.version == 0 {
                    return None;
                }

                let mut patterns = Vec::new();
                patterns.extend(dictionary.languages.en);
                patterns.extend(dictionary.languages.ru);
                patterns.extend(dictionary.languages.multi);

                patterns = patterns
                    .into_iter()
                    .map(|item| collapse_whitespace(item.trim().to_lowercase().as_str()))
                    .filter(|item| item.len() >= 4)
                    .collect::<Vec<String>>();

                patterns.sort();
                patterns.dedup();

                if patterns.is_empty() {
                    return None;
                }

                let ac = AhoCorasickBuilder::new()
                    .match_kind(MatchKind::LeftmostLongest)
                    .build(patterns.iter().map(String::as_str))
                    .ok()?;

                Some(BoHEngine { ac })
            })
            .as_ref()
    }

    fn candidate_paths() -> Vec<PathBuf> {
        let mut paths = Vec::new();

        if let Ok(explicit_path) = std::env::var("TRANSCRIBE_BOH_DICT_PATH") {
            let trimmed = explicit_path.trim();
            if !trimmed.is_empty() {
                paths.push(PathBuf::from(trimmed));
            }
        }

        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(exe_dir) = current_exe.parent() {
                paths.push(exe_dir.join(DEFAULT_RESOURCE_RELATIVE_PATH));
                paths.push(
                    exe_dir
                        .join("resources")
                        .join("text")
                        .join("hallucinations_dict.json"),
                );
            }
        }

        paths.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("text")
                .join("hallucinations_dict.json"),
        );

        paths
    }
}

fn load_dictionary() -> Result<BoHDictionary, String> {
    let candidates = HallucinationBag::candidate_paths();
    let mut checked_paths = Vec::new();

    for path in candidates {
        checked_paths.push(path.display().to_string());
        if !path.exists() {
            continue;
        }

        let content = std::fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read BoH dictionary {:?}: {}", path, error))?;
        let dictionary: BoHDictionary = serde_json::from_str(&content)
            .map_err(|error| format!("Failed to parse BoH dictionary {:?}: {}", path, error))?;
        eprintln!("[BOH] Loaded hallucination dictionary from {:?}", path);
        return Ok(dictionary);
    }

    Err(format!(
        "BoH dictionary not found. Checked paths: {}",
        checked_paths.join(", ")
    ))
}

fn collapse_whitespace(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::collapse_whitespace;

    #[test]
    fn collapse_whitespace_normalizes_spacing() {
        let value = collapse_whitespace("  hello   world  ");
        assert_eq!(value, "hello world");
    }
}
