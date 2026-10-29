const openPanelBtn = document.getElementById("open-panel-btn") as HTMLButtonElement;
const openSettingsBtn = document.getElementById("open-settings-btn") as HTMLButtonElement;
const statusDot = document.getElementById("status-dot") as HTMLElement;
const statusLabel = document.getElementById("status-label") as HTMLElement;

async function checkGateway() {
  const data = await chrome.storage.local.get(["gatewayUrl", "authToken"]);
  const url = (data.gatewayUrl || "").trim();
  const token = (data.authToken || "").trim();

  if (!url || !token) {
    statusDot.style.background = "#475569";
    statusLabel.textContent = "Not configured — open Settings";
    return;
  }

  try {
    const res = await fetch(`${url}/healthz`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      statusDot.className = "status-dot connected";
      statusLabel.textContent = "Gateway connected";
      statusLabel.style.color = "#6ee7b7";
    } else {
      throw new Error();
    }
  } catch {
    statusDot.className = "status-dot error";
    statusLabel.textContent = "Gateway offline";
    statusLabel.style.color = "#fca5a5";
  }
}

openPanelBtn.addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    await chrome.sidePanel.open({ tabId: tabs[0].id });
    window.close();
  }
});

openSettingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

checkGateway();
