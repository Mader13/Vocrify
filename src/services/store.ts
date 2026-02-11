/**
 * Tauri Store Service
 * Provides a type-safe wrapper around tauri-plugin-store
 * Falls back to localStorage when not running in Tauri
 */

import { Store } from "@tauri-apps/plugin-store";

const NOTIFICATIONS_KEY = "vocrify-notifications";
const MAX_NOTIFICATIONS = 100;

const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI__" in window;
};

const getStorePath = (): string => "store.json";

export async function saveNotifications(notifications: unknown[]): Promise<void> {
  const trimmed = notifications.slice(0, MAX_NOTIFICATIONS);
  
  if (isTauri()) {
    try {
      const store = await Store.load(getStorePath());
      await store.set(NOTIFICATIONS_KEY, trimmed);
      await store.save();
    } catch (error) {
      console.warn("Tauri store save failed, using localStorage fallback:", error);
      localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(trimmed));
    }
  } else {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(trimmed));
  }
}

export async function loadNotifications(): Promise<unknown[]> {
  if (isTauri()) {
    try {
      const store = await Store.load(getStorePath());
      const notifications = await store.get<unknown[]>(NOTIFICATIONS_KEY);
      return notifications ?? [];
    } catch (error) {
      console.warn("Tauri store load failed, using localStorage fallback:", error);
      const stored = localStorage.getItem(NOTIFICATIONS_KEY);
      return stored ? JSON.parse(stored) : [];
    }
  } else {
    const stored = localStorage.getItem(NOTIFICATIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  }
}

export async function clearNotifications(): Promise<void> {
  if (isTauri()) {
    try {
      const store = await Store.load(getStorePath());
      await store.delete(NOTIFICATIONS_KEY);
      await store.save();
    } catch (error) {
      console.warn("Tauri store clear failed, using localStorage fallback:", error);
      localStorage.removeItem(NOTIFICATIONS_KEY);
    }
  } else {
    localStorage.removeItem(NOTIFICATIONS_KEY);
  }
}

const STORAGE_PREFIX = "vocrify-store-";

export const storeService = {
  async get<T>(key: string): Promise<T | null> {
    if (isTauri()) {
      try {
        const store = await Store.load(getStorePath());
        return (await store.get<T>(key)) ?? null;
      } catch {
        const stored = localStorage.getItem(STORAGE_PREFIX + key);
        return stored ? JSON.parse(stored) : null;
      }
    }
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    return stored ? JSON.parse(stored) : null;
  },

  async set<T>(key: string, value: T): Promise<void> {
    if (isTauri()) {
      try {
        const store = await Store.load(getStorePath());
        await store.set(key, value);
        await store.save();
        return;
      } catch {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
        return;
      }
    }
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  },

  async delete(key: string): Promise<void> {
    if (isTauri()) {
      try {
        const store = await Store.load(getStorePath());
        await store.delete(key);
        await store.save();
        return;
      } catch {
        localStorage.removeItem(STORAGE_PREFIX + key);
        return;
      }
    }
    localStorage.removeItem(STORAGE_PREFIX + key);
  },

  async has(key: string): Promise<boolean> {
    if (isTauri()) {
      try {
        const store = await Store.load(getStorePath());
        return await store.has(key);
      } catch {
        return localStorage.getItem(STORAGE_PREFIX + key) !== null;
      }
    }
    return localStorage.getItem(STORAGE_PREFIX + key) !== null;
  },

  async keys(): Promise<string[]> {
    if (isTauri()) {
      try {
        const store = await Store.load(getStorePath());
        return await store.keys();
      } catch {
        return Object.keys(localStorage)
          .filter(k => k.startsWith(STORAGE_PREFIX))
          .map(k => k.slice(STORAGE_PREFIX.length));
      }
    }
    return Object.keys(localStorage)
      .filter(k => k.startsWith(STORAGE_PREFIX))
      .map(k => k.slice(STORAGE_PREFIX.length));
  },
};
