import { describe, expect, it, vi } from "vitest";
import {
  FAILURE_NOTIFICATION_ID,
  applyManualSuccess,
  applyScheduledResult,
  createPortMessenger,
  createMessageListener,
  createScheduledKeepalive,
  handleManualSyncPort,
  handleNotificationClick,
  openSyncPage,
  recoverSchedule,
  runManualSyncWithKeepalive,
} from "../src/background-handlers.js";
import {
  advanceSchedule,
  recordFailure,
  recordSuccess,
} from "../src/schedule.js";

function chromeApi(seed = {}) {
  const data = { ...seed };
  return {
    storage: {
      local: {
        get: vi.fn(async (keys) =>
          Object.fromEntries(keys.map((key) => [key, data[key]]))
        ),
        set: vi.fn(async (values) => Object.assign(data, values)),
      },
    },
    alarms: {
      create: vi.fn(async () => undefined),
      clear: vi.fn(async () => true),
      get: vi.fn(async () => null),
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
    notifications: {
      create: vi.fn(async () => FAILURE_NOTIFICATION_ID),
    },
    runtime: {
      getURL: vi.fn((path) => `chrome-extension://id/${path}`),
    },
    tabs: {
      query: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 1 })),
      update: vi.fn(async () => undefined),
    },
    windows: {
      update: vi.fn(async () => undefined),
    },
  };
}

const scheduleSeed = {
  schedule: {
    enabled: true,
    cadence: "daily",
    nextRunAt: "2026-07-11T07:00:00.000Z",
  },
};

describe("applyScheduledResult", () => {
  it("records success, clears the badge, and advances on complete", async () => {
    const chrome = chromeApi(scheduleSeed);
    const summary = { books: 2, failures: [] };
    const completedAt = "2026-07-11T07:05:00.000Z";

    await applyScheduledResult(
      chrome,
      { kind: "complete", summary, completedAt },
      { recordSuccess, recordFailure, advanceSchedule }
    );

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      syncStatus: {
        lastSuccessfulSync: { completedAt, summary },
        lastScheduledFailure: null,
      },
    });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "" });
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      schedule: {
        enabled: true,
        cadence: "daily",
        nextRunAt: "2026-07-12T07:00:00.000Z",
      },
    });
  });

  it("records failure, sets a red badge, notifies, and advances on error", async () => {
    const chrome = chromeApi(scheduleSeed);
    const message = "Not logged in to read.amazon.com";
    const completedAt = "2026-07-11T07:05:00.000Z";

    await applyScheduledResult(
      chrome,
      { kind: "error", message },
      {
        recordSuccess,
        recordFailure,
        advanceSchedule,
        now: () => new Date(completedAt),
      }
    );

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      syncStatus: {
        lastSuccessfulSync: null,
        lastScheduledFailure: { attemptedAt: completedAt, message },
      },
    });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: "#e06c75",
    });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "!" });
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      FAILURE_NOTIFICATION_ID,
      {
        type: "basic",
        iconUrl: "chrome-extension://id/icon.png",
        title: "Kindle Wiki Sync failed",
        message,
      }
    );
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      schedule: {
        enabled: true,
        cadence: "daily",
        nextRunAt: "2026-07-12T07:00:00.000Z",
      },
    });
  });

  it("advances a skipped alarm without changing sync status, badge, or notification", async () => {
    const chrome = chromeApi(scheduleSeed);
    const attemptedAt = "2026-07-11T07:05:00.000Z";

    await applyScheduledResult(
      chrome,
      { kind: "skipped" },
      {
        recordSuccess,
        recordFailure,
        advanceSchedule,
        now: () => new Date(attemptedAt),
      }
    );

    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ syncStatus: expect.anything() })
    );
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    expect(chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalled();
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      schedule: {
        enabled: true,
        cadence: "daily",
        nextRunAt: "2026-07-12T07:00:00.000Z",
      },
    });
    expect(chrome.alarms.clear).toHaveBeenCalled();
    expect(chrome.alarms.create).toHaveBeenCalled();
  });
});

describe("applyManualSuccess", () => {
  it("records an entirely successful manual sync and clears the badge", async () => {
    const chrome = chromeApi();
    const summary = { books: 2, failures: [] };
    const completedAt = "2026-07-11T07:05:00.000Z";
    const saveSuccess = vi.fn(async () => undefined);

    await applyManualSuccess(
      chrome,
      { kind: "complete", summary, completedAt },
      { recordSuccess: saveSuccess }
    );

    expect(saveSuccess).toHaveBeenCalledWith(chrome, summary, completedAt);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "" });
  });

  it.each([
    { kind: "complete", summary: { failures: [{ title: "Book One" }] } },
    { kind: "busy" },
    { kind: "error", message: "Sync failed" },
  ])("does not alter status or the badge for %o", async (result) => {
    const chrome = chromeApi();
    const saveSuccess = vi.fn(async () => undefined);

    await applyManualSuccess(chrome, result, { recordSuccess: saveSuccess });

    expect(saveSuccess).not.toHaveBeenCalled();
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("createMessageListener", () => {
  const schedule = {
    enabled: true,
    cadence: "daily",
    nextRunAt: "2026-07-12T07:00:00.000Z",
  };
  const syncStatus = {
    lastSuccessfulSync: { completedAt: "2026-07-11T07:00:00.000Z" },
  };

  function messageListener(dependencies = {}) {
    return createMessageListener({
      chrome: chromeApi(),
      getSchedule: vi.fn(async () => schedule),
      getStatus: vi.fn(async () => syncStatus),
      configureSchedule: vi.fn(async () => schedule),
      clearSchedule: vi.fn(async () => ({ ...schedule, enabled: false })),
      ...dependencies,
    });
  }

  async function send(listener, message) {
    let response;
    const returned = listener(message, {}, (value) => {
      response = value;
    });
    await vi.waitFor(() => expect(response).toBeDefined());
    return { returned, response };
  }

  it("returns schedule and sync status for schedule-get", async () => {
    const listener = messageListener();

    await expect(send(listener, { type: "schedule-get" })).resolves.toEqual({
      returned: true,
      response: { schedule, syncStatus },
    });
  });

  it("configures and disables schedules asynchronously", async () => {
    const configureSchedule = vi.fn(async () => schedule);
    const disabled = { ...schedule, enabled: false, nextRunAt: null };
    const clearSchedule = vi.fn(async () => disabled);
    const listener = messageListener({ configureSchedule, clearSchedule });

    await expect(
      send(listener, { type: "schedule-configure", cadence: "weekly" })
    ).resolves.toEqual({ returned: true, response: { schedule } });
    expect(configureSchedule).toHaveBeenCalledWith(expect.anything(), "weekly");

    await expect(
      send(listener, { type: "schedule-disable" })
    ).resolves.toEqual({ returned: true, response: { schedule: disabled } });
    expect(clearSchedule).toHaveBeenCalledWith(expect.anything());
  });

  it("reports whether the worker is running a sync", async () => {
    const isSyncRunning = vi.fn(() => true);
    const listener = messageListener({ isSyncRunning });

    await expect(send(listener, { type: "sync-status" })).resolves.toEqual({
      returned: true,
      response: { running: true },
    });
    expect(isSyncRunning).toHaveBeenCalledOnce();
  });

  it("returns false for unknown messages", () => {
    const listener = messageListener();

    expect(listener({ type: "unknown" }, {}, vi.fn())).toBe(false);
  });
});

describe("recoverSchedule", () => {
  const enabledSchedule = {
    enabled: true,
    cadence: "daily",
    nextRunAt: "2026-07-12T07:00:00.000Z",
  };

  it("does not catch up when the enabled schedule is still future", async () => {
    const ensure = vi.fn(async () => enabledSchedule);
    const runScheduledSync = vi.fn();
    const advance = vi.fn();

    await recoverSchedule(chromeApi(), {
      ensureAlarm: ensure,
      runScheduledSync,
      advanceSchedule: advance,
      now: () => new Date("2026-07-11T07:00:00.000Z"),
    });

    expect(ensure).toHaveBeenCalledOnce();
    expect(runScheduledSync).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["invalid", "not-a-date"],
  ])("runs catch-up for a %s next run", async (_label, nextRunAt) => {
    const schedule = { ...enabledSchedule, nextRunAt };
    const runScheduledSync = vi.fn(async () => ({ kind: "complete" }));

    await recoverSchedule(chromeApi(), {
      ensureAlarm: vi.fn(async () => schedule),
      runScheduledSync,
      advanceSchedule: vi.fn(),
      now: () => new Date("2026-07-11T07:00:00.000Z"),
    });

    expect(runScheduledSync).toHaveBeenCalledOnce();
  });

  it("does not catch up when an overdue Chrome alarm already exists", async () => {
    const runScheduledSync = vi.fn();
    const getAlarm = vi.fn(async () => ({ name: "scheduled-sync" }));

    await recoverSchedule(chromeApi(), {
      ensureAlarm: vi.fn(async () => ({
        ...enabledSchedule,
        nextRunAt: "2026-07-10T07:00:00.000Z",
      })),
      getAlarm,
      runScheduledSync,
      now: () => new Date("2026-07-11T07:00:00.000Z"),
    });

    expect(getAlarm).toHaveBeenCalledOnce();
    expect(runScheduledSync).not.toHaveBeenCalled();
  });

  it("catches up and advances an overdue schedule when its alarm is missing", async () => {
    const chrome = chromeApi({
      schedule: {
        ...enabledSchedule,
        nextRunAt: "2026-07-10T07:00:00.000Z",
      },
    });
    const completedAt = "2026-07-11T07:05:00.000Z";
    const runScheduledSync = vi.fn(() =>
      applyScheduledResult(
        chrome,
        { kind: "complete", summary: { failures: [] }, completedAt },
        { recordSuccess, recordFailure, advanceSchedule }
      )
    );

    await recoverSchedule(chrome, {
      ensureAlarm: vi.fn(async () => ({
        ...enabledSchedule,
        nextRunAt: "2026-07-10T07:00:00.000Z",
      })),
      getAlarm: vi.fn(async () => null),
      runScheduledSync,
      now: () => new Date("2026-07-11T07:00:00.000Z"),
    });

    expect(runScheduledSync).toHaveBeenCalledOnce();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      schedule: {
        enabled: true,
        cadence: "daily",
        nextRunAt: "2026-07-12T07:00:00.000Z",
      },
    });
  });

  it("delegates skipped catch-up advancement to the scheduled runner", async () => {
    const chrome = chromeApi();
    const advance = vi.fn(async () => undefined);
    const now = new Date("2026-07-11T07:00:00.000Z");
    const runScheduledSync = vi.fn(async () => ({ kind: "skipped" }));

    await recoverSchedule(chrome, {
      ensureAlarm: vi.fn(async () => ({
        ...enabledSchedule,
        nextRunAt: "2026-07-10T07:00:00.000Z",
      })),
      runScheduledSync,
      advanceSchedule: advance,
      now: () => now,
    });

    expect(runScheduledSync).toHaveBeenCalledOnce();
    expect(advance).not.toHaveBeenCalled();
  });
});

describe("manual sync port messaging", () => {
  function portApi() {
    let disconnect;
    return {
      postMessage: vi.fn(),
      onDisconnect: {
        addListener: vi.fn((listener) => {
          disconnect = listener;
        }),
      },
      disconnect: () => disconnect(),
    };
  }

  it("does not post to a disconnected port", () => {
    const port = portApi();
    const messenger = createPortMessenger(port);

    port.disconnect();

    expect(messenger.post({ kind: "book-start" })).toBe(false);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it("contains post errors and treats the port as disconnected", () => {
    const port = portApi();
    port.postMessage.mockImplementation(() => {
      throw new Error("Port closed");
    });
    const messenger = createPortMessenger(port);

    expect(messenger.post({ kind: "book-start" })).toBe(false);
    expect(messenger.post({ kind: "complete" })).toBe(false);
    expect(port.postMessage).toHaveBeenCalledTimes(1);
  });

  it("does not reject when the port disconnects during manual sync", async () => {
    const port = portApi();
    const chrome = chromeApi();
    const syncService = {
      runManual: vi.fn(async (onProgress) => {
        port.disconnect();
        onProgress({ kind: "book-start" });
        return {
          kind: "complete",
          summary: { failures: [] },
          completedAt: "2026-07-11T07:00:00.000Z",
        };
      }),
    };

    await expect(
      handleManualSyncPort(port, syncService, chrome, {
        recordSuccess: vi.fn(async () => undefined),
      })
    ).resolves.toBeUndefined();
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it("uses and cleans up keepalive protection for manual syncs", async () => {
    vi.useFakeTimers();
    const chrome = chromeApi();
    const port = portApi();
    let release;
    const syncService = {
      runManual: vi.fn(() => new Promise((resolve) => {
        release = resolve;
      })),
    };
    const keepalive = createScheduledKeepalive(chrome, {
      intervalMs: 20_000,
      now: () => 123,
    });

    const run = runManualSyncWithKeepalive(
      keepalive,
      port,
      syncService,
      chrome,
      { recordSuccess: vi.fn(async () => undefined) }
    );
    await vi.advanceTimersByTimeAsync(40_000);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(3);

    release({ kind: "busy" });
    await run;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

describe("createScheduledKeepalive", () => {
  it("heartbeats during a run and clears its interval afterward", async () => {
    vi.useFakeTimers();
    const chrome = chromeApi();
    let release;
    const running = new Promise((resolve) => {
      release = resolve;
    });
    const keepalive = createScheduledKeepalive(chrome, {
      intervalMs: 20_000,
      now: () => 123,
    });

    const task = keepalive.run(() => running);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      scheduledSyncHeartbeat: 123,
    });

    await vi.advanceTimersByTimeAsync(40_000);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(3);

    release("done");
    await expect(task).resolves.toBe("done");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

describe("openSyncPage / notification click", () => {
  const pageUrl = "chrome-extension://id/src/sync-page.html";

  it("focuses an existing sync tab", async () => {
    const chrome = chromeApi();
    chrome.tabs.query.mockResolvedValue([
      { id: 42, windowId: 7 },
    ]);

    await openSyncPage(chrome, pageUrl);

    expect(chrome.tabs.update).toHaveBeenCalledWith(42, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(7, { focused: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("opens a new sync tab when none exists", async () => {
    const chrome = chromeApi();

    await openSyncPage(chrome, pageUrl);

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: pageUrl });
  });

  it("routes failure notification clicks to the sync page", async () => {
    const chrome = chromeApi();
    const open = vi.fn(async () => undefined);

    await handleNotificationClick(
      chrome,
      FAILURE_NOTIFICATION_ID,
      pageUrl,
      { openSyncPage: open }
    );
    await handleNotificationClick(chrome, "other-id", pageUrl, {
      openSyncPage: open,
    });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(chrome, pageUrl);
  });
});
