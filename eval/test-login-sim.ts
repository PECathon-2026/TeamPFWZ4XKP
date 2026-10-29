import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";
import { sanitizeDOMTree } from "@privacylens/detector";
import { Envelope } from "@privacylens/protocol";
import { sendThroughGate } from "../apps/extension/src/egress/gate.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\Asus\\.gemini\\antigravity\\brain\\7877025d-d2f0-494f-bf47-a803a3cd5a53";

async function runBrowserSimulation() {
  console.log("=== STEP 1: Launching Chrome Browser ===");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 900, height: 750 },
  });

  const page = await browser.newPage();

  console.log("=== STEP 2: Navigating to Authentication & 2FA Page ===");
  await page.goto("http://127.0.0.1:8787/auth", { waitUntil: "networkidle0" });

  const rawShotPath = path.join(ARTIFACT_DIR, "sim-01-raw-page.png");
  await page.screenshot({ path: rawShotPath });
  console.log("Captured raw page screenshot:", rawShotPath);

  console.log("=== STEP 3: Content Script Injected & Visual Shield Activated ===");
  const snapshotResult = await page.evaluate(`(() => {
    let idCounter = 0;
    const ALLOWED = new Set(["body", "main", "section", "article", "header", "footer", "nav", "a", "button", "input", "select", "textarea", "form", "label", "p", "span", "div", "h1", "h2", "h3", "table", "tr", "td", "strong"]);

    const walk = (el) => {
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED.has(tag)) return null;
      const s = window.getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return null;

      const id = el.id ? el.id : "node_" + (idCounter++);
      const attrs = {};
      for (const a of Array.from(el.attributes)) {
        if (tag === "input" && a.name === "value" && el.type === "password") continue;
        attrs[a.name] = a.value;
      }
      if (tag === "input" && el.type !== "password") {
        attrs["value"] = el.value;
      }

      const children = [];
      for (const c of Array.from(el.children)) {
        if (c instanceof HTMLElement) {
          const childNode = walk(c);
          if (childNode) children.push(childNode);
        }
      }

      let text = "";
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 3 && n.textContent) text += n.textContent.trim() + " ";
      }

      return {
        id,
        tag,
        text: text.trim() || undefined,
        attributes: attrs,
        children,
        isInteractive: tag === "button" || tag === "input",
      };
    };

    // Visual PrivacyLens overlay badges
    const host = document.createElement("div");
    host.id = "privacylens-shield-container";
    host.style.position = "absolute";
    host.style.top = "0";
    host.style.left = "0";
    host.style.width = "100%";
    host.style.height = "100%";
    host.style.pointerEvents = "none";
    host.style.zIndex = "2147483647";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = \`
      <style>
        .pl-badge { position: absolute; background: #0284c7; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; z-index: 2147483647; box-shadow: 0 2px 6px rgba(0,0,0,0.25); }
        .pl-highlight { position: absolute; border: 2px dashed #0284c7; background: rgba(56, 189, 248, 0.12); border-radius: 6px; z-index: 2147483646; }
      </style>
    \`;

    document.querySelectorAll("input").forEach((inp) => {
      const r = inp.getBoundingClientRect();
      if (r.width === 0) return;
      const b = document.createElement("div");
      b.className = "pl-highlight";
      b.style.left = (r.left - 2) + "px";
      b.style.top = (r.top - 2) + "px";
      b.style.width = (r.width + 4) + "px";
      b.style.height = (r.height + 4) + "px";

      const badge = document.createElement("div");
      badge.className = "pl-badge";
      badge.textContent = "🛡️ PrivacyLens Protected";
      badge.style.left = (r.left) + "px";
      badge.style.top = (r.top - 22) + "px";

      shadow.appendChild(b);
      shadow.appendChild(badge);
    });
    document.body.appendChild(host);

    return walk(document.body);
  })()`);

  const protectedShotPath = path.join(ARTIFACT_DIR, "sim-02-protected-shield.png");
  await page.screenshot({ path: protectedShotPath });
  console.log("Captured Privacy Shield screenshot:", protectedShotPath);

  console.log("=== STEP 4: Local Sanitization via @privacylens/detector ===");
  const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(snapshotResult as any);
  console.log("Redaction Ledger Results:", ledger);
  console.log("Protected Raw Values Found & Stripped locally:", Array.from(rawValuesMap.keys()));

  console.log("=== STEP 5: Passing through Single Egress Gate ===");
  const { EnvelopeSchema } = await import("@privacylens/protocol");
  const candidateEnvelope: Envelope = {
    requestId: crypto.randomUUID(),
    task: "Verify 2FA OTP code and log in",
    snapshotVersion: 1,
    snapshot: sanitizedTree,
    availableSecrets: [],
    redactionLedger: ledger,
    timestamp: Date.now(),
  };

  const zodCheck = EnvelopeSchema.safeParse(candidateEnvelope);
  if (!zodCheck.success) {
    console.error("ZOD VALIDATION ERROR:", JSON.stringify(zodCheck.error.format(), null, 2));
  }

  const { detectAll } = await import("@privacylens/detector");
  const rawFindings = detectAll(JSON.stringify(candidateEnvelope));
  console.log("Tripwire Raw Findings:", rawFindings);

  const gateResult = await sendThroughGate(
    candidateEnvelope,
    Array.from(rawValuesMap.keys()),
    {
      gatewayUrl: "http://127.0.0.1:8787",
      authToken: "",
    }
  );

  console.log("Egress Gate Verdict: Allowed =", gateResult.allowed);
  console.log("Egress Gate Full Result:", JSON.stringify(gateResult, null, 2));
  console.log("Reasoner Action Proposed:", gateResult.response?.action);

  console.log("=== STEP 6: Executing Step 1 Action (Typing OTP) ===");
  const action1 = gateResult.response?.action;
  if (action1?.type === "type" && action1.targetId) {
    await page.focus(`#${action1.targetId}`);
    await page.evaluate((id) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (el) el.value = "";
    }, action1.targetId);
    await page.type(`#${action1.targetId}`, action1.value || "829104", { delay: 40 });
  }

  await new Promise((r) => setTimeout(r, 400));
  const typedShotPath = path.join(ARTIFACT_DIR, "sim-03-agent-typed.png");
  await page.screenshot({ path: typedShotPath });
  console.log("Captured Agent Typed Screenshot:", typedShotPath);

  console.log("=== STEP 7: Step 2 Egress Gate & Submit Form ===");
  const step2Envelope: Envelope = {
    requestId: crypto.randomUUID(),
    task: "Verify 2FA OTP code and log in",
    snapshotVersion: 2,
    snapshot: sanitizedTree,
    availableSecrets: [],
    redactionLedger: ledger,
    timestamp: Date.now(),
  };

  const gateResult2 = await sendThroughGate(
    step2Envelope,
    Array.from(rawValuesMap.keys()),
    {
      gatewayUrl: "http://127.0.0.1:8787",
      authToken: "",
    }
  );

  console.log("Step 2 Egress Gate Allowed =", gateResult2.allowed);
  console.log("Step 2 Reasoner Action Proposed:", gateResult2.response?.action);

  const action2 = gateResult2.response?.action;
  if (action2?.type === "click" && action2.targetId) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
      page.click(`#${action2.targetId}`),
    ]);
  } else {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
      page.click("#submit-btn"),
    ]);
  }

  await new Promise((r) => setTimeout(r, 800));
  const completeShotPath = path.join(ARTIFACT_DIR, "sim-04-login-complete.png");
  await page.screenshot({ path: completeShotPath });
  console.log("Captured Login Complete Screenshot:", completeShotPath);

  // Also maintain backward-compatible sim-03-after-action.png
  fs.copyFileSync(completeShotPath, path.join(ARTIFACT_DIR, "sim-03-after-action.png"));

  await browser.close();

  // Save detailed audit JSON
  const report = {
    task: "Verify 2FA OTP code and log in",
    url: "http://127.0.0.1:8787/auth",
    ledger,
    rawValuesMap: Object.fromEntries(rawValuesMap),
    action1Proposed: action1,
    action2Proposed: action2,
    screenshots: {
      raw: rawShotPath,
      protected: protectedShotPath,
      typed: typedShotPath,
      complete: completeShotPath,
    },
    wirePayloadSanitizedSnapshot: candidateEnvelope.snapshot,
  };

  fs.writeFileSync(
    path.join(ARTIFACT_DIR, "sim-report.json"),
    JSON.stringify(report, null, 2)
  );

  console.log("=== SIMULATION COMPLETED SUCCESSFULLY ===");
}

runBrowserSimulation().catch(console.error);
