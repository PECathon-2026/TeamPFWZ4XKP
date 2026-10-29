import {
  Envelope,
  Action,
  RunStatus,
  StepLogEntry,
} from "@privacylens/protocol";
import { sanitizeDOMTree } from "@privacylens/detector";
import { sendThroughGate } from "../src/egress/gate.js";
import { validateAction } from "../src/validator/index.js";
import { SecretVault } from "../src/vault/index.js";

const vault = new SecretVault();

// Restore encrypted vault contents from persisted storage on SW startup
chrome.storage.local.get(["vaultEncrypted"]).then((data) => {
  if (Array.isArray(data.vaultEncrypted) && data.vaultEncrypted.length > 0) {
    vault.loadStoredSecrets(data.vaultEncrypted);
  }
});

interface ActiveRunState {
  task: string;
  tabId: number;
  status: RunStatus;
  stepNumber: number;
  snapshotVersion: number;
  logs: StepLogEntry[];
  lastBlockedReason?: string;
}

// Map from tabId -> run state (supports multiple tabs)
const activeRuns = new Map<number, ActiveRunState>();

const GATEWAY_URL = "http://127.0.0.1:8787";
const AUTH_TOKEN = "";

// Open sidepanel on extension icon click
chrome.sidePanel
  ?.setPanelBehavior?.({ openPanelOnActionClick: true })
  ?.catch((error) => console.error(error));

chrome.action?.onClicked?.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel?.open({ tabId: tab.id });
  }
});

/**
 * Ensures offscreen document exists for FR-B5 Visual Default-Deny Canvas Masking.
 */
async function ensureOffscreenDocument(): Promise<boolean> {
  const offscreen = (chrome as any).offscreen;
  if (!offscreen) return false;

  try {
    const existing = await (chrome.runtime as any).getContexts?.({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (existing && existing.length > 0) return true;

    await offscreen.createDocument({
      url: "dist/offscreen/index.html",
      reasons: ["BLOBS"],
      justification: "Solid-fill opaque masking on visual frames (FR-B5)",
    });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Requests solid-fill masking from the offscreen canvas worker (FR-B5).
 */
export async function maskScreenshot(imageDataUrl: string, regions: any[]): Promise<string> {
  const ready = await ensureOffscreenDocument();
  if (!ready) return imageDataUrl;

  try {
    const res = await chrome.runtime.sendMessage({
      type: "MASK_IMAGE",
      imageDataUrl,
      regions,
    });
    return res?.maskedDataUrl || imageDataUrl;
  } catch {
    return imageDataUrl;
  }
}

/**
 * Broadcasts current run state to any connected side panel listeners.
 */
function broadcastState(tabId: number) {
  const activeRun = activeRuns.get(tabId);
  if (!activeRun) return;
  chrome.runtime.sendMessage({
    type: "STATE_UPDATE",
    tabId,
    status: activeRun.status,
    step: activeRun.stepNumber,
    totalSteps: 15,
    logs: activeRun.logs,
    blockedReason: activeRun.lastBlockedReason,
  }).catch(() => {}); // Ignore if sidepanel is closed
}

/**
 * Executes a single step of the agent run loop for a given tab.
 */
async function executeStep(tabId: number) {
  const activeRun = activeRuns.get(tabId);
  if (!activeRun || activeRun.status === "stopped" || activeRun.status === "done") return;

  try {
    activeRun.stepNumber++;
    activeRun.snapshotVersion++;
    activeRun.status = "snapshotting";
    broadcastState(tabId);

    // 1. Request Snapshot from Content Script
    const snapshotRes = await chrome.tabs.sendMessage(tabId, {
      type: "SNAPSHOT",
      snapshotVersion: activeRun.snapshotVersion,
    });

    if (!snapshotRes || !snapshotRes.rawTree) {
      activeRun.status = "failed";
      activeRun.lastBlockedReason = "Could not read page content. Make sure the page is fully loaded.";
      broadcastState(tabId);
      return;
    }

    // 2. Sanitize Locally
    activeRun.status = "sanitizing";
    broadcastState(tabId);

    const currentTab = await chrome.tabs.get(tabId);
    const currentDomain = currentTab.url ? new URL(currentTab.url).hostname : undefined;
    const storageData = await chrome.storage.local.get(["customRules", "gatewayUrl", "authToken"]);
    const customRules = storageData.customRules || [];
    const effectiveGatewayUrl = storageData.gatewayUrl || GATEWAY_URL;
    const effectiveAuthToken = storageData.authToken || AUTH_TOKEN;

    const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(
      snapshotRes.rawTree,
      new Map(),
      {},
      customRules,
      currentDomain
    );
    const rawSensitiveStrings = [
      ...Array.from(rawValuesMap.keys()),
      ...vault.getAllPlaintextForLedger(),
    ];

    // 3. Egress Gate Inspection & Gateway Call
    activeRun.status = "gate_check";
    broadcastState(tabId);

    const candidateEnvelope: Envelope = {
      requestId: crypto.randomUUID(),
      task: activeRun.task,
      snapshotVersion: activeRun.snapshotVersion,
      snapshot: sanitizedTree,
      availableSecrets: vault.getAvailableSecrets(),
      redactionLedger: ledger,
      timestamp: Date.now(),
    };

    // Broadcast privacy preview to side panel
    chrome.runtime.sendMessage({
      type: "PREVIEW",
      tabId,
      outboundPayload: candidateEnvelope,
      ledger,
    }).catch(() => {});

    const gateResult = await sendThroughGate(candidateEnvelope, rawSensitiveStrings, {
      gatewayUrl: effectiveGatewayUrl,
      authToken: effectiveAuthToken,
    });

    if (!gateResult.allowed || !gateResult.response) {
      activeRun.status = "blocked";
      activeRun.lastBlockedReason = gateResult.blockedReason || "Safety check failed. No data was transmitted.";
      activeRun.logs.push({
        stepNumber: activeRun.stepNumber,
        snapshotVersion: activeRun.snapshotVersion,
        status: "blocked",
        gateVerdict: "blocked",
        redactionCounts: ledger,
        timestamp: Date.now(),
      });
      broadcastState(tabId);
      return;
    }

    // 4. Validate Model Action
    activeRun.status = "validating";
    broadcastState(tabId);

    const proposedAction: Action = gateResult.response.action;
    const pageOrigin = currentTab.url ? new URL(currentTab.url).origin : "";

    const valResult = await validateAction(
      proposedAction,
      sanitizedTree,
      tabId,
      pageOrigin,
      activeRun.snapshotVersion
    );

    if (!valResult.valid) {
      activeRun.status = "failed";
      activeRun.lastBlockedReason = valResult.errorReason || "The proposed action failed validation.";
      broadcastState(tabId);
      return;
    }

    // 5. Tier-2 Human Approval Gate
    if (valResult.tier === "tier2") {
      activeRun.status = "awaiting_approval";
      broadcastState(tabId);

      chrome.runtime.sendMessage({
        type: "APPROVAL_REQUEST",
        tabId,
        action: proposedAction,
        fingerprint: valResult.fingerprint,
        actionHash: valResult.actionHash,
      }).catch(() => {});
      return; // Wait for APPROVAL_DECISION from side panel
    }

    // 6. Execute Validated Action
    await dispatchExecution(proposedAction, valResult.fingerprint, tabId);

  } catch (err: unknown) {
    const activeRun = activeRuns.get(tabId);
    if (activeRun) {
      activeRun.status = "failed";
      activeRun.lastBlockedReason = `Unexpected error: ${err instanceof Error ? err.message : "Unknown"}`;
      activeRun.logs.push({
        stepNumber: activeRun.stepNumber,
        snapshotVersion: activeRun.snapshotVersion,
        status: "failed",
        redactionCounts: {},
        timestamp: Date.now(),
      });
      broadcastState(tabId);
    }
  }
}

async function dispatchExecution(action: Action, fingerprint: unknown, tabId: number) {
  const activeRun = activeRuns.get(tabId);
  if (!activeRun) return;

  activeRun.status = "executing";
  broadcastState(tabId);

  if (action.type === "done") {
    activeRun.status = "done";
    broadcastState(tabId);
    return;
  }

  let vaultSecretValue: string | undefined;
  if (action.secretRef) {
    vaultSecretValue = vault.getSecret(action.secretRef);
  }

  const execRes = await chrome.tabs.sendMessage(tabId, {
    type: "EXECUTE",
    action,
    fingerprint,
    vaultSecretValue,
  });

  activeRun.logs.push({
    stepNumber: activeRun.stepNumber,
    snapshotVersion: activeRun.snapshotVersion,
    status: activeRun.status,
    action,
    redactionCounts: {},
    executionResult: execRes,
    timestamp: Date.now(),
  });

  if (!execRes?.ok) {
    activeRun.status = "failed";
    activeRun.lastBlockedReason = execRes?.reasonCode || "Action execution failed on page.";
    broadcastState(tabId);
    return;
  }

  // Schedule next step if still running and under step limit
  if (activeRun.stepNumber < 15) {
    setTimeout(() => executeStep(tabId).catch(console.error), 500);
  } else {
    activeRun.status = "done";
    broadcastState(tabId);
  }
}

// Intra-extension message routing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        activeRuns.set(tabId, {
          task: message.task,
          tabId,
          status: "snapshotting",
          stepNumber: 0,
          snapshotVersion: 0,
          logs: [],
        });
        executeStep(tabId).catch(console.error);
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "STOP") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        const run = activeRuns.get(tabId);
        if (run) {
          run.status = "stopped";
          broadcastState(tabId);
        }
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "APPROVAL_DECISION") {
    const tabId: number = message.tabId;
    const run = activeRuns.get(tabId);
    if (run && run.status === "awaiting_approval") {
      if (message.approved) {
        dispatchExecution(message.action, message.fingerprint, tabId).catch(console.error);
      } else {
        run.status = "stopped";
        broadcastState(tabId);
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "VAULT_ADD_SECRET") {
    vault.addSecret(message.name, message.type_, message.plaintext, message.passphrase)
      .then(() => {
        chrome.storage.local.set({ vaultEncrypted: vault.getStoredSecrets() });
        sendResponse({ ok: true });
      })
      .catch((err: unknown) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : "Vault error" });
      });
    return true;
  }

  if (message.type === "VAULT_REMOVE_SECRET") {
    vault.removeSecret(message.name);
    chrome.storage.local.set({ vaultEncrypted: vault.getStoredSecrets() });
    sendResponse({ ok: true });
    return true;
  }
});
