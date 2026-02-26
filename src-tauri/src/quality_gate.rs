#[cfg(feature = "rust-transcribe")]
use std::collections::HashMap;
#[cfg(feature = "rust-transcribe")]
use transcribe_rs::TranscriptionSegment;

pub struct QualityGate;

#[cfg(feature = "rust-transcribe")]
#[derive(Debug, Clone, Default)]
pub struct ChunkAssessment {
    pub coverage: f64,
    pub words_per_second: f64,
    pub token_repetition_ratio: f64,
    pub has_credit_phrase: bool,
    pub total_words: usize,
    pub segment_count: usize,
}

impl QualityGate {
    #[cfg(feature = "rust-transcribe")]
    const CREDIT_PATTERNS: [&'static str; 8] = [
        "thank you for watching",
        "thanks for watching",
        "please subscribe",
        "like and subscribe",
        "subtitles by",
        "subtitle editor",
        "captions by",
        "amara.org",
    ];

    #[cfg(feature = "rust-transcribe")]
    fn collect_tokens(segments: &[TranscriptionSegment]) -> Vec<String> {
        let mut tokens = Vec::new();
        for seg in segments {
            for raw in seg.text.split_whitespace() {
                let token = raw
                    .trim_matches(|ch: char| !ch.is_alphanumeric())
                    .to_lowercase();
                if !token.is_empty() {
                    tokens.push(token);
                }
            }
        }
        tokens
    }

    #[cfg(feature = "rust-transcribe")]
    fn token_repetition_ratio(tokens: &[String]) -> f64 {
        if tokens.is_empty() {
            return 0.0;
        }

        let mut freq: HashMap<&str, usize> = HashMap::new();
        let mut max_count = 0usize;
        for token in tokens {
            let entry = freq.entry(token.as_str()).or_insert(0);
            *entry += 1;
            max_count = max_count.max(*entry);
        }

        max_count as f64 / tokens.len() as f64
    }

    #[cfg(feature = "rust-transcribe")]
    fn has_credit_phrase(segments: &[TranscriptionSegment]) -> bool {
        segments.iter().any(|seg| {
            let lower = seg.text.to_lowercase();
            Self::CREDIT_PATTERNS
                .iter()
                .any(|pattern| lower.contains(pattern))
        })
    }

    #[cfg(feature = "rust-transcribe")]
    pub fn assess_chunk(
        segments: &[TranscriptionSegment],
        chunk_start_s: f64,
        chunk_end_s: f64,
    ) -> ChunkAssessment {
        let chunk_duration = (chunk_end_s - chunk_start_s).max(0.001);
        let mut covered = 0.0f64;

        for seg in segments {
            let start = (seg.start as f64).max(chunk_start_s);
            let end = (seg.end as f64).min(chunk_end_s);
            if end > start {
                covered += end - start;
            }
        }

        let tokens = Self::collect_tokens(segments);
        let total_words = tokens.len();
        ChunkAssessment {
            coverage: (covered / chunk_duration).clamp(0.0, 1.0),
            words_per_second: total_words as f64 / chunk_duration,
            token_repetition_ratio: Self::token_repetition_ratio(&tokens),
            has_credit_phrase: Self::has_credit_phrase(segments),
            total_words,
            segment_count: segments.len(),
        }
    }

    #[cfg(feature = "rust-transcribe")]
    fn score_assessment(assessment: &ChunkAssessment) -> f64 {
        let mut score = 0.0f64;
        score += assessment.coverage * 1.1;
        score += assessment.words_per_second.min(3.0) * 0.35;
        score -= assessment.token_repetition_ratio * 0.9;
        if assessment.has_credit_phrase {
            score -= 1.8;
        }
        score
    }

    #[cfg(feature = "rust-transcribe")]
    pub fn should_retry_chunk(
        segments: &[TranscriptionSegment],
        chunk_start_s: f64,
        chunk_end_s: f64,
        is_noisy: bool,
        engine_name: &str,
    ) -> bool {
        let chunk_duration = (chunk_end_s - chunk_start_s).max(0.0);
        if chunk_duration < 6.0 || segments.is_empty() {
            return false;
        }

        let assessment = Self::assess_chunk(segments, chunk_start_s, chunk_end_s);
        let low_wps = assessment.words_per_second < if is_noisy { 0.04 } else { 0.06 };
        let sparse_single_segment =
            assessment.segment_count <= 1 && assessment.total_words <= 3 && chunk_duration >= 12.0;
        let repetitive = assessment.token_repetition_ratio >= 0.65 && assessment.total_words >= 4;
        let suspicious =
            assessment.has_credit_phrase || repetitive || (sparse_single_segment && low_wps);

        if suspicious {
            eprintln!(
                "[ASR] {} chunk flagged for local retry: coverage={:.2} wps={:.2} rep={:.2} credit={}",
                engine_name,
                assessment.coverage,
                assessment.words_per_second,
                assessment.token_repetition_ratio,
                assessment.has_credit_phrase
            );
        }

        suspicious
    }

    #[cfg(feature = "rust-transcribe")]
    pub fn is_retry_result_better(
        primary_segments: &[TranscriptionSegment],
        retry_segments: &[TranscriptionSegment],
        chunk_start_s: f64,
        chunk_end_s: f64,
        _is_noisy: bool,
    ) -> bool {
        if retry_segments.is_empty() {
            return false;
        }

        let primary = Self::assess_chunk(primary_segments, chunk_start_s, chunk_end_s);
        let retry = Self::assess_chunk(retry_segments, chunk_start_s, chunk_end_s);

        if primary.has_credit_phrase && !retry.has_credit_phrase {
            return true;
        }

        let primary_score = Self::score_assessment(&primary);
        let retry_score = Self::score_assessment(&retry);
        retry_score > primary_score + 0.08
    }

    /// Determines whether the transcription was likely a failure (e.g. hallucinating missing pieces)
    /// based on heuristics like words per second (WPS) and coverage percentage.
    #[cfg(feature = "rust-transcribe")]
    pub fn should_retry_with_chunk_fallback(
        segments: &[TranscriptionSegment],
        total_duration: f64,
        is_noisy: bool,
        engine_name: &str,
    ) -> bool {
        if total_duration < 2.0 {
            return false;
        }

        let assessment = Self::assess_chunk(segments, 0.0, total_duration);
        let coverage = assessment.coverage;
        let wps = assessment.words_per_second;

        let coverage_threshold = if is_noisy { 0.1 } else { 0.2 };
        let wps_threshold = if is_noisy { 0.05 } else { 0.1 };

        let bad_coverage = coverage < coverage_threshold;
        let bad_wps = wps < wps_threshold;
        let has_credit_hallucination = assessment.has_credit_phrase;
        let highly_repetitive =
            assessment.token_repetition_ratio >= 0.7 && assessment.total_words >= 6;

        if bad_coverage || bad_wps || has_credit_hallucination || highly_repetitive {
            eprintln!(
                "[ASR] Quality Gate FAILED for {}: Coverage={:.2}% (threshold={:.2}%), WPS={:.2} (threshold={:.2}), credit={}, repetition={:.2}",
                engine_name,
                coverage * 100.0,
                coverage_threshold * 100.0,
                wps,
                wps_threshold,
                has_credit_hallucination,
                assessment.token_repetition_ratio
            );
            return true;
        }

        eprintln!(
            "[ASR] Quality Gate PASSED for {}: Coverage={:.2}%, WPS={:.2}",
            engine_name,
            coverage * 100.0,
            wps
        );

        false
    }
}
