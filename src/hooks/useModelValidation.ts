import { useCallback, useState } from "react";
import { useModelsStore } from "@/stores/modelsStore";
import type { DialogState } from "@/types";

export interface UseModelValidationReturn {
  validateModelSelection: () => boolean;
  modelError: DialogState;
  setModelError: (state: DialogState) => void;
  selectedModel: string | null;
}

/**
 * Custom hook for validating model selection before transcription
 * Eliminates code duplication across components
 */
export function useModelValidation(): UseModelValidationReturn {
  const { selectedTranscriptionModel, availableModels } = useModelsStore();
  const [modelError, setModelError] = useState<DialogState>({
    open: false,
    title: "",
    message: ""
  });

  const validateModelSelection = useCallback((): boolean => {
    if (!selectedTranscriptionModel) {
      setModelError({
        open: true,
        title: "Модель не выбрана",
        message: "Для начала транскрипции необходимо выбрать модель. Перейдите в раздел \"Модели\" и установите нужную модель."
      });
      return false;
    }

    // Check if the selected model is actually installed
    const selectedModel = availableModels.find(m => m.name === selectedTranscriptionModel);
    if (!selectedModel || !selectedModel.installed) {
      setModelError({
        open: true,
        title: "Модель не установлена",
        message: `Выбранная модель "${selectedTranscriptionModel}" не установлена или была удалена. Перейдите в раздел \"Модели\" и установите нужную модель.`
      });
      return false;
    }

    return true;
  }, [selectedTranscriptionModel, availableModels]);

  return {
    validateModelSelection,
    modelError,
    setModelError,
    selectedModel: selectedTranscriptionModel,
  };
}
