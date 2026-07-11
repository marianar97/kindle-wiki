import {
  clearVaultHandle, ensurePermission, loadVaultHandle, pickVault,
} from "./vault.js";

const LOGIN_ERROR_MESSAGE = "Not logged in to read.amazon.com";
const AMAZON_NOTEBOOK_URL = "https://read.amazon.com/notebook";
const DEFAULT_SCHEDULE = { enabled: false, cadence: "daily", nextRunAt: null };
let manualSyncActive = false;
let activeManualPort = null;
let workerSyncRunning = false;

export const el = (id) => document.getElementById(id);
export const show = (id) => el(id).classList.remove("hidden");
export const hide = (id) => el(id).classList.add("hidden");

export function showError(message, { loginLink = false } = {}) {
  const node = el("error");
  node.replaceChildren();
  node.append(document.createTextNode(message));
  if (loginLink) {
    node.append(document.createTextNode(" "));
    const link = document.createElement("a");
    link.href = AMAZON_NOTEBOOK_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open Amazon notebook";
    node.append(link);
  }
  show("error");
}

export function request(message) {
  return chrome.runtime.sendMessage(message);
}

function scheduleFromResponse(response) {
  if (response?.error) throw new Error(response.error);

  const schedule = response?.schedule;
  const hasValidCadence = schedule?.cadence === "daily" || schedule?.cadence === "weekly";
  if (!schedule || typeof schedule.enabled !== "boolean" || !hasValidCadence) {
    throw new Error("The saved schedule is invalid.");
  }
  if (schedule.enabled && typeof schedule.nextRunAt !== "string") {
    throw new Error("The enabled schedule has no next run time.");
  }
  return { schedule, syncStatus: response.syncStatus ?? {} };
}

export function selectedCadence() {
  return document.querySelector('input[name="cadence"]:checked').value;
}

export function formatStamp(iso) {
  return new Date(iso).toLocaleString();
}

function formatSuccessfulSyncSummary(summary) {
  if (!summary || typeof summary !== "object") return "";

  const details = [];
  const hasNewClips = Number.isFinite(summary.newClips);
  const hasBooks = Number.isFinite(summary.books);
  if (hasNewClips && hasBooks) {
    details.push(`${summary.newClips} new clips across ${summary.books} books checked`);
  } else if (hasNewClips) {
    details.push(`${summary.newClips} new clips`);
  } else if (hasBooks) {
    details.push(`${summary.books} books checked`);
  }
  if (Array.isArray(summary.failures) && summary.failures.length > 0) {
    details.push(`${summary.failures.length} failed`);
  }
  return details.join(" · ");
}

export function updateScheduleUi(schedule, syncStatus = {}) {
  for (const input of document.querySelectorAll('input[name="cadence"]')) {
    input.checked = input.value === schedule.cadence;
    input.disabled = schedule.enabled;
  }
  el("schedule-toggle").textContent =
    schedule.enabled ? "Disable scheduled sync" : "Enable scheduled sync";
  el("schedule-status").textContent = schedule.enabled
    ? `Scheduled: ${schedule.cadence} · next run ${formatStamp(schedule.nextRunAt)}`
    : "Scheduled sync is disabled.";
  const lastSuccessfulSync = syncStatus.lastSuccessfulSync;
  const lastSuccessSummary = formatSuccessfulSyncSummary(lastSuccessfulSync?.summary);
  el("last-success").textContent = lastSuccessfulSync
    ? `Last successful sync: ${formatStamp(lastSuccessfulSync.completedAt)}` +
      (lastSuccessSummary ? ` · ${lastSuccessSummary}` : "")
    : "";
  const failure = syncStatus.lastScheduledFailure;
  el("scheduled-failure").textContent = failure
    ? `Latest scheduled attempt failed ${formatStamp(failure.attemptedAt)}: ${failure.message}`
    : "";
  failure ? show("scheduled-failure") : hide("scheduled-failure");
}

function setManualSyncControls(disabled) {
  el("sync").disabled = disabled;
  el("sync-again").disabled = disabled;
}

function updateWorkerSyncStatus(running) {
  workerSyncRunning = running;
  el("manual-sync-status").textContent = running ? "A sync is still running." : "";
  running ? show("manual-sync-status") : hide("manual-sync-status");
  setManualSyncControls(manualSyncActive || workerSyncRunning);
}

export async function refreshReadyState() {
  hide("setup"); hide("ready"); hide("error");
  const handle = await loadVaultHandle();
  if (!handle) {
    show("setup");
    return;
  }
  el("vault-name").textContent = `Vault: ${handle.name}`;
  let statusError = null;
  try {
    const response = await request({ type: "schedule-get" });
    const { schedule, syncStatus } = scheduleFromResponse(response);
    updateScheduleUi(schedule, syncStatus);
  } catch (error) {
    updateScheduleUi(DEFAULT_SCHEDULE, {});
    statusError = `Unable to load scheduled sync status: ${error.message}`;
  }
  try {
    const response = await request({ type: "sync-status" });
    if (response?.error) throw new Error(response.error);
    updateWorkerSyncStatus(response?.running === true);
  } catch (error) {
    updateWorkerSyncStatus(true);
    statusError ??= `Unable to determine whether a sync is running: ${error.message}`;
  }
  show("ready");
  if (statusError) showError(statusError);
}

function addBookRow(title) {
  const li = document.createElement("li");
  const name = document.createElement("span");
  name.textContent = title;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = "…";
  li.append(name, meta);
  el("book-list").append(li);
  return { li, meta };
}

export function onProgress(rows) {
  return (event) => {
    if (event.kind === "book-start") rows.set(event.asin, addBookRow(event.title));
    if (event.kind === "book-done") {
      const row = rows.get(event.asin);
      row.li.className = "ok";
      row.meta.textContent = `${event.clips} highlights ✓`;
    }
    if (event.kind === "book-failed") {
      const row = rows.get(event.asin);
      row.li.className = "failed";
      row.meta.textContent = event.error;
    }
  };
}

function isLoginErrorMessage(message) {
  return typeof message === "string" && message.includes(LOGIN_ERROR_MESSAGE);
}

async function releaseTerminalUi() {
  hide("progress");
  await refreshReadyState();
}

function finishManualSync(port) {
  if (activeManualPort !== port) return;
  activeManualPort = null;
  manualSyncActive = false;
  setManualSyncControls(workerSyncRunning);
}

export async function startSync({
  connect = (info) => chrome.runtime.connect(info),
} = {}) {
  if (manualSyncActive) return;

  manualSyncActive = true;
  setManualSyncControls(true);
  hide("error");
  const handle = await loadVaultHandle();
  if (!handle) {
    manualSyncActive = false;
    setManualSyncControls(false);
    return refreshReadyState();
  }
  if (!(await ensurePermission(handle))) {
    manualSyncActive = false;
    setManualSyncControls(false);
    showError("Folder access was denied. Click Sync to try again, or change the vault.");
    return;
  }

  hide("ready"); show("progress");
  el("book-list").replaceChildren();
  hide("summary"); hide("sync-again");
  el("progress-title").textContent = "Syncing…";

  const rows = new Map();
  const port = connect({ name: "manual-sync" });
  activeManualPort = port;
  let receivedTerminalResult = false;
  port.onMessage.addListener(async (event) => {
    if (activeManualPort !== port) return;
    if (event.kind === "book-start" || event.kind === "book-done" || event.kind === "book-failed") {
      onProgress(rows)(event);
      return;
    }
    if (event.kind === "complete") {
      receivedTerminalResult = true;
      finishManualSync(port);
      el("progress-title").textContent = "Sync complete";
      el("summary").textContent =
        `${event.summary.newClips} new clips across ${event.summary.booksWritten} updated books ` +
        `(${event.summary.books} books checked) · JSON snapshot archived` +
        (event.summary.failures.length ? ` · ${event.summary.failures.length} failed` : "");
      show("summary"); show("sync-again");
      return;
    }
    if (event.kind === "busy") {
      receivedTerminalResult = true;
      finishManualSync(port);
      await releaseTerminalUi();
      showError("Another sync is already running.");
      return;
    }
    if (event.kind === "error") {
      receivedTerminalResult = true;
      finishManualSync(port);
      await releaseTerminalUi();
      if (isLoginErrorMessage(event.message)) {
        showError("You're not logged in to Amazon.", { loginLink: true });
      } else {
        showError(`Sync failed: ${event.message}`);
      }
    }
  });
  port.onDisconnect.addListener(async () => {
    if (receivedTerminalResult || activeManualPort !== port) return;
    finishManualSync(port);
    updateWorkerSyncStatus(true);
    await releaseTerminalUi();
    if (workerSyncRunning) {
      el("manual-sync-status").textContent =
        "Connection closed; the sync may still be running.";
    }
  });
}

export function wireSyncPage() {
  el("pick-vault").addEventListener("click", async () => {
    try {
      await pickVault();
      await refreshReadyState();
    } catch (err) {
      if (err.name !== "AbortError") showError(err.message);
    }
  });
  el("change-vault").addEventListener("click", async () => {
    await clearVaultHandle();
    await refreshReadyState();
  });
  el("sync").addEventListener("click", () => startSync());
  el("sync-again").addEventListener("click", async () => {
    hide("progress");
    await refreshReadyState();
    await startSync();
  });
  el("schedule-toggle").addEventListener("click", async () => {
    try {
      const current = scheduleFromResponse(await request({ type: "schedule-get" }));
      const response = current.schedule.enabled
        ? await request({ type: "schedule-disable" })
        : await request({ type: "schedule-configure", cadence: selectedCadence() });
      scheduleFromResponse(response);
      await refreshReadyState();
    } catch (error) {
      await refreshReadyState();
      showError(`Unable to update scheduled sync: ${error.message}`);
    }
  });

  return refreshReadyState();
}

if (typeof document !== "undefined" && el("sync")) {
  wireSyncPage();
}
