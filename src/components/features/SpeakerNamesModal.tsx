import * as React from "react";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { normalizeSpeakerNameMap } from "@/lib/speaker-names";

interface SpeakerNamesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  speakers: string[];
  speakerNameMap: Record<string, string>;
  onSave: (speakerNameMap: Record<string, string>) => void;
}

export function SpeakerNamesModal({
  open,
  onOpenChange,
  speakers,
  speakerNameMap,
  onSave,
}: SpeakerNamesModalProps) {
  const [draftMap, setDraftMap] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const nextDraft = speakers.reduce<Record<string, string>>((acc, speaker) => {
      acc[speaker] = speakerNameMap[speaker] ?? "";
      return acc;
    }, {});

    setDraftMap(nextDraft);
  }, [open, speakers, speakerNameMap]);

  const handleSave = () => {
    onSave(normalizeSpeakerNameMap(draftMap));
    onOpenChange(false);
  };

  const hasAnyName = Object.values(draftMap).some((name) => name.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Speaker&apos;s names</DialogTitle>
          <DialogDescription>
            Rename speaker labels for this transcription. Original labels are kept if name is empty.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[48vh] space-y-3 overflow-y-auto py-2">
          {speakers.map((speaker) => (
            <div key={speaker} className="space-y-1.5 rounded-lg border border-border/70 p-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {speaker}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={draftMap[speaker] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraftMap((prev) => ({ ...prev, [speaker]: value }));
                  }}
                  placeholder="Enter display name"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 shrink-0"
                  onClick={() => {
                    setDraftMap((prev) => ({ ...prev, [speaker]: "" }));
                  }}
                  disabled={!draftMap[speaker]?.trim()}
                >
                  Reset
                </Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <div className="flex w-full items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftMap({});
              }}
              disabled={!hasAnyName}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset All
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSave}>
                Save
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
