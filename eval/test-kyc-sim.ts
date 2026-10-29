import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";
import { sanitizeDOMTree } from "@privacylens/detector";
import { Envelope } from "@privacylens/protocol";
import { sendThroughGate } from "../apps/extension/src/egress/gate.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\Asus\\.gemini\\antigravity\\brain\\7877025d-d2f0-494f-bf47-a803a3cd5a53";

async function runKYCSimulation() {
  console.log("=== STEP 1: Launching Chrome Browser for KYC Task ===");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 900, height: 750 },
  });

  const page = await browser.newPage();

  console.log("=== STEP 2: Navigating to KYC Support Portal ===");
  await page.goto("http://127.0.0.1:8787/support", { waitUntil: "networkidle0" });

  const rawKycShot = path.join(ARTIFACT_DIR, "sim-kyc-01-raw.png");
  await page.screenshot({ path: rawKycShot });
  console.log("Captured KYC Raw Page:", rawKycShot);

  console.log("=== STEP 3: Extracting DOM & Performing Local Sanitization ===");
  const snapshotResult = await page.evaluate(`(() => {
    let idCounter = 0;
    const ALLOWED = new Set(["body", "main", "section", "article", "header", "footer", "nav", "a", "button", "input", "select", "textarea", "form", "label", "p", "span", "div", "h1", "h2", "h3", "table", "tr", "td", "strong"]);

    const walk = (el) => {
      if (!el) return null;
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      if (!ALLOWED.has(tag)) return null;

      const id = el.id ? el.id : "node_" + (idCounter++);
      const attrs = {};
      if (el.attributes) {
        for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
      }

      const children = [];
      for (const c of Array.from(el.children)) {
        const childNode = walk(c);
        if (childNode) children.push(childNode);
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

    return walk(document.body);
  })()`);

  const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(snapshotResult as any);
  console.log("Local Redaction Ledger:", ledger);
  console.log("Redacted Raw Sensitive Values:", Array.from(rawValuesMap.keys()));

  console.log("=== STEP 4: Sending KYC Envelope to Egress Gate ===");
  const envelope: Envelope = {
    requestId: crypto.randomUUID(),
    task: "Complete the KYC verification form",
    snapshotVersion: 1,
    snapshot: sanitizedTree,
    availableSecrets: [],
    redactionLedger: ledger,
    timestamp: Date.now(),
  };

  const gateResult = await sendThroughGate(envelope, Array.from(rawValuesMap.keys()), {
    gatewayUrl: "http://127.0.0.1:8787",
    authToken: "",
  });

  console.log("Gate Allowed:", gateResult.allowed);
  console.log("Proposed Action:", gateResult.response?.action);

  console.log("=== STEP 5: Executing Action on the Live Page ===");
  const action = gateResult.response?.action;
  if (action?.type === "click" && action.targetId) {
    // Add visual click indicator on the page
    await page.evaluate((targetId) => {
      const el = document.getElementById(targetId);
      if (el) {
        el.style.outline = "3px solid #10b981";
        el.style.boxShadow = "0 0 15px #10b981";
        el.innerText = "✓ Action Executed by Agent";
      }
    }, action.targetId);

    await page.click(`#${action.targetId}`);
  }

  await new Promise((r) => setTimeout(r, 600));

  const afterKycShot = path.join(ARTIFACT_DIR, "sim-kyc-02-clicked.png");
  await page.screenshot({ path: afterKycShot });
  console.log("Captured KYC Action Executed Screenshot:", afterKycShot);

  await browser.close();
  console.log("=== KYC SIMULATION COMPLETED SUCCESSFULLY ===");
}

runKYCSimulation().catch(console.error);

