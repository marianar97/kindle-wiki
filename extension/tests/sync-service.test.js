import { describe, expect, it, vi } from "vitest";
import { createSyncService } from "../src/sync-service.js";

const VAULT_MESSAGE =
  "Vault access needs approval. Open Kindle Wiki Sync and run a manual sync.";

function serviceDeps(overrides = {}) {
  return {
    loadVaultHandle: vi.fn(async () => "vault"),
    hasPermission: vi.fn(async () => true),
    runSync: vi.fn(async (_deps, _vault, onProgress) => {
      onProgress({ kind: "book-start", title: "Book One", asin: "A1" });
      return { books: 1, booksWritten: 1, newClips: 1, failures: [] };
    }),
    syncDeps: {},
    now: () => new Date("2026-07-11T07:00:00.000Z"),
    ...overrides,
  };
}

describe("createSyncService", () => {
  it("forwards progress and releases the lock after a manual success", async () => {
    const deps = serviceDeps();
    const service = createSyncService(deps);
    const progress = [];

    const result = await service.runManual((event) => progress.push(event));

    expect(result).toEqual({
      kind: "complete",
      summary: { books: 1, booksWritten: 1, newClips: 1, failures: [] },
      completedAt: "2026-07-11T07:00:00.000Z",
    });
    expect(progress).toEqual([{ kind: "book-start", title: "Book One", asin: "A1" }]);
    expect(service.isRunning()).toBe(false);
    expect(deps.hasPermission).not.toHaveBeenCalled();
  });

  it("skips a scheduled call while a run is active", async () => {
    let release;
    const deps = serviceDeps({
      runSync: vi.fn(() => new Promise((resolve) => { release = resolve; })),
    });
    const service = createSyncService(deps);
    const active = service.runManual(() => {});

    await expect(service.runScheduled()).resolves.toEqual({ kind: "skipped" });
    release({ books: 1, failures: [] });
    await active;
    expect(service.isRunning()).toBe(false);
  });

  it("returns busy for a concurrent manual call while a run is active", async () => {
    let release;
    const deps = serviceDeps({
      runSync: vi.fn(() => new Promise((resolve) => { release = resolve; })),
    });
    const service = createSyncService(deps);
    const active = service.runScheduled();

    await expect(service.runManual(() => {})).resolves.toEqual({ kind: "busy" });
    release({ books: 1, failures: [] });
    await active;
    expect(service.isRunning()).toBe(false);
  });

  it("errors when the vault handle is missing", async () => {
    const service = createSyncService(serviceDeps({
      loadVaultHandle: vi.fn(async () => null),
    }));

    await expect(service.runManual(() => {})).resolves.toEqual({
      kind: "error",
      message: VAULT_MESSAGE,
    });
    await expect(service.runScheduled()).resolves.toEqual({
      kind: "error",
      message: VAULT_MESSAGE,
    });
    expect(service.isRunning()).toBe(false);
  });

  it("rejects a scheduled run without already-granted vault permission", async () => {
    const deps = serviceDeps({ hasPermission: vi.fn(async () => false) });
    const service = createSyncService(deps);

    await expect(service.runScheduled()).resolves.toEqual({
      kind: "error",
      message: VAULT_MESSAGE,
    });
    expect(deps.runSync).not.toHaveBeenCalled();
    expect(service.isRunning()).toBe(false);
  });

  it("treats per-book failures as a failed scheduled run", async () => {
    const service = createSyncService(serviceDeps({
      runSync: vi.fn(async () => ({
        books: 2,
        failures: [
          { title: "Book One", error: "parse exploded" },
          { title: "Book Two", error: "timeout" },
        ],
      })),
    }));

    const result = await service.runScheduled();

    expect(result).toEqual({
      kind: "error",
      message: "Book One: parse exploded; Book Two: timeout",
    });
    expect(service.isRunning()).toBe(false);
  });

  it("returns an exception message and releases the lock", async () => {
    const service = createSyncService(serviceDeps({
      runSync: vi.fn(async () => {
        throw new Error("Not logged in to read.amazon.com");
      }),
    }));

    await expect(service.runManual(() => {})).resolves.toEqual({
      kind: "error",
      message: "Not logged in to read.amazon.com",
    });
    expect(service.isRunning()).toBe(false);
  });
});
