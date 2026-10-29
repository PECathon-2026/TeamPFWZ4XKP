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
// Pre-populate demo secret in vault for local injection demo
vault.addSecret("card.number", "CARD", "4111-1111-1111-1111", "demoPass123").catch(console.error);

interface ActiveRunState {
  task: string;
  tabId: number;
  status: RunStatus;
  stepNumber: number;
  snapshotVersion: number;
  logs: StepLogEntry[];
}

let activeRun: ActiveRunState | null = null;
const GATEWAY_URL = "http://127.0.0.1:8787";
const AUTH_TOKEN = "dev_privacylens_token_001";

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
 * Executes a single step of the agent run loop.
 */
async function executeStep() {
  if (!activeRun || activeRun.status === "stopped" || activeRun.status === "done") return;

  activeRun.stepNumber++;
  activeRun.snapshotVersion++;
  activeRun.status = "snapshotting";
  broadcastState();

  // 1. Request Snapshot from Content Script
  const snapshotRes = await chrome.tabs.sendMessage(activeRun.tabId, {
    type: "SNAPSHOT",
    snapshotVersion: activeRun.snapshotVersion,
  });

  if (!snapshotRes || !snapshotRes.rawTree) {
    activeRun.status = "failed";
    broadcastState();
    return;
  }

  // 2. Sanitize Locally
  activeRun.status = "sanitizing";
  broadcastState();

  const currentTab = await chrome.tabs.get(activeRun.tabId);
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
  broadcastState();

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
    outboundPayload: candidateEnvelope,
    ledger,
  });

  const gateResult = await sendThroughGate(candidateEnvelope, rawSensitiveStrings, {
    gatewayUrl: effectiveGatewayUrl,
    authToken: effectiveAuthToken,
  });

  if (!gateResult.allowed || !gateResult.response) {
    activeRun.status = "blocked";
    activeRun.logs.push({
      stepNumber: activeRun.stepNumber,
      snapshotVersion: activeRun.snapshotVersion,
      status: "blocked",
      gateVerdict: "blocked",
      redactionCounts: ledger,
      timestamp: Date.now(),
    });
    broadcastState();
    return;
  }

  // 4. Validate Model Action
  activeRun.status = "validating";
  broadcastState();

  const proposedAction: Action = gateResult.response.action;
  const pageOrigin = currentTab.url ? new URL(currentTab.url).origin : "";

  const valResult = await validateAction(
    proposedAction,
    sanitizedTree,
    activeRun.tabId,
    pageOrigin,
    activeRun.snapshotVersion
  );

  if (!valResult.valid) {
    activeRun.status = "failed";
    broadcastState();
    return;
  }

  // 5. Tier-2 Human Approval Gate
  if (valResult.tier === "tier2") {
    activeRun.status = "awaiting_approval";
    broadcastState();

    chrome.runtime.sendMessage({
      type: "APPROVAL_REQUEST",
      action: proposedAction,
      fingerprint: valResult.fingerprint,
      actionHash: valResult.actionHash,
    });
    return; // Wait for APPROVAL_DECISION from side panel
  }

  // 6. Execute Validated Action
  await dispatchExecution(proposedAction, valResult.fingerprint);
}

async function dispatchExecution(action: Action, fingerprint: unknown) {
  if (!activeRun) return;

  activeRun.status = "executing";
  broadcastState();

  if (action.type === "done") {
    activeRun.status = "done";
    broadcastState();
    return;
  }

  let vaultSecretValue: string | undefined;
  if (action.secretRef) {
    vaultSecretValue = vault.getSecret(action.secretRef);
  }

  const execRes = await chrome.tabs.sendMessage(activeRun.tabId, {
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

  // Schedule next step if still running and under step limit
  if (activeRun.stepNumber < 15 && (activeRun.status as string) !== "done") {
    setTimeout(executeStep, 500);
  } else {
    activeRun.status = "done";
    broadcastState();
  }
}

function broadcastState() {
  if (!activeRun) return;
  chrome.runtime.sendMessage({
    type: "STATE_UPDATE",
    status: activeRun.status,
    step: activeRun.stepNumber,
    totalSteps: 15,
    logs: activeRun.logs,
  });
}

// Intra-extension message routing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        activeRun = {
          task: message.task,
          tabId: tabs[0].id,
          status: "snapshotting",
          stepNumber: 0,
          snapshotVersion: 0,
          logs: [],
        };
        executeStep();
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "STOP") {
    if (activeRun) {
      activeRun.status = "stopped";
      broadcastState();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "APPROVAL_DECISION") {
    if (activeRun && activeRun.status === "awaiting_approval") {
      if (message.approved) {
        dispatchExecution(message.action, message.fingerprint);
      } else {
        activeRun.status = "stopped";
        broadcastState();
      }
    }
    sendResponse({ ok: true });
    return true;
  }
});
