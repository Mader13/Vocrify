import { Settings, Mic, Database, Archive, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores";
import { cn } from "@/lib/utils";
import { NotificationCenterPanel, NotificationCenterButton } from "@/components/ui/notification-center";
import { AcknowledgmentsModal } from "@/components/features/AcknowledgmentsModal";
import { useState } from "react";

export function Header() {
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const currentView = useUIStore((s) => s.currentView);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const [acknowledgmentsOpen, setAcknowledgmentsOpen] = useState(false);

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div className="flex items-center gap-6">
        <h1 className="text-xl font-bold">Vocrify</h1>

        <nav className="flex items-center gap-1">
          <Button
            variant={currentView === "transcription" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setCurrentView("transcription")}
            className={cn(
              "gap-2",
              currentView === "transcription" && "font-medium",
            )}
          >
            <Mic className="h-4 w-4" />
            Transcription
          </Button>

          <Button
            variant={currentView === "archive" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setCurrentView("archive")}
            className={cn("gap-2", currentView === "archive" && "font-medium")}
          >
            <Archive className="h-4 w-4" />
            Archive
          </Button>

          <Button
            variant={currentView === "models" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setCurrentView("models")}
            className={cn("gap-2", currentView === "models" && "font-medium")}
          >
            <Database className="h-4 w-4" />
            Models
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => setAcknowledgmentsOpen(true)}
          >
            <Heart className="h-4 w-4" />
            <span className="hidden sm:inline">Acknowledgments</span>
          </Button>
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <NotificationCenterPanel>
          <NotificationCenterButton size="md" />
        </NotificationCenterPanel>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-5 w-5" />
        </Button>
      </div>

      <AcknowledgmentsModal
        open={acknowledgmentsOpen}
        onOpenChange={setAcknowledgmentsOpen}
      />
    </header>
  );
}
