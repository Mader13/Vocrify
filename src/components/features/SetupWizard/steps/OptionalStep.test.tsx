import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OptionalStep } from "./OptionalStep";
import { useTasks } from "@/stores";

function resetTokenState() {
  useTasks.setState((state) => ({
    settings: {
      ...state.settings,
      huggingFaceToken: null,
    },
  }));
}

describe("OptionalStep", () => {
  beforeEach(() => {
    resetTokenState();
  });

  it("persists token to settings when field loses focus", async () => {
    render(<OptionalStep />);

    const tokenInput = screen.getByLabelText(/api token/i);
    fireEvent.change(tokenInput, { target: { value: "hf_test_token_123" } });
    fireEvent.blur(tokenInput);

    await waitFor(() => {
      expect(useTasks.getState().settings.huggingFaceToken).toBe("hf_test_token_123");
    });
  });
});
