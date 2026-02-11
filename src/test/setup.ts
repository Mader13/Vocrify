/**
 * Vitest Setup File
 * This runs before each test file
 */

import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  emit: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      has: vi.fn().mockResolvedValue(false),
      delete: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Mock crypto.randomUUID for tests that don't support it
if (!global.crypto.randomUUID) {
  global.crypto.randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    return "test-uuid-" + Math.random().toString(36).substring(2) as `${string}-${string}-${string}-${string}-${string}`;
  };
}
