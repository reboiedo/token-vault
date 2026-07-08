// Main plugin code (runs in Figma sandbox)

import { syncToFigma, SyncResult, checkForUpdates } from "./sync";
import { isLocalSource } from "./api";

// Storage keys
const STORAGE_KEY_API_KEY = "design-system-sync-api-key";
const STORAGE_KEY_LAST_SYNC = "design-system-sync-last-sync";
const STORAGE_KEY_DS_NAME = "design-system-sync-ds-name";
const STORAGE_KEY_AUTO_SYNC = "design-system-sync-auto";
// Local server URLs are stored PER DOCUMENT (they travel with the file, so
// each project's Figma file keeps its own port and teammates get it
// prefilled). Cloud API keys are credentials and stay in clientStorage —
// never in document data, which anyone with the file can read.
const PLUGIN_DATA_CONNECTION = "token-vault-connection";

async function getConnection(): Promise<string | null> {
  const doc = figma.root.getPluginData(PLUGIN_DATA_CONNECTION);
  if (doc) return doc;
  const stored = await figma.clientStorage.getAsync(STORAGE_KEY_API_KEY);
  return stored || null;
}

async function saveConnection(keyOrUrl: string): Promise<void> {
  const value = keyOrUrl.trim();
  if (isLocalSource(value)) {
    figma.root.setPluginData(PLUGIN_DATA_CONNECTION, value);
    // Drop a stale GLOBAL local URL so it can't hijack other documents;
    // leave stored cloud keys alone (they're the legacy fallback).
    const stored = await figma.clientStorage.getAsync(STORAGE_KEY_API_KEY);
    if (stored && isLocalSource(stored)) {
      await figma.clientStorage.deleteAsync(STORAGE_KEY_API_KEY);
    }
  } else {
    figma.root.setPluginData(PLUGIN_DATA_CONNECTION, "");
    await figma.clientStorage.setAsync(STORAGE_KEY_API_KEY, value);
  }
}

async function clearConnection(): Promise<void> {
  figma.root.setPluginData(PLUGIN_DATA_CONNECTION, "");
  await figma.clientStorage.deleteAsync(STORAGE_KEY_API_KEY);
}

// Live-watch: when enabled, the plugin polls the API on a fixed interval
// and re-runs sync. With idempotent sync, no-op ticks are cheap and silent.
const AUTO_SYNC_INTERVAL_MS = 3000;
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
// Guard so a slow sync never overlaps with the next tick.
let autoSyncInFlight = false;

// Message types
interface ConnectMessage {
  type: "connect";
  apiKey: string;
}

interface SyncMessage {
  type: "sync";
}

interface DisconnectMessage {
  type: "disconnect";
}

interface GetStateMessage {
  type: "get-state";
}

interface CheckUpdatesMessage {
  type: "check-updates";
}

interface SetAutoSyncMessage {
  type: "set-auto-sync";
  enabled: boolean;
}

interface DeleteVariablesMessage {
  type: "delete-variables";
  ids: string[];
}

type PluginMessage =
  | ConnectMessage
  | SyncMessage
  | DisconnectMessage
  | GetStateMessage
  | CheckUpdatesMessage
  | SetAutoSyncMessage
  | DeleteVariablesMessage;

// Show the UI
figma.showUI(__html__, {
  width: 320,
  height: 400,
  themeColors: true,
});

// Send initial state to UI
async function sendState(triggerUpdateCheck = false) {
  const apiKey = await getConnection();
  const lastSync = await figma.clientStorage.getAsync(STORAGE_KEY_LAST_SYNC);
  const designSystemName = await figma.clientStorage.getAsync(STORAGE_KEY_DS_NAME);
  const autoSync = await figma.clientStorage.getAsync(STORAGE_KEY_AUTO_SYNC);

  figma.ui.postMessage({
    type: "state",
    connected: !!apiKey,
    apiKey: apiKey || null,
    lastSync: lastSync || null,
    designSystemName: designSystemName || null,
    autoSync: !!autoSync,
  });

  // Trigger update check if connected
  if (triggerUpdateCheck && apiKey) {
    figma.ui.postMessage({ type: "checking", checking: true });
    try {
      const result = await checkForUpdates(apiKey);
      // Refresh stored ds name if the check picked it up.
      if (result.designSystemName) {
        await figma.clientStorage.setAsync(STORAGE_KEY_DS_NAME, result.designSystemName);
      }
      figma.ui.postMessage({
        type: "pending-changes",
        count: result.count,
        changes: result.changes,
        designSystemName: result.designSystemName ?? designSystemName ?? null,
      });
    } catch {
      figma.ui.postMessage({ type: "pending-changes", count: 0, changes: [] });
    }
    figma.ui.postMessage({ type: "checking", checking: false });
  }
}

/**
 * One auto-sync tick. Runs syncToFigma silently — only posts a result to
 * the UI when something actually changed. Updates lastSync timestamp on
 * every successful tick so the "last synced" display stays fresh.
 */
async function autoSyncTick() {
  if (autoSyncInFlight) return;
  const apiKey = await getConnection();
  if (!apiKey) {
    stopAutoSync();
    return;
  }
  autoSyncInFlight = true;
  try {
    // Auto-sync intentionally skips stale detection — it's a decision
    // that wants a deliberate moment, not a background polling tick.
    const result = await syncToFigma(apiKey);
    if (result.success) {
      await figma.clientStorage.setAsync(STORAGE_KEY_LAST_SYNC, new Date().toISOString());
      if (result.designSystemName) {
        await figma.clientStorage.setAsync(STORAGE_KEY_DS_NAME, result.designSystemName);
      }
    }
    const meaningful =
      result.createdCollections > 0 ||
      result.updatedCollections > 0 ||
      result.createdTokens > 0 ||
      result.updatedTokens > 0 ||
      !result.success;
    if (meaningful) {
      figma.ui.postMessage({ type: "sync-result", result });
      await sendState();
    } else {
      // Quiet tick — just refresh the timestamp display.
      figma.ui.postMessage({ type: "auto-sync-tick", lastSync: new Date().toISOString() });
    }
  } catch (err) {
    figma.ui.postMessage({
      type: "sync-result",
      result: {
        success: false,
        logs: [{ type: "error", message: `Auto-sync error: ${String(err)}` }],
        createdCollections: 0,
        updatedCollections: 0,
        createdTokens: 0,
        updatedTokens: 0,
      } as SyncResult,
    });
  } finally {
    autoSyncInFlight = false;
  }
}

function startAutoSync() {
  if (autoSyncTimer !== null) return;
  autoSyncTimer = setInterval(() => {
    void autoSyncTick();
  }, AUTO_SYNC_INTERVAL_MS);
  // Run an immediate tick so the user sees feedback right away when toggling on.
  void autoSyncTick();
}

function stopAutoSync() {
  if (autoSyncTimer !== null) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}

// Handle messages from UI
figma.ui.onmessage = async (msg: PluginMessage) => {
  switch (msg.type) {
    case "get-state":
      await sendState(true); // Check for updates on initial load
      break;

    case "connect":
      // Save API key and test connection
      figma.ui.postMessage({ type: "syncing", syncing: true });

      try {
        const result = await syncToFigma(msg.apiKey, { detectStale: true });

        if (result.success) {
          // Persist the connection (per-document for local URLs)
          await saveConnection(msg.apiKey);
          await figma.clientStorage.setAsync(STORAGE_KEY_LAST_SYNC, new Date().toISOString());
          if (result.designSystemName) {
            await figma.clientStorage.setAsync(STORAGE_KEY_DS_NAME, result.designSystemName);
          }
        }

        figma.ui.postMessage({
          type: "sync-result",
          result,
        });

        await sendState();
      } catch (error) {
        figma.ui.postMessage({
          type: "sync-result",
          result: {
            success: false,
            logs: [{ type: "error", message: String(error) }],
            createdCollections: 0,
            updatedCollections: 0,
            createdTokens: 0,
            updatedTokens: 0,
          } as SyncResult,
        });
      }

      figma.ui.postMessage({ type: "syncing", syncing: false });
      break;

    case "sync":
      // Sync with saved API key
      const apiKey = await getConnection();

      if (!apiKey) {
        figma.ui.postMessage({
          type: "sync-result",
          result: {
            success: false,
            logs: [{ type: "error", message: "Not connected. Enter API key first." }],
            createdCollections: 0,
            updatedCollections: 0,
            createdTokens: 0,
            updatedTokens: 0,
          } as SyncResult,
        });
        return;
      }

      figma.ui.postMessage({ type: "syncing", syncing: true });

      try {
        const result = await syncToFigma(apiKey, { detectStale: true });

        if (result.success) {
          await figma.clientStorage.setAsync(STORAGE_KEY_LAST_SYNC, new Date().toISOString());
          if (result.designSystemName) {
            await figma.clientStorage.setAsync(STORAGE_KEY_DS_NAME, result.designSystemName);
          }
        }

        figma.ui.postMessage({
          type: "sync-result",
          result,
        });

        await sendState();
      } catch (error) {
        figma.ui.postMessage({
          type: "sync-result",
          result: {
            success: false,
            logs: [{ type: "error", message: String(error) }],
            createdCollections: 0,
            updatedCollections: 0,
            createdTokens: 0,
            updatedTokens: 0,
          } as SyncResult,
        });
      }

      figma.ui.postMessage({ type: "syncing", syncing: false });
      break;

    case "set-auto-sync":
      await figma.clientStorage.setAsync(STORAGE_KEY_AUTO_SYNC, msg.enabled);
      if (msg.enabled) {
        startAutoSync();
      } else {
        stopAutoSync();
      }
      await sendState();
      break;

    case "disconnect":
      stopAutoSync();
      await clearConnection();
      await figma.clientStorage.deleteAsync(STORAGE_KEY_LAST_SYNC);
      await figma.clientStorage.deleteAsync(STORAGE_KEY_DS_NAME);
      await figma.clientStorage.deleteAsync(STORAGE_KEY_AUTO_SYNC);
      await sendState();
      figma.ui.postMessage({
        type: "sync-result",
        result: {
          success: true,
          logs: [{ type: "info", message: "Disconnected" }],
          createdCollections: 0,
          updatedCollections: 0,
          createdTokens: 0,
          updatedTokens: 0,
        } as SyncResult,
      });
      break;

    case "delete-variables": {
      // Best-effort batch deletion across variables AND text styles.
      // Text style ids look identical to variable ids in Figma's API,
      // so we try `getVariableById` first; if it returns nothing, fall
      // back to `getStyleById` to handle the text-style case.
      const deleted: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];
      for (const id of msg.ids) {
        try {
          const v = figma.variables.getVariableById(id);
          if (v) {
            v.remove();
            deleted.push(id);
            continue;
          }
          const style = figma.getStyleById(id);
          if (style) {
            style.remove();
            deleted.push(id);
            continue;
          }
          failed.push({ id, error: "Not found" });
        } catch (err) {
          failed.push({
            id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      figma.ui.postMessage({
        type: "delete-variables-result",
        deleted,
        failed,
      });
      break;
    }

    case "check-updates":
      const storedApiKey = await getConnection();
      if (!storedApiKey) {
        figma.ui.postMessage({ type: "pending-changes", count: 0, changes: [] });
        return;
      }

      figma.ui.postMessage({ type: "checking", checking: true });

      try {
        const checkResult = await checkForUpdates(storedApiKey);
        figma.ui.postMessage({ type: "pending-changes", count: checkResult.count, changes: checkResult.changes });
      } catch {
        // Silently fail - don't bother the user with check errors
        figma.ui.postMessage({ type: "pending-changes", count: 0, changes: [] });
      }

      figma.ui.postMessage({ type: "checking", checking: false });
      break;
  }
};

// Send initial state, then resume auto-sync if it was previously enabled.
(async () => {
  await sendState(true);
  const autoSync = await figma.clientStorage.getAsync(STORAGE_KEY_AUTO_SYNC);
  const apiKey = await getConnection();
  if (autoSync && apiKey) startAutoSync();
})();
