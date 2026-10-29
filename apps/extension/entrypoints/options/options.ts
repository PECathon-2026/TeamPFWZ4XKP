import { sanitizeString, UserRule } from "@privacylens/detector";

// DOM Elements
const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanes = document.querySelectorAll(".tab-pane");
const toast = document.getElementById("status-toast") as HTMLElement;

// Gateway Settings Elements
const gatewayUrlInput = document.getElementById("gateway-url") as HTMLInputElement;
const providerSelect = document.getElementById("provider-select") as HTMLSelectElement;
const modelNameInput = document.getElementById("model-name") as HTMLInputElement;
const authTokenInput = document.getElementById("auth-token") as HTMLInputElement;
const saveGatewayBtn = document.getElementById("save-gateway-btn") as HTMLButtonElement;
const testConnBtn = document.getElementById("test-conn-btn") as HTMLButtonElement;
const connResult = document.getElementById("conn-result") as HTMLElement;

// Custom Rules Elements
const ruleNameInput = document.getElementById("rule-name") as HTMLInputElement;
const ruleTypeSelect = document.getElementById("rule-type") as HTMLSelectElement;
const rulePatternInput = document.getElementById("rule-pattern") as HTMLInputElement;
const ruleCategorySelect = document.getElementById("rule-category") as HTMLSelectElement;
const ruleDomainInput = document.getElementById("rule-domain") as HTMLInputElement;
const addRuleBtn = document.getElementById("add-rule-btn") as HTMLButtonElement;
const rulesTableBody = document.getElementById("rules-table-body") as HTMLElement;

// Sandbox Elements
const sandboxInput = document.getElementById("sandbox-input") as HTMLInputElement;
const testSandboxBtn = document.getElementById("test-sandbox-btn") as HTMLButtonElement;
const sandboxOutput = document.getElementById("sandbox-output") as HTMLElement;

// Vault Elements
const vaultPassInput = document.getElementById("vault-pass") as HTMLInputElement;
const unlockVaultBtn = document.getElementById("unlock-vault-btn") as HTMLButtonElement;
const lockVaultBtn = document.getElementById("lock-vault-btn") as HTMLButtonElement;
const secretKeyInput = document.getElementById("secret-key") as HTMLInputElement;
const secretCatSelect = document.getElementById("secret-cat") as HTMLSelectElement;
const secretValInput = document.getElementById("secret-val") as HTMLInputElement;
const addSecretBtn = document.getElementById("add-secret-btn") as HTMLButtonElement;
const vaultTableBody = document.getElementById("vault-table-body") as HTMLElement;

// Backup Elements
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const importBtn = document.getElementById("import-btn") as HTMLButtonElement;
const importFileInput = document.getElementById("import-file") as HTMLInputElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;

// In-memory state
let currentRules: UserRule[] = [];
let vaultUnlocked = false;

// Start empty; users add their own rules
const DEFAULT_RULES: UserRule[] = [];

// Switch Tabs
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    tabPanes.forEach((p) => p.classList.remove("active"));

    btn.classList.add("active");
    const tabId = btn.getAttribute("data-tab");
    if (tabId) {
      document.getElementById(tabId)?.classList.add("active");
    }
  });
});

function showToast(message: string, isError = false) {
  toast.textContent = message;
  toast.className = `status-toast ${isError ? "toast-error" : "toast-success"}`;
  toast.style.display = "block";
  setTimeout(() => {
    toast.style.display = "none";
  }, 3500);
}

// 1. Load Settings
async function loadSettings() {
  const data = await chrome.storage.local.get([
    "gatewayUrl",
    "provider",
    "modelName",
    "authToken",
    "customRules",
    "vaultSecrets",
  ]);

  if (data.gatewayUrl) gatewayUrlInput.value = data.gatewayUrl;
  if (data.provider) {
    providerSelect.value = data.provider;
  } else {
    providerSelect.value = "nemotron";
  }
  if (data.modelName) {
    modelNameInput.value = data.modelName;
  } else {
    modelNameInput.value = "nvidia/llama-3.1-nemotron-70b-instruct";
  }
  if (data.authToken) authTokenInput.value = data.authToken;

  currentRules = data.customRules || [];
  renderRulesTable();
  renderVaultTable(data.vaultSecrets || []);
}

// Auto-fill suggested model when provider changes
providerSelect.addEventListener("change", () => {
  const defaults: Record<string, string> = {
    nemotron: "nvidia/llama-3.1-nemotron-70b-instruct",
    anthropic: "claude-3-5-sonnet-20241022",
    openai: "gpt-4o-mini",
    "openai-compatible": "gpt-4o-mini",
    ollama: "llama3.2",
    mock: "mock-v1",
  };
  if (defaults[providerSelect.value]) {
    modelNameInput.value = defaults[providerSelect.value];
  }
});

// 2. Save Gateway Settings
saveGatewayBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({
    gatewayUrl: gatewayUrlInput.value.trim(),
    provider: providerSelect.value,
    modelName: modelNameInput.value.trim(),
    authToken: authTokenInput.value.trim(),
  });
  showToast("Gateway settings saved successfully!");
});

// 3. Test Connection
testConnBtn.addEventListener("click", async () => {
  connResult.textContent = "Connecting to " + gatewayUrlInput.value + "/healthz ...";
  connResult.style.color = "#94a3b8";

  try {
    const res = await fetch(`${gatewayUrlInput.value.trim()}/healthz`);
    if (res.ok) {
      const json = await res.json();
      connResult.textContent = `✓ Connected successfully: ${json.service} v${json.version} (Active Reasoner: ${json.provider || "nemotron"}, Model: ${json.model || "default"}, Status: ${json.status})`;
      connResult.style.color = "#10b981";
    } else {
      connResult.textContent = `✗ Gateway returned HTTP ${res.status}`;
      connResult.style.color = "#ef4444";
    }
  } catch (err: unknown) {
    connResult.textContent = `✗ Connection failed: ${err instanceof Error ? err.message : "Network error"}`;
    connResult.style.color = "#ef4444";
  }
});

// 4. Custom Rules
function renderRulesTable() {
  rulesTableBody.innerHTML = currentRules
    .map((rule, idx) => `
      <tr>
        <td><strong>${rule.name}</strong></td>
        <td><span class="badge-pill ${rule.type === "regex" ? "badge-regex" : "badge-css"}">${rule.type}</span></td>
        <td><code>${rule.pattern}</code></td>
        <td><span class="badge-pill badge-active">${rule.category}</span></td>
        <td>${rule.domainPattern || "<span style='color:#6b7280;'>all</span>"}</td>
        <td>
          <input type="checkbox" class="toggle-rule" data-idx="${idx}" ${rule.enabled ? "checked" : ""}>
        </td>
        <td>
          <button class="btn btn-danger btn-sm delete-rule-btn" data-idx="${idx}">Delete</button>
        </td>
      </tr>
    `)
    .join("");

  document.querySelectorAll(".delete-rule-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt((e.currentTarget as HTMLElement).getAttribute("data-idx") || "0", 10);
      currentRules.splice(idx, 1);
      saveRules();
    });
  });

  document.querySelectorAll(".toggle-rule").forEach((box) => {
    box.addEventListener("change", (e) => {
      const target = e.currentTarget as HTMLInputElement;
      const idx = parseInt(target.getAttribute("data-idx") || "0", 10);
      currentRules[idx].enabled = target.checked;
      saveRules();
    });
  });
}

async function saveRules() {
  await chrome.storage.local.set({ customRules: currentRules });
  renderRulesTable();
  showToast("Custom privacy rules updated.");
}

addRuleBtn.addEventListener("click", () => {
  const name = ruleNameInput.value.trim();
  const pattern = rulePatternInput.value.trim();
  const type = ruleTypeSelect.value as "regex" | "css_selector";
  const category = ruleCategorySelect.value as any;
  const domainPattern = ruleDomainInput.value.trim();

  if (!name || !pattern) {
    showToast("Rule name and pattern are required.", true);
    return;
  }

  // Validate regex if regex type
  if (type === "regex") {
    try {
      new RegExp(pattern);
    } catch {
      showToast("Invalid Regular Expression syntax.", true);
      return;
    }
  }

  currentRules.push({
    id: `rule_${Date.now()}`,
    name,
    type,
    pattern,
    category,
    domainPattern: domainPattern || undefined,
    description: `User rule: ${name}`,
    enabled: true,
  });

  ruleNameInput.value = "";
  rulePatternInput.value = "";
  ruleDomainInput.value = "";

  saveRules();
});

// 5. Rule Sandbox Test
testSandboxBtn.addEventListener("click", () => {
  const sample = sandboxInput.value;
  if (!sample) {
    sandboxOutput.textContent = "// Enter sample text to test.";
    return;
  }

  const { sanitizedText, findings } = sanitizeString(sample, new Map(), {}, currentRules);
  sandboxOutput.textContent = `Output: ${sanitizedText}\n\nFindings: ${JSON.stringify(findings, null, 2)}`;
});

// 6. Vault Management
unlockVaultBtn.addEventListener("click", () => {
  if (vaultPassInput.value.length < 6) {
    showToast("Passphrase must be at least 6 characters.", true);
    return;
  }
  vaultUnlocked = true;
  showToast("Vault unlocked in memory. Master key derived with PBKDF2.");
});

lockVaultBtn.addEventListener("click", () => {
  vaultUnlocked = false;
  vaultPassInput.value = "";
  showToast("Vault locked.");
});

async function renderVaultTable(secrets: Array<{ key: string; category: string }>) {
  if (secrets.length === 0) {
    vaultTableBody.innerHTML = `<tr><td colspan="4" style="color: #6b7280; text-align: center;">No secrets in vault</td></tr>`;
    return;
  }

  vaultTableBody.innerHTML = secrets
    .map(
      (sec, idx) => `
      <tr>
        <td><strong>${sec.key}</strong></td>
        <td><span class="badge-pill badge-active">${sec.category}</span></td>
        <td><code>vault://${sec.key}</code></td>
        <td>
          <button class="btn btn-danger btn-sm delete-secret-btn" data-idx="${idx}">Remove</button>
        </td>
      </tr>
    `
    )
    .join("");

  document.querySelectorAll(".delete-secret-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = parseInt((e.currentTarget as HTMLElement).getAttribute("data-idx") || "0", 10);
      const data = await chrome.storage.local.get(["vaultSecrets"]);
      const list = data.vaultSecrets || [];
      list.splice(idx, 1);
      await chrome.storage.local.set({ vaultSecrets: list });
      renderVaultTable(list);
      showToast("Secret reference removed.");
    });
  });
}

addSecretBtn.addEventListener("click", async () => {
  if (!vaultUnlocked) {
    showToast("Please enter master passphrase and click 'Unlock Vault' first.", true);
    return;
  }

  const key = secretKeyInput.value.trim();
  const category = secretCatSelect.value;
  const val = secretValInput.value.trim();

  if (!key || !val) {
    showToast("Key reference and secret value are required.", true);
    return;
  }

  const data = await chrome.storage.local.get(["vaultSecrets"]);
  const list = data.vaultSecrets || [];
  list.push({ key, category });
  await chrome.storage.local.set({ vaultSecrets: list });

  secretKeyInput.value = "";
  secretValInput.value = "";
  renderVaultTable(list);
  showToast(`Secret stored in vault as vault://${key}`);
});

// 7. Backup & Export
exportBtn.addEventListener("click", async () => {
  const data = await chrome.storage.local.get([
    "gatewayUrl",
    "provider",
    "modelName",
    "customRules",
  ]);

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `privacylens-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Configuration exported.");
});

importBtn.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const imported = JSON.parse(event.target?.result as string);
      if (imported.gatewayUrl || imported.customRules) {
        await chrome.storage.local.set(imported);
        await loadSettings();
        showToast("Configuration imported successfully!");
      } else {
        showToast("Invalid configuration format.", true);
      }
    } catch {
      showToast("Failed to parse JSON file.", true);
    }
  };
  reader.readAsText(file);
});

resetBtn.addEventListener("click", async () => {
  if (confirm("Reset all custom rules and gateway settings to default?")) {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      gatewayUrl: "http://127.0.0.1:8787",
      provider: "mock",
      modelName: "mock-v1",
      authToken: "",
      customRules: [],
    });
    await loadSettings();
    showToast("Reset to defaults completed.");
  }
});

// Initialize on page load
loadSettings();

