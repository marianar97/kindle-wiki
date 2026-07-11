const VAULT_PERMISSION_MESSAGE =
  "Vault access needs approval. Open Kindle Wiki Sync and run a manual sync.";

function failureMessage(failures) {
  return failures.map(({ title, error }) => `${title}: ${error}`).join("; ");
}

export function createSyncService({
  loadVaultHandle,
  hasPermission,
  runSync,
  syncDeps,
  now = () => new Date(),
}) {
  let running = false;

  async function execute({ scheduled, onProgress = () => {} }) {
    if (running) return { kind: scheduled ? "skipped" : "busy" };
    running = true;

    try {
      const vaultHandle = await loadVaultHandle();
      if (!vaultHandle) {
        return { kind: "error", message: VAULT_PERMISSION_MESSAGE };
      }
      if (scheduled && !(await hasPermission(vaultHandle))) {
        return { kind: "error", message: VAULT_PERMISSION_MESSAGE };
      }

      const summary = await runSync(syncDeps, vaultHandle, onProgress);
      if (scheduled && summary.failures.length > 0) {
        return { kind: "error", message: failureMessage(summary.failures) };
      }
      return { kind: "complete", summary, completedAt: now().toISOString() };
    } catch (error) {
      return { kind: "error", message: error.message };
    } finally {
      running = false;
    }
  }

  return {
    isRunning: () => running,
    runManual: (onProgress) => execute({ scheduled: false, onProgress }),
    runScheduled: () => execute({ scheduled: true }),
  };
}
