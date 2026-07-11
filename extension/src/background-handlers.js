export const FAILURE_NOTIFICATION_ID = "scheduled-sync-failure";
export const BADGE_COLOR = "#e06c75";
const KEEPALIVE_INTERVAL_MS = 20_000;

function needsScheduleRecovery(schedule, now) {
  if (!schedule.enabled) return false;
  const nextRunAt = Date.parse(schedule.nextRunAt);
  return !Number.isFinite(nextRunAt) || nextRunAt <= now.getTime();
}

export async function openSyncPage(chrome, pageUrl) {
  const [existing] = await chrome.tabs.query({ url: pageUrl });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: pageUrl });
}

export async function showScheduledFailure(chrome, message, attemptedAt, {
  recordFailure,
}) {
  await recordFailure(chrome, message, attemptedAt);
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.notifications.create(FAILURE_NOTIFICATION_ID, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon.png"),
    title: "Kindle Wiki Sync failed",
    message,
  });
}

export async function applyScheduledResult(chrome, result, {
  recordSuccess,
  recordFailure,
  advanceSchedule,
  now = () => new Date(),
}) {
  const completedAt = result.completedAt ?? now().toISOString();
  if (result.kind === "skipped") {
    await advanceSchedule(chrome, completedAt);
    return result;
  }

  if (result.kind === "complete") {
    await recordSuccess(chrome, result.summary, result.completedAt);
    await chrome.action.setBadgeText({ text: "" });
  } else {
    await showScheduledFailure(chrome, result.message, completedAt, {
      recordFailure,
    });
  }

  await advanceSchedule(chrome, completedAt);
  return result;
}

export async function applyManualSuccess(chrome, result, { recordSuccess }) {
  if (result.kind !== "complete") return;
  if (result.summary.failures.length > 0) return;

  await recordSuccess(chrome, result.summary, result.completedAt);
  await chrome.action.setBadgeText({ text: "" });
}

export function createPortMessenger(port) {
  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
  });

  return {
    post(message) {
      if (disconnected) return false;

      try {
        port.postMessage(message);
        return true;
      } catch {
        disconnected = true;
        return false;
      }
    },
  };
}

export async function handleManualSyncPort(
  port,
  syncService,
  chrome,
  { recordSuccess }
) {
  const messenger = createPortMessenger(port);

  try {
    const result = await syncService.runManual((event) => messenger.post(event));
    await applyManualSuccess(chrome, result, { recordSuccess });
    messenger.post(result);
  } catch (error) {
    messenger.post({ kind: "error", message: error.message });
  }
}

export function runManualSyncWithKeepalive(
  keepalive,
  port,
  syncService,
  chrome,
  dependencies
) {
  return keepalive.run(() =>
    handleManualSyncPort(port, syncService, chrome, dependencies)
  );
}

export function createScheduledKeepalive(
  chrome,
  {
    intervalMs = KEEPALIVE_INTERVAL_MS,
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = {}
) {
  const heartbeat = () => {
    Promise.resolve(
      chrome.storage.local.set({ scheduledSyncHeartbeat: now() })
    ).catch(() => {});
  };

  return {
    async run(task) {
      heartbeat();
      const intervalId = setIntervalFn(heartbeat, intervalMs);
      try {
        return await task();
      } finally {
        clearIntervalFn(intervalId);
      }
    },
  };
}

export async function recoverSchedule(
  chrome,
  {
    ensureAlarm,
    getAlarm = (api) => api.alarms.get("scheduled-sync"),
    runScheduledSync,
    now = () => new Date(),
  }
) {
  const schedule = await ensureAlarm(chrome);
  const recoveredAt = now();
  if (!needsScheduleRecovery(schedule, recoveredAt)) return schedule;
  if (await getAlarm(chrome)) return schedule;

  await runScheduledSync();
  return schedule;
}

export async function handleNotificationClick(
  chrome,
  notificationId,
  pageUrl,
  { openSyncPage: open = openSyncPage } = {}
) {
  if (notificationId !== FAILURE_NOTIFICATION_ID) return;
  await open(chrome, pageUrl);
}

export function createMessageListener({
  chrome,
  getSchedule,
  getStatus,
  configureSchedule,
  clearSchedule,
  isSyncRunning = () => false,
}) {
  return (message, _sender, sendResponse) => {
    const respond = (promise) => {
      promise.then(sendResponse).catch((error) => {
        sendResponse({ error: error.message });
      });
      return true;
    };

    if (message?.type === "schedule-get") {
      return respond(
        Promise.all([getSchedule(chrome), getStatus(chrome)]).then(
          ([schedule, syncStatus]) => ({ schedule, syncStatus })
        )
      );
    }

    if (message?.type === "schedule-configure") {
      return respond(
        configureSchedule(chrome, message.cadence).then((schedule) => ({
          schedule,
        }))
      );
    }

    if (message?.type === "schedule-disable") {
      return respond(
        clearSchedule(chrome).then((schedule) => ({ schedule }))
      );
    }

    if (message?.type === "sync-status") {
      return respond(Promise.resolve({ running: Boolean(isSyncRunning()) }));
    }

    return false;
  };
}
