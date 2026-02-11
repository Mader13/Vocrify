import { useModelsStore } from "@/stores/modelsStore";
import { MODEL_ICONS } from "@/types";
import type { AvailableModel } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ModelSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modelName: string) => void;
  title?: string;
  description?: string;
}

export function ModelSelectorModal({
  isOpen,
  onClose,
  onSelect,
  title = "Выберите модель",
  description = "Выберите модель для транскрипции:",
}: ModelSelectorModalProps) {
  const { availableModels, selectedTranscriptionModel } = useModelsStore();

  const formatSize = (mb: number): string => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb} MB`;
  };

  const handleSelect = (model: AvailableModel) => {
    onSelect(model.name);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">{description}</p>
          
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {availableModels.map((model) => (
              <button
                key={model.name}
                onClick={() => handleSelect(model)}
                className={`w-full p-4 rounded-lg border text-left transition-all ${
                  selectedTranscriptionModel === model.name
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{MODEL_ICONS[model.modelType]}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{model.name}</span>
                        {model.installed && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">
                            Установлено
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {model.description}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-sm text-muted-foreground">
                      {formatSize(model.sizeMb)}
                    </span>
                    {selectedTranscriptionModel === model.name && (
                      <svg
                        className="w-5 h-5 text-primary ml-2 inline-block"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              if (selectedTranscriptionModel) {
                handleSelect(
                  availableModels.find((m) => m.name === selectedTranscriptionModel) || availableModels[0]
                );
              }
            }}
            disabled={!selectedTranscriptionModel}
          >
            Выбрать
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
