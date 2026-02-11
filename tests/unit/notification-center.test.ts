/**
 * Notification Center Tests
 * @test/notification-center/tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useNotificationCenterStore } from "@/components/ui/notification-center/store";
import type { PersistentNotification } from "@/components/ui/notification-center/types";

// Mock Tauri Store
vi.mock("@/services/store", () => ({
  saveNotifications: vi.fn().mockResolvedValue(undefined),
  loadNotifications: vi.fn().mockResolvedValue([]),
  clearNotifications: vi.fn().mockResolvedValue(undefined),
}));

describe("NotificationCenter Store", () => {
  beforeEach(() => {
    // Reset store before each test
    useNotificationCenterStore.setState({
      notifications: [],
      isOpen: false,
    });
  });

  describe("CREATE - Adding Notifications", () => {
    it("should add a new notification", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      const id = await result.current.addNotification({
        type: "success",
        priority: "low",
        title: "Test Notification",
        message: "Test message",
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(1);
        expect(result.current.notifications[0].title).toBe("Test Notification");
        expect(result.current.notifications[0].read).toBe(false);
      });
    });

    it("should add notification with correct timestamp", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());
      const before = new Date();

      await result.current.addNotification({
        type: "info",
        priority: "medium",
        title: "Timestamp Test",
      });

      await waitFor(() => {
        const notification = result.current.notifications[0];
        expect(notification.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(notification.createdAt).toBeInstanceOf(Date);
      });
    });

    it("should limit notifications to 100", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      // Add 101 notifications
      for (let i = 0; i < 101; i++) {
        await result.current.addNotification({
          type: "info",
          priority: "low",
          title: `Notification ${i}`,
        });
      }

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(100);
      });
    });

    it("should add notifications in reverse order (newest first)", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      await result.current.addNotification({
        type: "info",
        priority: "low",
        title: "First",
      });

      await result.current.addNotification({
        type: "info",
        priority: "low",
        title: "Second",
      });

      await waitFor(() => {
        expect(result.current.notifications[0].title).toBe("Second");
        expect(result.current.notifications[1].title).toBe("First");
      });
    });
  });

  describe("READ - Retrieving Notifications", () => {
    beforeEach(async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      // Add test notifications
      await result.current.addNotification({
        type: "success",
        priority: "low",
        title: "Read Test 1",
      });

      await result.current.addNotification({
        type: "error",
        priority: "high",
        title: "Read Test 2",
        message: "Error message",
      });
    });

    it("should retrieve all notifications", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(2);
      });
    });

    it("should count unread notifications correctly", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      await waitFor(() => {
        expect(result.current.getUnreadCount()).toBe(2);
      });
    });

    it("should filter notifications by read status", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      await waitFor(() => {
        const unread = result.current.notifications.filter((n) => !n.read);
        expect(unread).toHaveLength(2);
      });
    });
  });

  describe("UPDATE - Marking Notifications", () => {
    beforeEach(async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      await result.current.addNotification({
        type: "info",
        priority: "low",
        title: "Update Test",
      });
    });

    it("should mark a single notification as read", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      await waitFor(() => {
        const notification = result.current.notifications[0];
        expect(notification.read).toBe(false);
      });

      const id = result.current.notifications[0].id;
      await result.current.markAsRead(id);

      await waitFor(() => {
        const notification = result.current.notifications[0];
        expect(notification.read).toBe(true);
      });
    });

    it("should mark all notifications as read", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      // Add another notification
      await result.current.addNotification({
        type: "info",
        priority: "low",
        title: "Another notification",
      });

      await waitFor(() => {
        expect(result.current.getUnreadCount()).toBe(2);
      });

      await result.current.markAllAsRead();

      await waitFor(() => {
        expect(result.current.getUnreadCount()).toBe(0);
        expect(result.current.notifications.every((n) => n.read)).toBe(true);
      });
    });
  });

  describe("DELETE - Removing Notifications", () => {
    beforeEach(async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      await result.current.addNotification({
        type: "info",
        priority: "low",
        title: "Delete Test 1",
      });

      await result.current.addNotification({
        type: "info",
        priority: "low",
        title: "Delete Test 2",
      });
    });

    it("should delete a single notification", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(2);
      });

      const id = result.current.notifications[0].id;
      await result.current.deleteNotification(id);

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(1);
        expect(result.current.notifications[0].title).toBe("Delete Test 2");
      });
    });

    it("should clear all notifications", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(2);
      });

      await result.current.clearAll();

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(0);
      });
    });
  });

  describe("UI State Management", () => {
    it("should toggle open state", () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      expect(result.current.isOpen).toBe(false);

      result.current.toggle();
      expect(result.current.isOpen).toBe(true);

      result.current.toggle();
      expect(result.current.isOpen).toBe(false);
    });

    it("should open panel", () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      result.current.open();
      expect(result.current.isOpen).toBe(true);
    });

    it("should close panel", () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      result.current.open();
      expect(result.current.isOpen).toBe(true);

      result.current.close();
      expect(result.current.isOpen).toBe(false);
    });
  });

  describe("Notification Types and Priorities", () => {
    it("should support all notification types", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      const types: Array<"success" | "error" | "warning" | "info" | "loading"> = [
        "success",
        "error",
        "warning",
        "info",
        "loading",
      ];

      for (const type of types) {
        await result.current.addNotification({
          type,
          priority: "low",
          title: `${type} notification`,
        });
      }

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(5);
        result.current.notifications.forEach((n, i) => {
          expect(n.type).toBe(types[i]);
        });
      });
    });

    it("should support all priority levels", async () => {
      const { result } = renderHook(() => useNotificationCenterStore());

      const priorities: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];

      for (const priority of priorities) {
        await result.current.addNotification({
          type: "info",
          priority,
          title: `${priority} priority notification`,
        });
      }

      await waitFor(() => {
        expect(result.current.notifications).toHaveLength(3);
        result.current.notifications.forEach((n, i) => {
          expect(n.priority).toBe(priorities[i]);
        });
      });
    });
  });
});

/**
 * Integration tests for Notification Store
 * These tests verify the complete CRUD flow
 */
describe("NotificationCenter CRUD Integration", () => {
  beforeEach(() => {
    useNotificationCenterStore.setState({
      notifications: [],
      isOpen: false,
    });
  });

  it("should complete full CRUD cycle", async () => {
    const { result } = renderHook(() => useNotificationCenterStore());

    // CREATE: Add a notification
    const id = await result.current.addNotification({
      type: "success",
      priority: "low",
      title: "CRUD Test",
      message: "Initial message",
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
    });

    // READ: Verify it exists
    let notification = result.current.notifications[0];
    expect(notification.title).toBe("CRUD Test");
    expect(notification.read).toBe(false);

    // UPDATE: Mark as read
    await result.current.markAsRead(id);
    await waitFor(() => {
      notification = result.current.notifications[0];
      expect(notification.read).toBe(true);
    });

    // DELETE: Remove the notification
    await result.current.deleteNotification(id);
    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(0);
    });
  });

  it("should handle multiple operations correctly", async () => {
    const { result } = renderHook(() => useNotificationCenterStore());

    // Add multiple notifications
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const id = await result.current.addNotification({
        type: "info",
        priority: "low",
        title: `Notification ${i}`,
      });
      ids.push(id);
    }

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(5);
    });

    // Mark first 3 as read
    await result.current.markAsRead(ids[0]);
    await result.current.markAsRead(ids[1]);
    await result.current.markAsRead(ids[2]);

    await waitFor(() => {
      expect(result.current.getUnreadCount()).toBe(2);
    });

    // Delete one
    await result.current.deleteNotification(ids[0]);

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(4);
      expect(result.current.getUnreadCount()).toBe(2);
    });

    // Mark all as read
    await result.current.markAllAsRead();

    await waitFor(() => {
      expect(result.current.getUnreadCount()).toBe(0);
    });

    // Clear all
    await result.current.clearAll();

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(0);
    });
  });
});
