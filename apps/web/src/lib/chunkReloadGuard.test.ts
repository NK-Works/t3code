import { describe, expect, it, vi } from "vite-plus/test";

import {
  clearChunkReloadGuard,
  isChunkLoadError,
  reloadOnceForChunkLoadError,
  reloadOnceForRouteChunkError,
} from "./chunkReloadGuard";

function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("reloadOnceForChunkLoadError", () => {
  it("reloads on the first failure and lets the second one surface", () => {
    const storage = createStorageStub();
    const reload = vi.fn();

    expect(reloadOnceForChunkLoadError(() => storage, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    expect(reloadOnceForChunkLoadError(() => storage, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again after a successful boot cleared the guard", () => {
    const storage = createStorageStub();
    const reload = vi.fn();

    reloadOnceForChunkLoadError(() => storage, reload);
    clearChunkReloadGuard(() => storage);

    expect(reloadOnceForChunkLoadError(() => storage, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads when storage is blocked, so a persistent failure cannot loop", () => {
    const reload = vi.fn();
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };

    expect(reloadOnceForChunkLoadError(blocked, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(() => clearChunkReloadGuard(blocked)).not.toThrow();
  });
});

describe("isChunkLoadError", () => {
  it("matches the stale settings chunk from the Nightly→Stable channel switch", () => {
    expect(
      isChunkLoadError(
        new TypeError(
          "Failed to fetch dynamically imported module: t3code://app/assets/settings-C9snXPCM.js",
        ),
      ),
    ).toBe(true);
  });

  it("matches the stale providers chunk from the follow-up report", () => {
    expect(
      isChunkLoadError(
        new TypeError(
          "Failed to fetch dynamically imported module: t3code://app/assets/settings.providers-OJREr2We.js",
        ),
      ),
    ).toBe(true);
  });

  it("matches other split-chunk load failure signatures", () => {
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 42 failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk 42 failed."))).toBe(true);
  });

  it("finds a chunk failure wrapped in an error cause chain", () => {
    const root = new TypeError(
      "Failed to fetch dynamically imported module: t3code://app/assets/settings-C9snXPCM.js",
    );
    expect(isChunkLoadError(new Error("Failed to load route", { cause: root }))).toBe(true);
  });

  it("rejects ordinary errors and non-errors", () => {
    expect(isChunkLoadError(new Error("boom"))).toBe(false);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module: x.js")).toBe(true);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("reloadOnceForRouteChunkError", () => {
  it("reloads once for a route chunk failure, then lets it surface", () => {
    const storage = createStorageStub();
    const reload = vi.fn();
    const error = new TypeError(
      "Failed to fetch dynamically imported module: t3code://app/assets/settings-C9snXPCM.js",
    );

    expect(reloadOnceForRouteChunkError(error, () => storage, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    expect(reloadOnceForRouteChunkError(error, () => storage, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores ordinary route errors without consuming the single reload", () => {
    const storage = createStorageStub();
    const reload = vi.fn();

    expect(reloadOnceForRouteChunkError(new Error("boom"), () => storage, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    const chunkError = new TypeError(
      "Failed to fetch dynamically imported module: t3code://app/assets/settings-C9snXPCM.js",
    );
    expect(reloadOnceForRouteChunkError(chunkError, () => storage, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
