import { describe, expect, it, vi } from "vitest";

import {
  clearDispatchedNotifications,
  dismissDispatchedNotification,
  dispatchNotification,
  setDispatchedPosition,
  setNotificationDispatcher,
  updateDispatchedNotification,
} from "@/services/notifications";

describe("notification dispatcher adapter", () => {
  it("forwards calls to injected dispatcher implementation", () => {
    const show = vi.fn(() => "custom-id");
    const update = vi.fn();
    const dismiss = vi.fn();
    const clear = vi.fn();
    const getPosition = vi.fn(() => "top-right" as const);
    const setPosition = vi.fn();

    const reset = setNotificationDispatcher({
      show,
      update,
      dismiss,
      clear,
      getPosition,
      setPosition,
    });

    const id = dispatchNotification({ type: "success", title: "ok" });
    updateDispatchedNotification("custom-id", { message: "updated" });
    dismissDispatchedNotification("custom-id");
    clearDispatchedNotifications();
    setDispatchedPosition("bottom-left");

    expect(id).toBe("custom-id");
    expect(show).toHaveBeenCalledWith({ type: "success", title: "ok" });
    expect(update).toHaveBeenCalledWith("custom-id", { message: "updated" });
    expect(dismiss).toHaveBeenCalledWith("custom-id");
    expect(clear).toHaveBeenCalledTimes(1);
    expect(getPosition).not.toHaveBeenCalled();
    expect(setPosition).toHaveBeenCalledWith("bottom-left");

    reset();
  });
});
