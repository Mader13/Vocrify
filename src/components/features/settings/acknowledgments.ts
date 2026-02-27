import { Cpu, Mic, Users, Code } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AcknowledgmentCategory = "core" | "diarization" | "framework" | "ui";

export interface AcknowledgmentItem {
  name: string;
  description: string;
  url: string;
  Icon: LucideIcon;
  category: AcknowledgmentCategory;
}

export const acknowledgments: AcknowledgmentItem[] = [
  { name: "transcribe-rs", description: "Unified Rust transcription engine", url: "https://github.com/cjpais/transcribe-rs", Icon: Cpu, category: "core" },
  { name: "ONNX ASR", description: "Excellent ONNX implementation", url: "https://github.com/istupakov/onnx-asr", Icon: Cpu, category: "core" },
  { name: "Parakeet", description: "Speech recognition by NVIDIA", url: "https://github.com/NVIDIA/NeMo", Icon: Mic, category: "core" },
  { name: "whisper.cpp", description: "C/C++ Whisper implementation", url: "https://github.com/ggerganov/whisper.cpp", Icon: Mic, category: "core" },
  { name: "sherpa-onnx", description: "ONNX exports for speech recognition", url: "https://github.com/k2-fsa/sherpa-onnx", Icon: Users, category: "diarization" },
  { name: "sherpa-rs", description: "Rust bindings for sherpa-onnx", url: "https://github.com/k2-fsa/sherpa-rs", Icon: Users, category: "diarization" },
  { name: "ONNX Runtime", description: "Inference engine", url: "https://github.com/microsoft/onnxruntime", Icon: Cpu, category: "framework" },
  { name: "Tauri", description: "Desktop framework", url: "https://github.com/tauri-apps/tauri", Icon: Code, category: "framework" },
  { name: "React", description: "UI framework", url: "https://github.com/facebook/react", Icon: Code, category: "ui" },
  { name: "Tailwind CSS", description: "Utility CSS framework", url: "https://github.com/tailwindlabs/tailwindcss", Icon: Code, category: "ui" },
  { name: "Vite", description: "Frontend build tool", url: "https://github.com/vitejs/vite", Icon: Code, category: "ui" },
  { name: "wavesurfer.js", description: "Waveform visualization", url: "https://github.com/katspaugh/wavesurfer.js", Icon: Mic, category: "ui" },
  { name: "Lucide React", description: "Beautiful icons library", url: "https://github.com/lucide-icons/lucide", Icon: Code, category: "ui" },
  { name: "Zustand", description: "State management", url: "https://github.com/pmndrs/zustand", Icon: Code, category: "ui" },
  { name: "Framer Motion", description: "Animation library", url: "https://github.com/framer/motion", Icon: Code, category: "ui" },
];

export const categoryColors: Record<AcknowledgmentCategory, { bg: string; border: string; text: string }> = {
  core: { bg: "bg-destructive/10", border: "border-destructive/35", text: "text-destructive dark:text-destructive/85" },
  diarization: { bg: "bg-purple-500/10", border: "border-purple-500/20", text: "text-purple-500 dark:text-purple-400" },
  framework: { bg: "bg-green-500/10", border: "border-green-500/20", text: "text-green-500 dark:text-green-400" },
  ui: { bg: "bg-orange-500/10", border: "border-orange-500/20", text: "text-orange-500 dark:text-orange-400" },
};

export const categoryHoverColors: Record<AcknowledgmentCategory, string> = {
  core: "hover:bg-destructive/20 hover:border-destructive/55",
  diarization: "hover:bg-purple-500/20 hover:border-purple-500/30",
  framework: "hover:bg-green-500/20 hover:border-green-500/30",
  ui: "hover:bg-orange-500/20 hover:border-orange-500/30",
};

export const categoryLabels: Record<AcknowledgmentCategory, string> = {
  core: "Core Transcription",
  diarization: "Diarization",
  framework: "Frameworks",
  ui: "Frontend",
};

export const groupedAcknowledgments = acknowledgments.reduce(
  (acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  },
  {} as Record<AcknowledgmentCategory, AcknowledgmentItem[]>,
);
