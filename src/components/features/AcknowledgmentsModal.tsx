import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExternalLink, Heart, Code, Cpu, Mic, Users, Globe, Layers, X } from "lucide-react";

interface AcknowledgmentsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AcknowledgmentItem {
  name: string;
  description: string;
  url: string;
  icon: React.ReactNode;
  category: "core" | "diarization" | "framework" | "ui";
}

const acknowledgments: AcknowledgmentItem[] = [
  // Core Transcription Engine
  {
    name: "transcribe-rs",
    description: "Unified Rust Whisper/Parakeet/Moonshine transcription engine by cjpais",
    url: "https://github.com/cjpais/transcribe-rs",
    icon: <Cpu className="h-5 w-5" />,
    category: "core",
  },
  {
    name: "ONNX ASR",
    description: "Excellent ONNX implementation of Parakeet by istupakov",
    url: "https://github.com/istupakov/onnx-asr",
    icon: <Cpu className="h-5 w-5" />,
    category: "core",
  },
  {
    name: "Parakeet",
    description: "Speech recognition model by NVIDIA",
    url: "https://github.com/NVIDIA/NeMo",
    icon: <Mic className="h-5 w-5" />,
    category: "core",
  },
  {
    name: "whisper.cpp",
    description: "Whisper implementation in C/C++ by ggerganov",
    url: "https://github.com/ggerganov/whisper.cpp",
    icon: <Mic className="h-5 w-5" />,
    category: "core",
  },

  // Speaker Diarization
  {
    name: "pyannote.audio",
    description: "Neural speaker diarization toolkit (who spoke when) by Hervé Bredin",
    url: "https://github.com/pyannote/pyannote-audio",
    icon: <Users className="h-5 w-5" />,
    category: "diarization",
  },
  {
    name: "sherpa-onnx",
    description: "ONNX exports for speech recognition by K2 FSA",
    url: "https://github.com/k2-fsa/sherpa-onnx",
    icon: <Users className="h-5 w-5" />,
    category: "diarization",
  },

  // ML Framework & Models
  {
    name: "PyTorch",
    description: "Deep learning framework powering all neural networks",
    url: "https://github.com/pytorch/pytorch",
    icon: <Layers className="h-5 w-5" />,
    category: "framework",
  },
  {
    name: "Hugging Face Transformers",
    description: "Model hub and transformers library for Distil-Whisper and more",
    url: "https://github.com/huggingface/transformers",
    icon: <Globe className="h-5 w-5" />,
    category: "framework",
  },
  {
    name: "ONNX Runtime",
    description: "Cross-platform inference engine for ONNX models",
    url: "https://github.com/microsoft/onnxruntime",
    icon: <Cpu className="h-5 w-5" />,
    category: "framework",
  },

  // Desktop Framework
  {
    name: "Tauri",
    description: "Cross-platform desktop framework (Rust backend)",
    url: "https://github.com/tauri-apps/tauri",
    icon: <Code className="h-5 w-5" />,
    category: "framework",
  },

  // Frontend
  {
    name: "React",
    description: "UI framework by Meta",
    url: "https://github.com/facebook/react",
    icon: <Code className="h-5 w-5" />,
    category: "ui",
  },
  {
    name: "Tailwind CSS",
    description: "Utility-first CSS framework",
    url: "https://github.com/tailwindlabs/tailwindcss",
    icon: <Code className="h-5 w-5" />,
    category: "ui",
  },
  {
    name: "Vite",
    description: "Next generation frontend build tool",
    url: "https://github.com/vitejs/vite",
    icon: <Code className="h-5 w-5" />,
    category: "ui",
  },
  {
    name: "wavesurfer.js",
    description: "Audio waveform visualization library",
    url: "https://github.com/katspaugh/wavesurfer.js",
    icon: <Mic className="h-5 w-5" />,
    category: "ui",
  },
  {
    name: "Lucide React",
    description: "Beautiful icons library",
    url: "https://github.com/lucide-icons/lucide",
    icon: <Code className="h-5 w-5" />,
    category: "ui",
  },
  {
    name: "Zustand",
    description: "Small, fast state management for React",
    url: "https://github.com/pmndrs/zustand",
    icon: <Code className="h-5 w-5" />,
    category: "ui",
  },
  {
    name: "Framer Motion",
    description: "Animation library for React",
    url: "https://github.com/framer/motion",
    icon: <Code className="h-5 w-5" />,
    category: "ui",
  },
];

const categoryColors: Record<AcknowledgmentItem["category"], string> = {
  core: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  diarization: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  framework: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  ui: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const categoryLabels: Record<AcknowledgmentItem["category"], string> = {
  core: "Core Transcription",
  diarization: "Diarization",
  framework: "Frameworks",
  ui: "Frontend",
};

export function AcknowledgmentsModal({ open, onOpenChange }: AcknowledgmentsModalProps) {
  const groupedAcknowledgments = acknowledgments.reduce(
    (acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push(item);
      return acc;
    },
    {} as Record<string, typeof acknowledgments>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              Acknowledgments
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <DialogDescription className="pt-1 mb-4">
            We thank the authors of the open-source libraries and technologies that made this project possible
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 space-y-6">
          <div className="mb-6 p-4 bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-950/30 dark:to-pink-950/30 rounded-lg border border-red-100 dark:border-red-900/30 flex-shrink-0">
            <p className="text-center text-sm text-muted-foreground">
              <Heart className="h-3.5 w-3.5 inline text-red-500 mr-1 -mt-0.5" />
              And most importantly, <span className="font-medium text-foreground">thank you</span> for using this application
              <Heart className="h-3.5 w-3.5 inline text-red-500 ml-1 -mt-0.5" />
            </p>
          </div>

          {Object.entries(groupedAcknowledgments).map(([category, items]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-3">
                <span className={cn("px-2 py-1 rounded text-xs font-medium", categoryColors[category as keyof typeof categoryColors])}>
                  {categoryLabels[category as keyof typeof categoryLabels]}
                </span>
              </div>
              <div className="grid gap-3">
                {items.map((item) => (
                  <a
                    key={item.name}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent transition-colors group"
                  >
                    <div className={cn(
                      "p-2 rounded-lg",
                      categoryColors[category as keyof typeof categoryColors]
                    )}>
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium group-hover:text-accent-foreground transition-colors">
                          {item.name}
                        </span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {item.description}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
