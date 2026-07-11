import { fetchLibrary, fetchBookClips, LoginRequiredError } from "./scraper.js";
import {
  archiveSnapshot, clearVaultHandle, ensurePermission,
  loadVaultHandle, pickVault, writeBook,
} from "./vault.js";
import { runSync } from "./sync.js";

const el = (id) => document.getElementById(id);
const show = (id) => el(id).classList.remove("hidden");
const hide = (id) => el(id).classList.add("hidden");

function showError(message, { loginLink = false } = {}) {
  el("error").innerHTML = loginLink
    ? `${message} <a href="https://read.amazon.com/notebook" target="_blank">Open Amazon notebook</a>`
    : message;
  show("error");
}

async function refreshReadyState() {
  hide("setup"); hide("ready"); hide("error");
  const handle = await loadVaultHandle();
  if (!handle) {
    show("setup");
    return;
  }
  el("vault-name").textContent = `Vault: ${handle.name}`;
  const { lastSync } = await chrome.storage.local.get("lastSync");
  el("last-sync").textContent = lastSync ? ` · last sync ${lastSync}` : "";
  show("ready");
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

function onProgress(rows) {
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

async function startSync() {
  hide("error");
  const handle = await loadVaultHandle();
  if (!handle) return refreshReadyState();
  if (!(await ensurePermission(handle))) {
    showError("Folder access was denied. Click Sync to try again, or change the vault.");
    return;
  }

  hide("ready"); show("progress");
  el("book-list").replaceChildren();
  hide("summary"); hide("sync-again");
  el("progress-title").textContent = "Syncing…";

  try {
    const summary = await runSync(
      { fetchLibrary, fetchBookClips, writeBook, archiveSnapshot },
      handle,
      onProgress(new Map())
    );
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    await chrome.storage.local.set({ lastSync: stamp });
    el("progress-title").textContent = "Sync complete";
    el("summary").textContent =
      `${summary.newClips} new clips across ${summary.booksWritten} updated books ` +
      `(${summary.books} books checked) · JSON snapshot archived` +
      (summary.failures.length ? ` · ${summary.failures.length} failed` : "");
    show("summary"); show("sync-again");
  } catch (err) {
    if (err instanceof LoginRequiredError) {
      showError("You're not logged in to Amazon.", { loginLink: true });
    } else {
      showError(`Sync failed: ${err.message}`);
    }
    hide("progress"); show("ready");
  }
}

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
el("sync").addEventListener("click", startSync);
el("sync-again").addEventListener("click", async () => {
  hide("progress");
  await refreshReadyState();
  await startSync();
});

refreshReadyState();
