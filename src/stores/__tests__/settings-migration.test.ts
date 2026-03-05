import { describe, expect, it } from "vitest";

import { migratePersistedTasksState } from "@/stores/_store";

describe("settings migration", () => {
  it("adds default closeBehavior for legacy persisted settings", () => {
    const legacyState = {
      settings: {
        language: "ru",
        maxConcurrentTasks: 4,
      },
    };

    const migrated = migratePersistedTasksState(legacyState, 1);

    expect(migrated.settings?.closeBehavior).toBe("hide_to_tray");
    expect(migrated.settings?.language).toBe("ru");
    expect(migrated.settings?.maxConcurrentTasks).toBe(4);
  });

  it("keeps explicit exit closeBehavior during migration", () => {
    const legacyState = {
      settings: {
        closeBehavior: "exit",
      },
    };

    const migrated = migratePersistedTasksState(legacyState, 1);

    expect(migrated.settings?.closeBehavior).toBe("exit");
  });
});
