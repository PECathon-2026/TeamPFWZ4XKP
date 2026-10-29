// Element refs
const runBtn = document.getElementById("run-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const taskInput = document.getElementById("task-input") as HTMLTextAreaElement;
const connDot = document.getElementById("conn-dot") as HTMLElement;
const connLabel = document.getElementById("conn-label") as HTMLElement;
const setupBanner = document.getElementById("setup-banner") as HTMLElement;
const setupOpenSettings = document.getElementById("setup-open-settings") as HTMLButtonElement;
const agentStatus = document.getElementById("agent-status") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const progressFill = document.getElementById("progress-fill") as HTMLElement;
const stepLabel = document.getElementById("step-label") as HTMLElement;
const shieldEmpty = document.getElementById("shield-empty") as HTMLElement;
const redactionPills = document.getElementById("redaction-pills") as HTMLElement;
const explainBox = document.getElementById("explain-box") as HTMLElement;
const explainTitle = document.getElementById("explain-title") as HTMLElement;
const explainText = document.getElementById("explain-text") as HTMLElement;
const approvalCard = document.getElementById("approval-card") as HTMLElement;
const approvalDesc = document.getElementById("approval-desc") as HTMLElement;
const approveBtn = document.getElementById("approve-btn") as HTMLButtonElement;
const denyBtn = document.getElementById("deny-btn") as HTMLButtonElement;
const errorCard = document.getElementById("error-card") as HTMLElement;
const errorText = document.getElementById("error-text") as HTMLElement;
const doneCard = document.getElementById("done-card") as HTMLElement;
const doneSteps = document.getElementById("done-steps") as HTMLElement;
const timelineList = document.getElementById("timeline-list") as HTMLElement;
const openOptionsBtn = document.getElementById("open-options-btn") as HTMLButtonElement;

let pendingApproval: { action: unknown; fingerprint: unknown; actionHash: string; tabId: number } | null = null;
let currentTabId: number | null = null;

// Human-readable status labels
const STATUS_LABELS: Record<string, string> = {
  snapshotting: "Reading the page...",
  sanitizing: "Scanning for sensitive data...",
  gate_check: "Verifying safety before sending...",
  validating: "Reviewing suggested action...",
  executing: "Performing action...",
  awaiting_approval: "Waiting for your approval...",
  done: "Task complete",
  stopped: "Stopped",
  failed: "Something went wrong",
  blocked: "Action blocked by safety gate",
};

const EXPLANATIONS: Record<string, string> = {
  CARD: "Luhn mod-10 checksum matched a 16-digit payment card number. Raw value replaced with a placeholder before any network transmission.",
  AADHAAR: "Verhoeff checksum matched a 12-digit Indian national ID (Aadhaar). Protected under local redaction policy.",
  PAN: "Indian Income Tax PAN structure matched. Entity code and format validated. Placeholder substituted.",
  PASSWORD: "This field uses type=password. PrivacyLens never reads password field values — zero-read policy enforced.",
  OTP: "Keyword proximity matched a one-time authentication code. Redacted to prevent replay exposure.",
  EMAIL: "RFC 5322 email address format detected. Replaced with category placeholder.",
  PHONE: "E.164 / Indian national mobile number detected. Redacted.",
  API_KEY: "High-entropy provider API token prefix detected. Replaced with placeholder.",
  CARD_CVV: "Payment card security code (CVV/CVC) field detected structurally. Value never transmitted.",
  CUSTOM: "Matched a custom privacy rule you configured in Settings.",
};

// Get current tab ID on load
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]?.id) {
    currentTabId = tabs[0].id;
  }
});

// Update tab ID on tab switch and clear stale cards
chrome.tabs.onActivated?.addListener((activeInfo) => {
  currentTabId = activeInfo.tabId;
  resetCards();
});

// Check connection status on load
async function checkConnection() {
  const data = await chrome.storage.local.get(["gatewayUrl", "authToken"]);
  const url = (data.gatewayUrl || "http://127.0.0.1:8787").trim();

  try {
    const res = await fetch(`${url}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      const provName = json.provider ? ` (${json.provider})` : "";
      setConnStatus("connected", `Connected${provName}`);
      setupBanner.classList.remove("visible");
      // Save default url if empty
      if (!data.gatewayUrl) {
        chrome.storage.local.set({ gatewayUrl: url });
      }
    } else {
      setConnStatus("error", "Gateway HTTP " + res.status);
      setupBanner.classList.add("visible");
    }
  } catch {
    setConnStatus("offline", "Gateway offline");
    setupBanner.classList.add("visible");
  }
}

function setConnStatus(state: "connected" | "error" | "offline" | "checking", label?: string) {
  connDot.className = "conn-dot";
  connLabel.className = "conn-label";
  if (state === "connected") {
    connDot.classList.add("connected");
    connLabel.classList.add("connected");
    connLabel.textContent = label || "Connected";
  } else if (state === "error") {
    connDot.classList.add("error");
    connLabel.classList.add("error");
    connLabel.textContent = label || "Gateway error";
  } else if (state === "offline") {
    connLabel.textContent = label || "Gateway offline";
  } else {
    connLabel.textContent = label || "Checking...";
  }
}

// Settings button
openOptionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
setupOpenSettings.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Preset chips
document.querySelectorAll(".preset-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    const task = btn.getAttribute("data-task");
    if (task) taskInput.value = task;
    taskInput.focus();
  });
});

// Run button
runBtn.addEventListener("click", async () => {
  const task = taskInput.value.trim();
  if (!task) {
    taskInput.focus();
    return;
  }

  // Get current active tab ID in this window
  let targetTabId = currentTabId;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      targetTabId = tab.id;
    } else {
      const [fallbackTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (fallbackTab?.id) {
        targetTabId = fallbackTab.id;
      }
    }
  } catch {
    // Fall back to currentTabId
  }

  // Reset state
  resetCards();
  runBtn.style.display = "none";
  stopBtn.classList.add("visible");
  agentStatus.classList.add("visible");
  statusText.textContent = "Starting...";
  progressFill.style.width = "0%";

  chrome.runtime.sendMessage({ type: "START", task, tabId: targetTabId });
});

// Stop button
stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP" });
  resetRunControls();
});

// Approve / Deny
approveBtn.addEventListener("click", () => {
  if (pendingApproval) {
    chrome.runtime.sendMessage({
      type: "APPROVAL_DECISION",
      approved: true,
      action: pendingApproval.action,
      fingerprint: pendingApproval.fingerprint,
      actionHash: pendingApproval.actionHash,
      tabId: pendingApproval.tabId,
    });
    approvalCard.classList.remove("visible");
    pendingApproval = null;
    agentStatus.classList.add("visible");
  }
});

denyBtn.addEventListener("click", () => {
  if (pendingApproval) {
    chrome.runtime.sendMessage({
      type: "APPROVAL_DECISION",
      approved: false,
      tabId: pendingApproval.tabId,
    });
    approvalCard.classList.remove("visible");
    pendingApproval = null;
    resetRunControls();
  }
});

// Message handler
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE_UPDATE") {
    const { status, step, totalSteps, logs, blockedReason } = message;

    // Update progress
    const pct = totalSteps > 0 ? Math.round((step / totalSteps) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    stepLabel.textContent = `Step ${step} / ${totalSteps}`;
    statusText.textContent = STATUS_LABELS[status] || status;

    if (status === "done") {
      agentStatus.classList.remove("visible");
      doneCard.classList.add("visible");
      doneSteps.textContent = `Completed in ${step} step${step !== 1 ? "s" : ""}`;
      resetRunControls();
    } else if (status === "blocked") {
      agentStatus.classList.remove("visible");
      errorCard.classList.add("visible");
      errorText.textContent = blockedReason || "Safety check prevented this action. No data was transmitted.";
      resetRunControls();
    } else if (status === "failed") {
      agentStatus.classList.remove("visible");
      errorCard.classList.add("visible");
      errorText.textContent = blockedReason || "An unexpected error occurred. Check the gateway is running.";
      resetRunControls();
    } else if (status === "stopped") {
      agentStatus.classList.remove("visible");
      resetRunControls();
    } else if (status === "awaiting_approval") {
      agentStatus.classList.remove("visible");
    }

    // Render timeline
    if (logs && logs.length > 0) {
      timelineList.innerHTML = logs.map((log: any) => {
        const actionText = log.action
          ? `${capitalize(log.action.type)}${log.action.targetId ? ` → ${log.action.targetId}` : ""}`
          : "Page snapshot";
        return `<li class="timeline-item"><span class="timeline-icon">✓</span><span>${actionText}</span></li>`;
      }).join("");
    }
  }

  if (message.type === "PREVIEW") {
    const ledger = message.ledger || {};
    const categories = Object.keys(ledger);

    if (categories.length > 0) {
      shieldEmpty.style.display = "none";
      redactionPills.innerHTML = categories.map((cat) =>
        `<button class="pill" data-cat="${cat}">
          🛡 ${cat}
          <span class="pill-count">${ledger[cat]}</span>
        </button>`
      ).join("");

      // Attach explainability click listeners
      redactionPills.querySelectorAll(".pill").forEach((pill) => {
        pill.addEventListener("click", (e) => {
          const cat = (e.currentTarget as HTMLElement).getAttribute("data-cat") || "";
          explainTitle.textContent = `Why was ${cat} hidden?`;
          explainText.textContent = EXPLANATIONS[cat] || "Redacted based on a heuristic detection rule.";
          explainBox.classList.add("visible");
        });
      });
    } else {
      shieldEmpty.style.display = "block";
      redactionPills.innerHTML = "";
    }
  }

  if (message.type === "APPROVAL_REQUEST") {
    pendingApproval = message;
    const action = message.action || {};
    const fp = message.fingerprint || {};
    const desc = fp.accessibleName
      ? `"${fp.accessibleName}" (${action.type})`
      : `${action.type} on ${fp.tagName || "element"}`;
    approvalDesc.textContent = `The agent wants to: ${desc}. This is a consequential action that cannot be undone automatically.`;
    approvalCard.classList.add("visible");
  }
});

function resetRunControls() {
  runBtn.style.display = "flex";
  stopBtn.classList.remove("visible");
}

function resetCards() {
  errorCard.classList.remove("visible");
  doneCard.classList.remove("visible");
  approvalCard.classList.remove("visible");
  agentStatus.classList.remove("visible");
  explainBox.classList.remove("visible");
  timelineList.innerHTML = `<li class="timeline-empty">No actions yet</li>`;
  shieldEmpty.style.display = "block";
  redactionPills.innerHTML = "";
  progressFill.style.width = "0%";
  stepLabel.textContent = "Step 0 / 15";
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Init
checkConnection();
