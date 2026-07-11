import { fetchLibrary, fetchBookClips } from "./scraper.js";
import {
  archiveSnapshot,
  hasPermission,
  loadVaultHandle,
  writeBook,
} from "./vault.js";
import { runSync } from "./sync.js";
import {
  ALARM_NAME,
  advanceSchedule,
  clearSchedule,
  configureSchedule,
  ensureAlarm,
  getSchedule,
  getStatus,
  recordFailure,
  recordSuccess,
} from "./schedule.js";
import { createSyncService } from "./sync-service.js";
import {
  applyScheduledResult,
  createScheduledKeepalive,
  createMessageListener,
  handleNotificationClick,
  openSyncPage,
  recoverSchedule,
  runManualSyncWithKeepalive,
} from "./background-handlers.js";

const PAGE_URL = chrome.runtime.getURL("src/sync-page.html");

const syncService = createSyncService({
  loadVaultHandle,
  hasPermission,
  runSync,
  syncDeps: { fetchLibrary, fetchBookClips, writeBook, archiveSnapshot },
});

const scheduleDeps = {
  recordSuccess,
  recordFailure,
  advanceSchedule,
};
const scheduledKeepalive = createScheduledKeepalive(chrome);
const manualKeepalive = createScheduledKeepalive(chrome);

async function runScheduledSync() {
  const result = await scheduledKeepalive.run(() => syncService.runScheduled());
  await applyScheduledResult(chrome, result, scheduleDeps);
  return result;
}

function recoverScheduledSync() {
  return recoverSchedule(chrome, {
    ensureAlarm,
    getAlarm: () => chrome.alarms.get(ALARM_NAME),
    runScheduledSync,
  });
}

chrome.action.onClicked.addListener(() => {
  return openSyncPage(chrome, PAGE_URL);
});

chrome.runtime.onStartup.addListener(() => recoverScheduledSync());

chrome.runtime.onInstalled.addListener(() => recoverScheduledSync());

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await runScheduledSync();
});

chrome.notifications.onClicked.addListener((id) =>
  handleNotificationClick(chrome, id, PAGE_URL)
);

chrome.runtime.onMessage.addListener(
  createMessageListener({
    chrome,
    getSchedule,
    getStatus,
    configureSchedule,
    clearSchedule,
    isSyncRunning: () => syncService.isRunning(),
  })
);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "manual-sync") return;

  runManualSyncWithKeepalive(
    manualKeepalive,
    port,
    syncService,
    chrome,
    { recordSuccess }
  ).catch(() => {});
});
