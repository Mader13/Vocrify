import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ModelCard } from "@/components/features/ModelCard";
import type { AvailableModel } from "@/types";

vi.mock("@/stores", () => ({
  useTasks: vi.fn((selector) => selector({ settings: {} })),
}));

const installedModel: AvailableModel = {
  name: "whisper-base",
  description: "Test model",
  modelType: "whisper",
  sizeMb: 142,
  installed: true,
};

describe("ModelCard", () => {
  it("shows deleting loader and disables delete action while model removal is in progress", () => {
    render(
      <ModelCard
        model={installedModel}
        onDownload={() => {}}
        onDelete={() => {}}
        isDeleting
      />
    );

    const deletingButton = screen.getByRole("button", { name: /deleting/i });
    expect(deletingButton).toBeDisabled();
  });

  it("asks for confirmation before deleting an installed model", () => {
    const handleDelete = vi.fn();

    render(
      <ModelCard
        model={installedModel}
        onDownload={() => {}}
        onDelete={handleDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    expect(screen.getByRole("heading", { name: /delete model/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Delete model$/i }));
    expect(handleDelete).toHaveBeenCalledTimes(1);
  });

  it("retries pending deletion immediately without confirmation dialog", () => {
    const handleDelete = vi.fn();

    render(
      <ModelCard
        model={installedModel}
        onDownload={() => {}}
        onDelete={handleDelete}
        pendingDeletion
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /retry delete/i }));

    expect(handleDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: /delete model/i })).not.toBeInTheDocument();
  });

  it("shows cancelled status instead of failed when download is cancelled", () => {
    render(
      <ModelCard
        model={{ ...installedModel, installed: false }}
        onDownload={() => {}}
        onDelete={() => {}}
        download={{
          modelName: installedModel.name,
          progress: 42,
          currentMb: 60,
          totalMb: 142,
          speedMbS: 0,
          status: "cancelled",
        }}
      />,
    );

    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });
});
