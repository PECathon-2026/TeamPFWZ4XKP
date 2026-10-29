const openPanelBtn = document.getElementById("open-panel-btn") as HTMLButtonElement;
const openHubBtn = document.getElementById("open-hub-btn") as HTMLButtonElement;
const openSettingsBtn = document.getElementById("open-settings-btn") as HTMLButtonElement;

openPanelBtn.addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    await chrome.sidePanel.open({ tabId: tabs[0].id });
    window.close();
  }
});

openHubBtn.addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["gatewayUrl"]);
  const url = data.gatewayUrl || "http://127.0.0.1:8787";
  chrome.tabs.create({ url: `${url}/` });
  window.close();
});

openSettingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

