use serde::Deserialize;

use crate::{ProgressMetrics, SpeakerTurn, TranscriptionSegment};

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum PythonMessage {
    Hello {
        message: String,
        version: String,
        python_version: String,
    },
    Debug {
        message: String,
    },
    Progress {
        stage: String,
        progress: u8,
        message: String,
        #[serde(default)]
        metrics: Option<ProgressMetrics>,
    },
    Segment {
        segment: TranscriptionSegment,
        index: u32,
        total: Option<u32>,
    },
    Result {
        segments: Vec<TranscriptionSegment>,
        language: String,
        duration: f64,
        #[serde(default)]
        speaker_turns: Option<Vec<SpeakerTurn>>,
        #[serde(default)]
        speaker_segments: Option<Vec<TranscriptionSegment>>,
    },
    Error {
        error: String,
    },
    ProgressDownload {
        current: u64,
        total: u64,
        percent: f64,
        speed_mb_s: f64,
    },
    DownloadComplete {
        model_name: String,
        size_mb: u64,
        path: String,
    },
    ModelsList {
        data: Vec<crate::LocalModel>,
    },
    DeleteComplete {
        model_name: String,
    },
}

pub(crate) fn is_critical_error(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("traceback")
        || (lower.contains("error") && !lower.contains("warning"))
        || lower.contains("exception")
        || lower.contains("failed")
}
