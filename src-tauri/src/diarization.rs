use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::types::SpeakerSegment;

const REVERB_SEG_DIR: &str = "sherpa-onnx-reverb-diarization-v1";
const EMB_DIR: &str = "sherpa-onnx-embedding";
const EMB_FILENAME: &str = "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx";

#[derive(Debug, Clone)]
pub struct DiarizationConfig {
    pub num_speakers: Option<i32>,
    pub threshold: f32,
    pub min_duration_on: f32,
    pub min_duration_off: f32,
    pub provider: Option<String>,
}

impl Default for DiarizationConfig {
    fn default() -> Self {
        Self {
            num_speakers: None,
            threshold: 0.5,
            min_duration_on: 0.0,
            min_duration_off: 0.0,
            provider: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DiarizationEngine {
    seg_model_fp32: PathBuf,
    seg_model_int8: PathBuf,
    embedding_model: PathBuf,
}

impl DiarizationEngine {
    pub fn new(models_dir: &Path) -> Self {
        let nested_root = models_dir.join("sherpa-onnx-diarization");
        let flat_root = models_dir.to_path_buf();

        let nested_seg_dir = nested_root.join(REVERB_SEG_DIR);
        let flat_seg_dir = flat_root.join(REVERB_SEG_DIR);
        let seg_dir = if nested_seg_dir.exists() {
            nested_seg_dir
        } else {
            flat_seg_dir
        };

        let nested_emb_dir = nested_root.join(EMB_DIR);
        let flat_emb_dir = flat_root.join(EMB_DIR);
        let emb_dir = if nested_emb_dir.exists() {
            nested_emb_dir
        } else {
            flat_emb_dir
        };

        Self {
            seg_model_fp32: seg_dir.join("model.onnx"),
            seg_model_int8: seg_dir.join("model.int8.onnx"),
            embedding_model: emb_dir.join(EMB_FILENAME),
        }
    }

    pub fn validate_models(&self) -> bool {
        self.embedding_model.exists()
            && (self.seg_model_fp32.exists() || self.seg_model_int8.exists())
    }

    fn resolve_segmentation_model(&self) -> Result<PathBuf, String> {
        if self.seg_model_fp32.exists() {
            return Ok(self.seg_model_fp32.clone());
        }
        if self.seg_model_int8.exists() {
            return Ok(self.seg_model_int8.clone());
        }

        Err(format!(
            "Segmentation model not found. Checked: '{}' and '{}'",
            self.seg_model_fp32.display(),
            self.seg_model_int8.display()
        ))
    }

    fn build_sherpa_config(config: &DiarizationConfig) -> sherpa_rs::diarize::DiarizeConfig {
        sherpa_rs::diarize::DiarizeConfig {
            num_clusters: config.num_speakers,
            threshold: Some(config.threshold),
            min_duration_on: Some(config.min_duration_on),
            min_duration_off: Some(config.min_duration_off),
            provider: config.provider.clone(),
            debug: false,
        }
    }

    pub fn diarize(
        &self,
        samples: Vec<f32>,
        config: DiarizationConfig,
        progress_callback: Option<Arc<dyn Fn(u8) + Send + Sync>>,
    ) -> Result<Vec<SpeakerSegment>, String> {
        if !self.validate_models() {
            return Err(format!(
                "Diarization models missing. Segmentation: '{}' or '{}', embedding: '{}'",
                self.seg_model_fp32.display(),
                self.seg_model_int8.display(),
                self.embedding_model.display()
            ));
        }

        let segmentation_model = self.resolve_segmentation_model()?;
        let sherpa_cfg = Self::build_sherpa_config(&config);

        let mut diarizer = sherpa_rs::diarize::Diarize::new(
            &segmentation_model,
            &self.embedding_model,
            sherpa_cfg,
        )
        .map_err(|e| format!("Failed to initialize diarizer: {e}"))?;

        let callback = progress_callback.map(|cb| {
            Box::new(move |processed: i32, total: i32| -> i32 {
                if total > 0 {
                    let pct = ((processed as f32 / total as f32) * 100.0)
                        .round()
                        .clamp(0.0, 100.0) as u8;
                    cb(pct);
                }
                1
            }) as Box<dyn Fn(i32, i32) -> i32 + Send + 'static>
        });

        let segments = diarizer
            .compute(samples, callback)
            .map_err(|e| format!("Diarization compute failed: {e}"))?;

        Ok(segments
            .into_iter()
            .map(|s| SpeakerSegment {
                start: s.start as f64,
                end: s.end as f64,
                speaker: format!("SPEAKER_{:02}", s.speaker.max(0)),
            })
            .collect())
    }

    pub fn diarize_adaptive(
        &self,
        samples: Vec<f32>,
        mut config: DiarizationConfig,
        progress_callback: Option<Arc<dyn Fn(u8) + Send + Sync>>,
    ) -> Result<Vec<SpeakerSegment>, String> {
        let expected = config.num_speakers.filter(|v| *v > 0).map(|v| v as usize);
        if expected.is_none() {
            return self.diarize(samples, config, progress_callback);
        }

        let mut thresholds = vec![config.threshold, 0.45, 0.40, 0.35, 0.30, 0.25, 0.20];
        thresholds.dedup_by(|a, b| (*a - *b).abs() < f32::EPSILON);

        let mut best_segments: Option<Vec<SpeakerSegment>> = None;
        let mut best_unique_speakers = 0usize;

        for threshold in thresholds {
            config.threshold = threshold;

            let segments = self.diarize(samples.clone(), config.clone(), progress_callback.clone())?;
            let unique_speakers = count_unique_speakers(&segments);

            if unique_speakers > best_unique_speakers {
                best_unique_speakers = unique_speakers;
                best_segments = Some(segments.clone());
            }

            if let Some(exp) = expected {
                if unique_speakers >= exp {
                    return Ok(segments);
                }
            }
        }

        best_segments.ok_or_else(|| "Diarization produced no segments".to_string())
    }
}

fn count_unique_speakers(segments: &[SpeakerSegment]) -> usize {
    let mut set = BTreeSet::new();
    for s in segments {
        set.insert(s.speaker.as_str());
    }
    set.len()
}
