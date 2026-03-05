import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProgressMetricsDisplay } from "@/components/features/ProgressMetrics";

describe("ProgressMetricsDisplay", () => {
  it("does not crash when backend sends null numeric metrics", () => {
    const malformedMetrics = {
      realtimeFactor: null,
      estimatedTimeRemaining: null,
      cpuUsage: 42,
    } as unknown;

    expect(() => {
      render(<ProgressMetricsDisplay metrics={malformedMetrics as never} />);
    }).not.toThrow();

    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});
