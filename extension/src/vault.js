// Vault access: File System Access API writes plus the pure decision logic
// around them. The directory handle for vault/ persists in IndexedDB.

const DB_NAME = "kindle-wiki-sync";
const STORE = "handles";
const VAULT_KEY = "vault";
const BLOCK_ID_RE = /\^([0-9a-f]{12})/g;

// --- pure logic -------------------------------------------------------------

export function stripVolatile(text) {
  return text.replace(/^last_synced: .*$/m, "last_synced:");
}

export function shouldWrite(oldContent, newContent) {
  if (oldContent == null) return true;
  return stripVolatile(oldContent) !== stripVolatile(newContent);
}

export function countNewClips(oldContent, clips) {
  const oldIds = new Set((oldContent ?? "").match(BLOCK_ID_RE)?.map((m) => m.slice(1)) ?? []);
  return clips.filter((c) => !oldIds.has(c.id)).length;
}

export function snapshotName(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-amazon-notebook.json`;
}

// --- IndexedDB handle persistence -------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbOp(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveVaultHandle(handle) {
  await dbOp("readwrite", (store) => store.put(handle, VAULT_KEY));
}

export async function loadVaultHandle() {
  return (await dbOp("readonly", (store) => store.get(VAULT_KEY))) ?? null;
}

export async function clearVaultHandle() {
  await dbOp("readwrite", (store) => store.delete(VAULT_KEY));
}

// --- File System Access ------------------------------------------------------

export async function pickVault() {
  const handle = await window.showDirectoryPicker({ id: "kindle-wiki-vault", mode: "readwrite" });
  await saveVaultHandle(handle);
  return handle;
}

export async function hasPermission(handle) {
  return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
}

export async function ensurePermission(handle) {
  const opts = { mode: "readwrite" };
  if (await hasPermission(handle)) return true;
  return (await handle.requestPermission(opts)) === "granted";
}

async function getDir(vaultHandle, names) {
  let dir = vaultHandle;
  for (const name of names) dir = await dir.getDirectoryHandle(name, { create: true });
  return dir;
}

async function readFileIfExists(dir, name) {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return await file.text();
  } catch (err) {
    if (err.name === "NotFoundError") return null;
    throw err;
  }
}

async function writeFile(dir, name, content) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

// Writes raw/books/<slug>.md unless unchanged. Returns clip/new-clip counts.
export async function writeBook(vaultHandle, slug, content, clips) {
  const dir = await getDir(vaultHandle, ["raw", "books"]);
  const name = `${slug}.md`;
  const old = await readFileIfExists(dir, name);
  if (!shouldWrite(old, content)) return { written: false, newClips: 0 };
  await writeFile(dir, name, content);
  return { written: true, newClips: countNewClips(old, clips) };
}

// Archives the full-library JSON snapshot to raw/clippings/.
export async function archiveSnapshot(vaultHandle, payload, date = new Date()) {
  const dir = await getDir(vaultHandle, ["raw", "clippings"]);
  await writeFile(dir, snapshotName(date), JSON.stringify(payload, null, 2));
}
