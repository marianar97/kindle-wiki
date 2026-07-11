import { describe, expect, it, vi } from "vitest";
import {
  ALARM_NAME,
  DAILY_MINUTES,
  WEEKLY_MINUTES,
  configureSchedule,
  clearSchedule,
  getSchedule,
  getStatus,
  getNextRunAt,
  recordFailure,
  recordSuccess,
  advanceSchedule,
  ensureAlarm,
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
  };
}

describe("stored schedule and status", () => {
  it("merges a missing or partial schedule with defaults", async () => {
    await expect(getSchedule(chromeApi())).resolves.toEqual({
      enabled: false,
      cadence: "daily",
      nextRunAt: null,
    });
    await expect(
      getSchedule(chromeApi({ schedule: { enabled: true } }))
    ).resolves.toEqual({
      enabled: true,
      cadence: "daily",
      nextRunAt: null,
    });
  });

  it("returns stored status or an empty object", async () => {
    const status = {
      lastSuccessfulSync: { completedAt: "2026-07-11T07:00:00.000Z" },
    };

    await expect(getStatus(chromeApi({ syncStatus: status }))).resolves.toEqual(
      status
    );
    await expect(getStatus(chromeApi())).resolves.toEqual({});
  });
});

describe("configureSchedule", () => {
  it("schedules daily from the supplied time", async () => {
    const chrome = chromeApi();
    const now = new Date("2026-07-11T07:00:00.000Z");

    const state = await configureSchedule(chrome, "daily", now);

    expect(state.nextRunAt).toBe("2026-07-12T07:00:00.000Z");
    expect(chrome.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
      when: now.getTime() + DAILY_MINUTES * 60_000,
      periodInMinutes: DAILY_MINUTES,
    });
  });

  it("schedules weekly from the supplied time", async () => {
    const chrome = chromeApi();
    const now = new Date("2026-07-11T07:00:00.000Z");

    const state = await configureSchedule(chrome, "weekly", now);

    expect(state.nextRunAt).toBe("2026-07-18T07:00:00.000Z");
    expect(chrome.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
      when: now.getTime() + WEEKLY_MINUTES * 60_000,
      periodInMinutes: WEEKLY_MINUTES,
    });
  });
});

describe("clearSchedule", () => {
  it("disables future runs without clearing recorded sync status", async () => {
    const chrome = chromeApi({
      schedule: {
        enabled: true,
        cadence: "daily",
        nextRunAt: "2026-07-12T07:00:00.000Z",
      },
      syncStatus: {
        lastSuccessfulSync: { completedAt: "2026-07-11T07:00:00.000Z" },
      },
    });

    await clearSchedule(chrome);

    expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAME);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      schedule: { enabled: false, cadence: "daily", nextRunAt: null },
    });
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ syncStatus: expect.anything() })
    );
  });
});

describe("run status", () => {
  it("records success and clears a previous scheduled failure", async () => {
    const chrome = chromeApi();
    const completedAt = "2026-07-11T07:00:00.000Z";

    await recordSuccess(chrome, { books: 4, failures: [] }, completedAt);

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      syncStatus: {
        lastSuccessfulSync: {
          completedAt,
          summary: { books: 4, failures: [] },
        },
        lastScheduledFailure: null,
      },
    });
  });

  it("records a scheduled failure without replacing the last success", async () => {
    const chrome = chromeApi({
      syncStatus: {
        lastSuccessfulSync: { completedAt: "2026-07-10T07:00:00.000Z" },
      },
    });

    await recordFailure(
      chrome,
      "Book One: parse exploded",
      "2026-07-11T07:00:00.000Z"
    );

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      syncStatus: {
        lastSuccessfulSync: { completedAt: "2026-07-10T07:00:00.000Z" },
        lastScheduledFailure: {
          attemptedAt: "2026-07-11T07:00:00.000Z",
          message: "Book One: parse exploded",
        },
      },
    });
  });
});

describe("getNextRunAt", () => {
  it("advances a missed cadence until it is in the future", () => {
    expect(
      getNextRunAt(
        "daily",
        new Date("2026-07-09T07:00:00.000Z"),
        new Date("2026-07-11T08:00:00.000Z")
      )
    ).toBe("2026-07-12T07:00:00.000Z");
  });

  it("throws for an unsupported cadence", () => {
    expect(() =>
      getNextRunAt("monthly", new Date("2026-07-09T07:00:00.000Z"))
    ).toThrow(/Unsupported cadence/);
  });
});

describe("advanceSchedule", () => {
  it("moves the persisted next run forward after a completed scheduled attempt", async () => {
    const chrome = chromeApi({
      schedule: {
        enabled: true,
        cadence: "daily",
        nextRunAt: "2026-07-11T07:00:00.000Z",
      },
    });

    await advanceSchedule(chrome, "2026-07-11T07:10:00.000Z");

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      schedule: {
        enabled: true,
        cadence: "daily",
        nextRunAt: "2026-07-12T07:00:00.000Z",
      },
    });
    expect(chrome.alarms.clear).toHaveBeenCalledWith(ALARM_NAME);
    expect(chrome.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
      when: Date.parse("2026-07-12T07:00:00.000Z"),
      periodInMinutes: DAILY_MINUTES,
    });
  });

  it.each([null, "not-a-date"])(
    "reseeds an invalid previous next run from completion time (%s)",
    async (nextRunAt) => {
      const chrome = chromeApi({
        schedule: { enabled: true, cadence: "daily", nextRunAt },
      });
      const completedAt = "2026-07-11T07:10:00.000Z";

      const schedule = await advanceSchedule(chrome, completedAt);

      expect(schedule.nextRunAt).toBe("2026-07-12T07:10:00.000Z");
      expect(chrome.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
        when: Date.parse("2026-07-12T07:10:00.000Z"),
        periodInMinutes: DAILY_MINUTES,
      });
    }
  );
});

describe("ensureAlarm", () => {
  it("recreates a missing enabled alarm using the persisted next run", async () => {
    const chrome = chromeApi({
      schedule: {
        enabled: true,
        cadence: "daily",
        nextRunAt: "2026-07-12T07:00:00.000Z",
      },
    });

    await ensureAlarm(chrome, new Date("2026-07-11T07:00:00.000Z"));

    expect(chrome.alarms.create).toHaveBeenCalledWith(ALARM_NAME, {
      when: Date.parse("2026-07-12T07:00:00.000Z"),
      periodInMinutes: DAILY_MINUTES,
    });
  });

  it("keeps an existing alarm without creating another", async () => {
    const chrome = chromeApi({
      schedule: {
        enabled: true,
        cadence: "daily",
        nextRunAt: "2026-07-12T07:00:00.000Z",
      },
    });
    chrome.alarms.get.mockResolvedValue({ name: ALARM_NAME });

    await ensureAlarm(chrome, new Date("2026-07-11T07:00:00.000Z"));

    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it("does not recreate an overdue alarm so the caller can catch up", async () => {
    const chrome = chromeApi({
      schedule: {
        enabled: true,
        cadence: "daily",
        nextRunAt: "2026-07-10T07:00:00.000Z",
      },
    });

    const schedule = await ensureAlarm(
      chrome,
      new Date("2026-07-11T07:00:00.000Z")
    );

    expect(chrome.alarms.create).not.toHaveBeenCalled();
    expect(schedule.nextRunAt).toBe("2026-07-10T07:00:00.000Z");
  });

  it.each([null, "not-a-date"])(
    "does not create an alarm for an invalid next run (%s)",
    async (nextRunAt) => {
      const chrome = chromeApi({
        schedule: { enabled: true, cadence: "daily", nextRunAt },
      });

      const schedule = await ensureAlarm(
        chrome,
        new Date("2026-07-11T07:00:00.000Z")
      );

      expect(schedule.nextRunAt).toBe(nextRunAt);
      expect(chrome.alarms.create).not.toHaveBeenCalled();
    }
  );
});
