export const ALARM_NAME = "scheduled-sync";
export const DAILY_MINUTES = 24 * 60;
export const WEEKLY_MINUTES = 7 * DAILY_MINUTES;

const PERIODS = { daily: DAILY_MINUTES, weekly: WEEKLY_MINUTES };

function intervalMs(cadence) {
  const minutes = PERIODS[cadence];
  if (!minutes) throw new Error(`Unsupported cadence: ${cadence}`);
  return minutes * 60_000;
}

function defaultSchedule() {
  return { enabled: false, cadence: "daily", nextRunAt: null };
}

function createRecurringAlarm(chrome, nextRunAt, cadence) {
  return chrome.alarms.create(ALARM_NAME, {
    when: Date.parse(nextRunAt),
    periodInMinutes: PERIODS[cadence],
  });
}

function isValidTimestamp(value) {
  return Number.isFinite(Date.parse(value));
}

export function getNextRunAt(cadence, previousRunAt, now = new Date()) {
  let next = new Date(previousRunAt).getTime();
  const interval = intervalMs(cadence);
  while (next <= now.getTime()) next += interval;
  return new Date(next).toISOString();
}

export async function getSchedule(chrome) {
  const { schedule = defaultSchedule() } = await chrome.storage.local.get([
    "schedule",
  ]);
  return { ...defaultSchedule(), ...schedule };
}

export async function getStatus(chrome) {
  const { syncStatus = {} } = await chrome.storage.local.get(["syncStatus"]);
  return syncStatus;
}

export async function configureSchedule(chrome, cadence, now = new Date()) {
  const periodInMinutes = PERIODS[cadence];
  if (!periodInMinutes) throw new Error(`Unsupported cadence: ${cadence}`);

  const nextRunAt = new Date(now.getTime() + intervalMs(cadence)).toISOString();
  const schedule = { enabled: true, cadence, nextRunAt };
  await chrome.alarms.clear(ALARM_NAME);
  await createRecurringAlarm(chrome, nextRunAt, cadence);
  await chrome.storage.local.set({ schedule });
  return schedule;
}

export async function clearSchedule(chrome) {
  const schedule = await getSchedule(chrome);
  const disabled = {
    enabled: false,
    cadence: schedule.cadence,
    nextRunAt: null,
  };
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.storage.local.set({ schedule: disabled });
  return disabled;
}

export async function recordSuccess(chrome, summary, completedAt) {
  const syncStatus = {
    lastSuccessfulSync: { completedAt, summary },
    lastScheduledFailure: null,
  };
  await chrome.storage.local.set({ syncStatus });
  return syncStatus;
}

export async function recordFailure(chrome, message, attemptedAt) {
  const { lastSuccessfulSync = null } = await getStatus(chrome);
  const syncStatus = {
    lastSuccessfulSync,
    lastScheduledFailure: { attemptedAt, message },
  };
  await chrome.storage.local.set({ syncStatus });
  return syncStatus;
}

export async function ensureAlarm(chrome, now = new Date()) {
  const schedule = await getSchedule(chrome);
  if (!schedule.enabled) return schedule;

  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (alarm) return schedule;

  if (
    !isValidTimestamp(schedule.nextRunAt) ||
    Date.parse(schedule.nextRunAt) <= now.getTime()
  ) {
    return schedule;
  }

  await createRecurringAlarm(chrome, schedule.nextRunAt, schedule.cadence);
  return schedule;
}

export async function advanceSchedule(chrome, completedAt) {
  const schedule = await getSchedule(chrome);
  if (!schedule.enabled) return schedule;

  const completedAtDate = new Date(completedAt);
  const nextRunAt = isValidTimestamp(schedule.nextRunAt)
    ? getNextRunAt(schedule.cadence, schedule.nextRunAt, completedAtDate)
    : new Date(completedAtDate.getTime() + intervalMs(schedule.cadence)).toISOString();
  const nextSchedule = { ...schedule, nextRunAt };
  await chrome.alarms.clear(ALARM_NAME);
  await createRecurringAlarm(chrome, nextRunAt, schedule.cadence);
  await chrome.storage.local.set({ schedule: nextSchedule });
  return nextSchedule;
}
