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

    // 0. Tab safety check
    const currentTab = await chrome.tabs.get(tabId);
    const tabUrl = currentTab.url || "";
    if (
      tabUrl.startsWith("chrome://") ||
      tabUrl.startsWith("chrome-extension://") ||
      tabUrl.startsWith("edge://") ||
      tabUrl.startsWith("about:")
    ) {
      activeRun.status = "failed";
      activeRun.lastBlockedReason =
        "PrivacyLens cannot run on browser internal pages (" +
        tabUrl.slice(0, 30) +
        "). Please open a real website (e.g. http://127.0.0.1:8787 or an e-commerce page) and run your task there.";
      broadcastState(tabId);
      return;
    }

    if (tabUrl.startsWith("file://")) {
      const isAllowedFile = await chrome.extension.isAllowedFileSchemeAccess();
      if (!isAllowedFile) {
        activeRun.status = "failed";
        activeRun.lastBlockedReason =
          "To use PrivacyLens on local file:/// pages, enable 'Allow access to file URLs' on the PrivacyLens card in chrome://extensions. Or, open http://127.0.0.1:8787 in your browser.";
        broadcastState(tabId);
        return;
      }
    }

    // 1. Request Snapshot from Content Script (with dual-path direct fallback)
    let rawTree: any = null;
    try {
      const snapshotRes = await chrome.tabs.sendMessage(tabId, {
        type: "SNAPSHOT",
        snapshotVersion: activeRun.snapshotVersion,
      });
      if (snapshotRes && snapshotRes.rawTree) {
        rawTree = snapshotRes.rawTree;
      }
    } catch {
      // Content script messaging failed; fall through to direct injection
    }

    // Secondary Direct Fallback: Inject self-contained extractor directly into live DOM
    if (!rawTree) {
      try {
        const [execResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const ALLOWED = new Set([
              "body", "main", "section", "article", "header", "footer", "nav",
              "a", "button", "input", "select", "textarea", "form",
              "label", "p", "span", "div", "h1", "h2", "h3", "h4",
              "h5", "h6", "table", "tr", "td", "th", "ul", "ol", "li", "code"
            ]);
            let idCounter = 0;
            const walk = (el: Element): any => {
              if (!el) return null;
              const tag = el.tagName ? el.tagName.toLowerCase() : "";
              if (!ALLOWED.has(tag)) return null;
              try {
                const style = window.getComputedStyle(el);
                if (style && (style.display === "none" || style.visibility === "hidden")) return null;
              } catch {}

              const id = el.id ? el.id : `node_${idCounter++}`;
              const attrs: Record<string, string> = {};
              if (el.attributes) {
                for (const a of Array.from(el.attributes)) {
                  if (tag === "input" && a.name === "value" && (el as HTMLInputElement).type === "password") continue;
                  attrs[a.name] = a.value;
                }
              }
              if (tag === "input" && (el as HTMLInputElement).type !== "password") {
                if ((el as HTMLInputElement).value) attrs["value"] = (el as HTMLInputElement).value;
              }
              if (tag === "textarea" && (el as HTMLTextAreaElement).value) {
                attrs["value"] = (el as HTMLTextAreaElement).value;
              }
              if (tag === "select" && (el as HTMLSelectElement).value) {
                attrs["value"] = (el as HTMLSelectElement).value;
              }

              const children: any[] = [];
              const elChildren = el.children || [];
              for (let i = 0; i < elChildren.length; i++) {
                const childNode = walk(elChildren[i]);
                if (childNode) children.push(childNode);
              }

              let text = "";
              const childNodes = el.childNodes || [];
              for (let i = 0; i < childNodes.length; i++) {
                const n = childNodes[i];
                if (n && n.nodeType === 3 && n.textContent) text += n.textContent.trim() + " ";
              }

              return {
                id,
                tag,
                role: el.getAttribute("role") || undefined,
                name: el.getAttribute("aria-label") || attrs["name"] || undefined,
                text: text.trim() || undefined,
                attributes: attrs,
                children,
                isInteractive: tag === "button" || tag === "input" || tag === "a" || tag === "select" || tag === "textarea",
              };
            };
            const target = document.body || document.documentElement;
            return target ? walk(target) : null;
          },
        });
        if (execResult && execResult.result) {
          rawTree = execResult.result;
        }
      } catch (err: any) {
        console.warn("[PrivacyLens] Direct script injection fallback failed:", err);
      }
    }

    if (!rawTree) {
      activeRun.status = "failed";
      activeRun.lastBlockedReason =
        "Could not read page content. If this is a newly opened tab or local file, refresh the page and try again.";
      broadcastState(tabId);
      return;
    }

    // 2. Sanitize Locally
    activeRun.status = "sanitizing";
    broadcastState(tabId);

    let currentDomain: string | undefined;
    try {
      if (currentTab.url && !currentTab.url.startsWith("file:")) {
        currentDomain = new URL(currentTab.url).hostname;
      }
    } catch {}

    const storageData = await chrome.storage.local.get(["customRules", "gatewayUrl", "authToken", "provider", "modelName"]);
    const customRules = storageData.customRules || [];
    const effectiveGatewayUrl = storageData.gatewayUrl || GATEWAY_URL;
    const effectiveAuthToken = storageData.authToken || AUTH_TOKEN;
    const effectiveProvider = storageData.provider || "nemotron";
    const effectiveModel = storageData.modelName || "nvidia/llama-3.1-nemotron-70b-instruct";

    const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(
      rawTree,
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
      provider: effectiveProvider,
      model: effectiveModel,
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
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes("Receiving end does not exist") ||
        errMsg.includes("Could not establish connection")
      ) {
        activeRun.lastBlockedReason =
          "PrivacyLens cannot interact with this tab. Please refresh the page or navigate to a real website (http/https).";
      } else {
        activeRun.lastBlockedReason = errMsg;
      }
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

  let execRes: any = null;
  try {
    execRes = await chrome.tabs.sendMessage(tabId, {
      type: "EXECUTE",
      action,
      fingerprint,
      vaultSecretValue,
    });
  } catch {
    // Direct execution fallback via chrome.scripting
    try {
      const [scriptRes] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (act: any, secretVal: any) => {
          const targetEl = act.targetId ? document.getElementById(act.targetId) : null;
          if (!targetEl && act.targetId) return { ok: false, reasonCode: "ELEMENT_STALE_OR_MISSING" };
          try {
            if (act.type === "click" && targetEl) {
              if (targetEl instanceof HTMLInputElement && (targetEl.type === "checkbox" || targetEl.type === "radio")) {
                targetEl.checked = !targetEl.checked;
                targetEl.dispatchEvent(new Event("change", { bubbles: true }));
              }
              targetEl.focus?.();
              targetEl.click();
            } else if (act.type === "type" && targetEl) {
              const text = secretVal || act.value || "";
              if (targetEl instanceof HTMLInputElement || targetEl instanceof HTMLTextAreaElement) {
                targetEl.focus();
                targetEl.value = text;
                targetEl.dispatchEvent(new Event("input", { bubbles: true }));
                targetEl.dispatchEvent(new Event("change", { bubbles: true }));
              }
            } else if (act.type === "select" && targetEl instanceof HTMLSelectElement) {
              const val = act.value || "";
              targetEl.focus();
              for (let i = 0; i < targetEl.options.length; i++) {
                if (targetEl.options[i].value === val || targetEl.options[i].text.toLowerCase().includes(val.toLowerCase())) {
                  targetEl.selectedIndex = i;
                  break;
                }
              }
              targetEl.dispatchEvent(new Event("change", { bubbles: true }));
            } else if (act.type === "scroll") {
              window.scrollBy({ top: act.direction === "up" ? -400 : 400, behavior: "smooth" });
            }
            return { ok: true };
          } catch (e: any) {
            return { ok: false, reasonCode: e?.message || "Execution error" };
          }
        },
        args: [action, vaultSecretValue],
      });
      execRes = scriptRes?.result || { ok: true };
    } catch (directErr: any) {
      execRes = { ok: false, reasonCode: directErr?.message || "Action dispatch failed" };
    }
  }

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
    const handleStart = (tabId?: number) => {
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
    };

    if (message.tabId) {
      handleStart(message.tabId);
    } else {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        handleStart(tabs[0]?.id);
      });
    }
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
