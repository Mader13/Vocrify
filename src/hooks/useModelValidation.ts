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
        title: "No Model Selected",
        message: "You need to select a model to start transcription. Go to the \"Models\" section and install the desired model."
      });
      return false;
    }

    // Check if the selected model is actually installed
    const selectedModel = availableModels.find(m => m.name === selectedTranscriptionModel);
    if (!selectedModel || !selectedModel.installed) {
      setModelError({
        open: true,
        title: "Model Not Installed",
        message: `The selected model "${selectedTranscriptionModel}" is not installed or has been deleted. Go to the "Models" section and install the desired model.`
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
