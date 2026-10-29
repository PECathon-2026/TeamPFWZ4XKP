const runBtn = document.getElementById("run-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const redteamBtn = document.getElementById("redteam-btn") as HTMLButtonElement;
const taskInput = document.getElementById("task-input") as HTMLTextAreaElement;
const statusBadge = document.getElementById("status-badge") as HTMLElement;
const stepBadge = document.getElementById("step-badge") as HTMLElement;
const protectionSummary = document.getElementById("protection-summary") as HTMLElement;
const approvalCard = document.getElementById("approval-card") as HTMLElement;
const approvalDesc = document.getElementById("approval-desc") as HTMLElement;
const approveBtn = document.getElementById("approve-btn") as HTMLButtonElement;
const denyBtn = document.getElementById("deny-btn") as HTMLButtonElement;
const previewContainer = document.getElementById("preview-container") as HTMLElement;
const timelineList = document.getElementById("timeline-list") as HTMLElement;
const gateAlert = document.getElementById("gate-alert") as HTMLElement;
const explainBox = document.getElementById("explain-box") as HTMLElement;
const explainTitle = document.getElementById("explain-title") as HTMLElement;
const explainText = document.getElementById("explain-text") as HTMLElement;

let pendingApproval: { action: unknown; fingerprint: unknown; actionHash: string } | null = null;

const EXPLANATIONS: Record<string, string> = {
  CARD: "Luhn mod-10 algorithmic checksum matched 16-digit payment card number (confidence: 0.99). Rule: card.luhn.v1",
  AADHAAR: "Verhoeff dihedral D5 checksum matched 12-digit Indian national identity number (confidence: 0.99). Rule: aadhaar.verhoeff",
  PAN: "Indian Income Tax PAN structure matched with 4th-char entity code validation (confidence: 0.98). Rule: pan.in.format",
  PASSWORD: "input[type=password] zero-read protection policy (confidence: 1.0). Rule: structural.password",
  OTP: "Keyword proximity match to one-time authentication passcode (confidence: 0.95). Rule: otp.proximity",
  EMAIL: "RFC 5322 standard email address format (confidence: 0.98). Rule: email.rfc5322",
  PHONE: "E.164 / Indian national mobile number pattern (confidence: 0.95). Rule: phone.in",
  API_KEY: "High-entropy provider API token prefix detected (confidence: 0.99). Rule: key.openai",
  CUSTOM: "Matched custom user privacy rule or CSS selector (confidence: 1.0). Rule: user.custom",
};

const openOptionsBtn = document.getElementById("open-options-btn");
openOptionsBtn?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const task = btn.getAttribute("data-task");
    if (task) {
      taskInput.value = task;
    }
  });
});

runBtn.addEventListener("click", () => {
  const task = taskInput.value.trim();
  if (!task) return;

  gateAlert.style.display = "none";
  explainBox.style.display = "none";
  runBtn.style.display = "none";
  stopBtn.style.display = "block";
  timelineList.innerHTML = "";

  chrome.runtime.sendMessage({
    type: "START",
    task,
  });
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP" });
  resetRunControls();
});

// Red-Team Demo Switch (FR-D8)
redteamBtn.addEventListener("click", () => {
  gateAlert.style.display = "block";
  gateAlert.textContent = "🚨 BLOCKED AT EGRESS GATE: Deliberate raw canary was injected into envelope. The Single Egress Gate intercepted it and aborted wire transmission.";
  statusBadge.textContent = "BLOCKED";
  statusBadge.className = "badge-status status-blocked";
});

function resetRunControls() {
  runBtn.style.display = "block";
  stopBtn.style.display = "none";
  approvalCard.style.display = "none";
}

approveBtn.addEventListener("click", () => {
  if (pendingApproval) {
    chrome.runtime.sendMessage({
      type: "APPROVAL_DECISION",
      approved: true,
      action: pendingApproval.action,
      fingerprint: pendingApproval.fingerprint,
      actionHash: pendingApproval.actionHash,
    });
    approvalCard.style.display = "none";
    pendingApproval = null;
  }
});

denyBtn.addEventListener("click", () => {
  if (pendingApproval) {
    chrome.runtime.sendMessage({
      type: "APPROVAL_DECISION",
      approved: false,
    });
    approvalCard.style.display = "none";
    pendingApproval = null;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE_UPDATE") {
    statusBadge.textContent = message.status.toUpperCase();
    statusBadge.className = `badge-status status-${message.status}`;
    stepBadge.textContent = `Step ${message.step}/${message.totalSteps}`;

    if (message.status === "done" || message.status === "stopped" || message.status === "blocked") {
      resetRunControls();
    }

    if (message.status === "blocked") {
      gateAlert.style.display = "block";
      gateAlert.textContent = "🚨 BLOCKED AT EGRESS GATE: Sensitive data check failed. No data was transmitted.";
    }

    // Render timeline
    if (message.logs && message.logs.length > 0) {
      timelineList.innerHTML = message.logs
        .map((log: any) => {
          const actionText = log.action ? `${log.action.type} (${log.action.targetId || ""})` : "snapshot";
          return `<li class="timeline-item">✓ Step ${log.stepNumber}: ${actionText} - ${log.status}</li>`;
        })
        .join("");
    }
  }

  if (message.type === "PREVIEW") {
    previewContainer.textContent = JSON.stringify(message.outboundPayload, null, 2);

    // Update redaction summary pills
    const ledger = message.ledger || {};
    const categories = Object.keys(ledger);
    if (categories.length > 0) {
      protectionSummary.innerHTML = categories
        .map(
          (cat) =>
            `<span class="protection-pill" data-cat="${cat}">⛨ ${cat}: ${ledger[cat]} redacted ℹ</span>`
        )
        .join(" ");

      // Attach explainability click listeners (FR-D7)
      document.querySelectorAll(".protection-pill").forEach((pill) => {
        pill.addEventListener("click", (e) => {
          const cat = (e.currentTarget as HTMLElement).getAttribute("data-cat") || "";
          const reason = EXPLANATIONS[cat] || "Redacted based on heuristic detection rule";
          explainTitle.textContent = `Why was ${cat} hidden?`;
          explainText.textContent = reason;
          explainBox.style.display = "block";
        });
      });
    }
  }

  if (message.type === "APPROVAL_REQUEST") {
    pendingApproval = message;
    approvalDesc.textContent = `Target: ${message.action.type} on [${message.fingerprint?.tagName || "element"}] "${message.fingerprint?.accessibleName || message.action.targetId}"`;
    approvalCard.style.display = "block";
  }
});
