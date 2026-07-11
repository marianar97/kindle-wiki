// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/vault.js", () => ({
  clearVaultHandle: vi.fn(async () => undefined),
  ensurePermission: vi.fn(async () => true),
  loadVaultHandle: vi.fn(async () => ({ name: "vault" })),
  pickVault: vi.fn(async () => undefined),
}));

import { ensurePermission, loadVaultHandle } from "../src/vault.js";
import {
  formatStamp,
  selectedCadence,
  showError,
  startSync,
  refreshReadyState,
  updateScheduleUi,
  wireSyncPage,
} from "../src/sync-page.js";

const htmlPath = join(dirname(fileURLToPath(import.meta.url)), "../src/sync-page.html");
const pageHtml = readFileSync(htmlPath, "utf8")
  .replace(/^[\s\S]*<body>/, "")
  .replace(/<\/body>[\s\S]*$/, "")
  .replace(/<script[\s\S]*?<\/script>/, "");

function mountPage() {
  document.body.innerHTML = pageHtml;
}

describe("sync-page markup", () => {
  beforeEach(mountPage);

  it("renders schedule controls with Daily selected by default", () => {
    expect(document.getElementById("schedule-toggle").textContent)
      .toBe("Enable scheduled sync");
    expect(document.querySelector('input[name="cadence"][value="daily"]').checked)
      .toBe(true);
    expect(document.querySelector('input[name="cadence"][value="weekly"]').checked)
      .toBe(false);
    expect(document.getElementById("schedule-status")).toBeTruthy();
    expect(document.getElementById("last-success")).toBeTruthy();
    expect(document.getElementById("scheduled-failure").classList.contains("hidden"))
      .toBe(true);
  });
});

describe("updateScheduleUi", () => {
  beforeEach(mountPage);

  it("shows disabled state and keeps cadence radios editable", () => {
    updateScheduleUi(
      { enabled: false, cadence: "weekly", nextRunAt: null },
      {}
    );

    expect(document.querySelector('input[name="cadence"][value="weekly"]').checked)
      .toBe(true);
    expect(document.querySelector('input[name="cadence"][value="daily"]').disabled)
      .toBe(false);
    expect(document.getElementById("schedule-toggle").textContent)
      .toBe("Enable scheduled sync");
    expect(document.getElementById("schedule-status").textContent)
      .toBe("Scheduled sync is disabled.");
  });

  it("locks cadence radios and shows next run while enabled", () => {
    const nextRunAt = "2026-07-12T07:00:00.000Z";
    updateScheduleUi(
      { enabled: true, cadence: "daily", nextRunAt },
      {
        lastSuccessfulSync: {
          completedAt: "2026-07-11T07:00:00.000Z",
          summary: { newClips: 3, books: 4, failures: [{}] },
        },
        lastScheduledFailure: {
          attemptedAt: "2026-07-10T07:00:00.000Z",
          message: "Vault access needs approval",
        },
      }
    );

    expect(document.querySelector('input[name="cadence"][value="daily"]').disabled)
      .toBe(true);
    expect(document.querySelector('input[name="cadence"][value="weekly"]').disabled)
      .toBe(true);
    expect(document.getElementById("schedule-toggle").textContent)
      .toBe("Disable scheduled sync");
    expect(document.getElementById("schedule-status").textContent)
      .toBe(`Scheduled: daily · next run ${formatStamp(nextRunAt)}`);
    expect(document.getElementById("last-success").textContent)
      .toContain("Last successful sync:");
    expect(document.getElementById("last-success").textContent)
      .toContain("3 new clips across 4 books checked · 1 failed");
    expect(document.getElementById("scheduled-failure").textContent)
      .toContain("Vault access needs approval");
    expect(document.getElementById("scheduled-failure").classList.contains("hidden"))
      .toBe(false);
  });

  it("renders only available successful-sync summary fields", () => {
    updateScheduleUi(
      { enabled: false, cadence: "daily", nextRunAt: null },
      {
        lastSuccessfulSync: {
          completedAt: "2026-07-11T07:00:00.000Z",
          summary: { books: 2 },
        },
      }
    );

    const text = document.getElementById("last-success").textContent;
    expect(text).toContain("Last successful sync:");
    expect(text).toContain("2 books checked");
    expect(text).not.toContain("undefined");
  });
});

describe("showError", () => {
  beforeEach(mountPage);

  it("renders arbitrary messages as text, not HTML", () => {
    showError('<img src=x onerror=alert(1)> boom');
    const node = document.getElementById("error");
    expect(node.textContent).toBe('<img src=x onerror=alert(1)> boom');
    expect(node.querySelector("img")).toBeNull();
  });

  it("appends the known Amazon notebook link for login recovery", () => {
    showError("You're not logged in to Amazon.", { loginLink: true });
    const link = document.querySelector("#error a");
    expect(link.href).toBe("https://read.amazon.com/notebook");
    expect(link.textContent).toBe("Open Amazon notebook");
  });
});

describe("selectedCadence", () => {
  beforeEach(mountPage);

  it("returns the checked cadence radio value", () => {
    document.querySelector('input[name="cadence"][value="weekly"]').checked = true;
    expect(selectedCadence()).toBe("weekly");
  });
});

describe("startSync port client", () => {
  beforeEach(() => {
    mountPage();
    loadVaultHandle.mockResolvedValue({ name: "vault" });
    ensurePermission.mockResolvedValue(true);
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(async () => ({
          schedule: { enabled: false, cadence: "daily", nextRunAt: null },
          syncStatus: {},
        })),
        connect: vi.fn(),
      },
    };
  });

  function fakePort(events = []) {
    const messageListeners = [];
    const disconnectListeners = [];
    return {
      onMessage: {
        addListener(fn) {
          messageListeners.push(fn);
          queueMicrotask(async () => {
            for (const event of events) await fn(event);
          });
        },
      },
      onDisconnect: {
        addListener(fn) {
          disconnectListeners.push(fn);
        },
      },
      async emitMessage(event) {
        for (const listener of messageListeners) await listener(event);
      },
      emitDisconnect() {
        for (const listener of disconnectListeners) listener();
      },
    };
  }

  it("shows a permission error without connecting to manual-sync", async () => {
    ensurePermission.mockResolvedValue(false);

    await startSync();

    expect(document.getElementById("error").textContent)
      .toBe("Folder access was denied. Click Sync to try again, or change the vault.");
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it("connects to manual-sync after permission and renders progress plus complete", async () => {
    const port = fakePort([
      { kind: "book-start", title: "Book One", asin: "A1" },
      { kind: "book-done", asin: "A1", clips: 3 },
      {
        kind: "complete",
        summary: {
          newClips: 3,
          booksWritten: 1,
          books: 1,
          failures: [],
        },
      },
    ]);
    chrome.runtime.connect.mockReturnValue(port);

    await startSync();

    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: "manual-sync" });
    await vi.waitFor(() => {
      expect(document.getElementById("progress-title").textContent).toBe("Sync complete");
    });
    expect(document.querySelector("#book-list li").textContent).toContain("Book One");
    expect(document.getElementById("summary").textContent).toContain("3 new clips");
    expect(document.getElementById("sync-again").classList.contains("hidden")).toBe(false);
  });

  it("keeps the active sync UI and opens only one port on repeat start", async () => {
    const port = fakePort();
    chrome.runtime.connect.mockReturnValue(port);

    await startSync();
    await port.emitMessage({ kind: "book-start", title: "Book One", asin: "A1" });
    await startSync();

    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#book-list li").textContent).toContain("Book One");
    expect(document.getElementById("sync").disabled).toBe(true);
    expect(document.getElementById("sync-again").disabled).toBe(true);
    port.emitDisconnect();
  });

  it("keeps manual sync disabled after a detached port and while worker reports running", async () => {
    chrome.runtime.sendMessage.mockImplementation(async (message) => {
      if (message.type === "schedule-get") {
        return {
          schedule: { enabled: false, cadence: "daily", nextRunAt: null },
          syncStatus: {},
        };
      }
      if (message.type === "sync-status") return { running: true };
    });
    const port = fakePort();
    chrome.runtime.connect.mockReturnValue(port);

    await startSync();
    port.emitDisconnect();

    await vi.waitFor(() => {
      expect(document.getElementById("ready").classList.contains("hidden")).toBe(false);
      expect(document.getElementById("manual-sync-status").textContent)
        .toBe("Connection closed; the sync may still be running.");
    });
    expect(document.getElementById("sync").disabled).toBe(true);
    expect(document.getElementById("sync-again").disabled).toBe(true);

    mountPage();
    await refreshReadyState();
    expect(document.getElementById("manual-sync-status").textContent)
      .toBe("A sync is still running.");
    expect(document.getElementById("sync").disabled).toBe(true);

    chrome.runtime.sendMessage.mockImplementation(async (message) => {
      if (message.type === "schedule-get") {
        return {
          schedule: { enabled: false, cadence: "daily", nextRunAt: null },
          syncStatus: {},
        };
      }
      if (message.type === "sync-status") return { running: false };
    });
    await refreshReadyState();
    expect(document.getElementById("manual-sync-status").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("sync").disabled).toBe(false);
  });

  it("does not report interruption after a terminal port event", async () => {
    const port = fakePort();
    chrome.runtime.connect.mockReturnValue(port);

    await startSync();
    await port.emitMessage({
      kind: "complete",
      summary: { newClips: 0, booksWritten: 0, books: 0, failures: [] },
    });
    port.emitDisconnect();

    expect(document.getElementById("error").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("progress-title").textContent).toBe("Sync complete");
    expect(document.getElementById("sync").disabled).toBe(false);
  });

  it("releases the ready UI on busy and error terminals", async () => {
    const port = fakePort([{ kind: "busy" }]);
    chrome.runtime.connect.mockReturnValue(port);

    await startSync();
    await vi.waitFor(() => {
      expect(document.getElementById("error").textContent)
        .toBe("Another sync is already running.");
    });
    expect(document.getElementById("progress").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("ready").classList.contains("hidden")).toBe(false);

    mountPage();
    loadVaultHandle.mockResolvedValue({ name: "vault" });
    const errorPort = fakePort([
      { kind: "error", message: "Not logged in to read.amazon.com" },
    ]);
    chrome.runtime.connect.mockReturnValue(errorPort);
    await startSync();
    await vi.waitFor(() => {
      expect(document.getElementById("error").textContent)
        .toContain("You're not logged in to Amazon.");
    });
    expect(document.querySelector("#error a")).toBeTruthy();
  });
});

describe("schedule toggle", () => {
  beforeEach(() => {
    mountPage();
    loadVaultHandle.mockResolvedValue({ name: "vault" });
    globalThis.chrome = {
      runtime: {
        connect: vi.fn(),
        sendMessage: vi.fn(),
      },
    };
  });

  async function wireReadyPage(schedule) {
    chrome.runtime.sendMessage.mockImplementation(async (message) => {
      if (message.type === "schedule-get") {
        return { schedule, syncStatus: {} };
      }
      return { schedule, syncStatus: {} };
    });
    await wireSyncPage();
  }

  it("configures the default daily cadence without starting a manual sync", async () => {
    await wireReadyPage({ enabled: false, cadence: "daily", nextRunAt: null });

    document.getElementById("schedule-toggle").click();

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "schedule-configure",
        cadence: "daily",
      });
    });
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it("configures selected weekly cadence without starting a manual sync", async () => {
    await wireReadyPage({ enabled: false, cadence: "daily", nextRunAt: null });
    document.querySelector('input[name="cadence"][value="weekly"]').checked = true;

    document.getElementById("schedule-toggle").click();

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "schedule-configure",
        cadence: "weekly",
      });
    });
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it("disables an active schedule without starting a manual sync", async () => {
    await wireReadyPage({
      enabled: true,
      cadence: "daily",
      nextRunAt: "2026-07-12T07:00:00.000Z",
    });

    document.getElementById("schedule-toggle").click();

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "schedule-disable",
      });
    });
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });
});

describe("schedule response errors", () => {
  beforeEach(() => {
    mountPage();
    loadVaultHandle.mockResolvedValue({ name: "vault" });
    globalThis.chrome = {
      runtime: {
        connect: vi.fn(),
        sendMessage: vi.fn(),
      },
    };
  });

  it("keeps the ready page usable when schedule status fails or is malformed", async () => {
    chrome.runtime.sendMessage.mockResolvedValueOnce({ error: "Storage unavailable" });

    await refreshReadyState();

    expect(document.getElementById("ready").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("schedule-toggle").disabled).toBe(false);
    expect(document.getElementById("error").textContent)
      .toContain("Unable to load scheduled sync status");

    chrome.runtime.sendMessage.mockResolvedValueOnce({ syncStatus: {} });
    await refreshReadyState();

    expect(document.getElementById("ready").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("error").textContent)
      .toContain("Unable to load scheduled sync status");
  });

  it("shows a configure error without leaving the ready page", async () => {
    chrome.runtime.sendMessage.mockImplementation(async (message) => {
      if (message.type === "schedule-get") {
        return {
          schedule: { enabled: false, cadence: "daily", nextRunAt: null },
          syncStatus: {},
        };
      }
      return { error: "Unable to save schedule" };
    });
    await wireSyncPage();

    document.getElementById("schedule-toggle").click();

    await vi.waitFor(() => {
      expect(document.getElementById("error").textContent)
        .toContain("Unable to save schedule");
    });
    expect(document.getElementById("ready").classList.contains("hidden")).toBe(false);
  });

  it("shows a disable error without leaving the ready page", async () => {
    chrome.runtime.sendMessage.mockImplementation(async (message) => {
      if (message.type === "schedule-get") {
        return {
          schedule: {
            enabled: true,
            cadence: "daily",
            nextRunAt: "2026-07-12T07:00:00.000Z",
          },
          syncStatus: {},
        };
      }
      return { error: "Unable to disable schedule" };
    });
    await wireSyncPage();

    document.getElementById("schedule-toggle").click();

    await vi.waitFor(() => {
      expect(document.getElementById("error").textContent)
        .toContain("Unable to disable schedule");
    });
    expect(document.getElementById("ready").classList.contains("hidden")).toBe(false);
  });
});
