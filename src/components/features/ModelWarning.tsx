import { AlertTriangle, Settings } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ModelWarningProps {
  onGoToModels?: () => void;
  className?: string;
}

export function ModelWarning({ onGoToModels, className }: ModelWarningProps) {
  return (
    <Alert variant="destructive" className={cn("border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20", className)}>
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <div className="flex flex-col gap-3">
        <div className="space-y-1">
          <AlertTitle className="text-amber-800 dark:text-amber-200">
            Модель не выбрана
          </AlertTitle>
          <AlertDescription className="text-amber-700 dark:text-amber-300">
            Выберите модель в разделе «Модели», чтобы начать транскрипцию
          </AlertDescription>
        </div>
        {onGoToModels && (
          <Button
            variant="outline"
            size="sm"
            onClick={onGoToModels}
            className="w-full border-amber-500/50 hover:bg-amber-100 dark:hover:bg-amber-900/30"
          >
            <Settings className="h-4 w-4 mr-2" />
            Перейти к моделям
          </Button>
        )}
      </div>
    </Alert>
  );
}
