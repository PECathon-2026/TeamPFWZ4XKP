import { describe, it, expect, beforeAll } from "vitest";
import { Envelope, Action } from "@privacylens/protocol";
import { sanitizeDOMTree, tripwireScan, identifyDefaultDenyRegions, applySolidFillRedaction } from "@privacylens/detector";
import { sendThroughGate } from "../apps/extension/src/egress/gate.js";
import { validateAction } from "../apps/extension/src/validator/index.js";
import { generateCanary } from "./canaries/generator.js";
import { createCheckoutPage } from "./pages/s1-checkout.js";
import { createAuthPage } from "./pages/s2-auth.js";
import { createSupportPage } from "./pages/s3-support.js";
import { createVideoConferencingPage } from "./pages/s4-video.js";
import { createDeveloperSettingsPage } from "./pages/s5-developer.js";
import { createAdversarialPage } from "./pages/adversarial.js";

const GATEWAY_URL = "http://127.0.0.1:8787";
let authToken = "dev_privacylens_token_001";

describe("PrivacyLens Phase 1 End-to-End Test Suite", () => {
  beforeAll(async () => {
    // Register install token from running gateway
    const res = await fetch(`${GATEWAY_URL}/v1/auth/register`, { method: "POST" });
    const data = await res.json();
    authToken = data.accessToken;
  });

  it("S1: E-commerce Checkout Flow (Detect, Sanitize, Gate, Propose, Approve Tier 2)", async () => {
    const cardCanary = generateCanary("CARD", "e2e_1");
    const emailCanary = generateCanary("EMAIL", "e2e_1");
    const phoneCanary = generateCanary("PHONE", "e2e_1");

    const { tree: rawTree, planted } = createCheckoutPage({
      card: cardCanary,
      email: emailCanary,
      phone: phoneCanary,
    });

    // 1. Local Sanitization
    const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(rawTree);
    expect(ledger["CARD"]).toBe(1);
    expect(ledger["EMAIL"]).toBe(1);
    expect(ledger["PHONE"]).toBe(1);

    const rawSecrets = Array.from(rawValuesMap.keys());

    // 2. Egress Gate
    const envelope: Envelope = {
      requestId: crypto.randomUUID(),
      task: "Select cheapest item and pay",
      snapshotVersion: 2,
      snapshot: sanitizedTree,
      availableSecrets: [],
      redactionLedger: ledger,
      timestamp: Date.now(),
    };

    const gateResult = await sendThroughGate(envelope, rawSecrets, {
      gatewayUrl: GATEWAY_URL,
      authToken,
    });

    expect(gateResult.allowed).toBe(true);
    expect(gateResult.response).toBeDefined();

    const action = gateResult.response!.action;
    expect(action.type).toBe("click");
    expect(action.targetId).toBe("pay-btn");

    // 3. Action Validation & Anti-TOCTOU Fingerprinting
    const valResult = await validateAction(
      action,
      sanitizedTree,
      1,
      "http://127.0.0.1:8787",
      2
    );

    expect(valResult.valid).toBe(true);
    expect(valResult.tier).toBe("tier2"); // "Pay Now" is classified as Tier 2 (Consequential)
    expect(valResult.fingerprint).toBeDefined();
    expect(valResult.fingerprint?.tagName).toBe("button");
    expect(valResult.actionHash).toBeDefined();
  });

  it("S2: Authentication & 2FA Flow (Suppresses password & OTP, executes login)", async () => {
    const emailCanary = generateCanary("EMAIL", "e2e_2");
    const otpCanary = generateCanary("OTP", "e2e_2");

    const { tree: rawTree } = createAuthPage({
      email: emailCanary,
      otp: otpCanary,
    });

    const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(rawTree);
    expect(ledger["PASSWORD"]).toBe(1);
    expect(ledger["OTP"]).toBe(1);

    const envelope: Envelope = {
      requestId: crypto.randomUUID(),
      task: "Log in with OTP",
      snapshotVersion: 1,
      snapshot: sanitizedTree,
      availableSecrets: [],
      redactionLedger: ledger,
      timestamp: Date.now(),
    };

    const gateResult = await sendThroughGate(envelope, Array.from(rawValuesMap.keys()), {
      gatewayUrl: GATEWAY_URL,
      authToken,
    });

    if (!gateResult.allowed) {
      console.error("S2 Gate Blocked Reason:", gateResult.blockedReason);
    }
    expect(gateResult.allowed).toBe(true);
    expect(gateResult.response?.action.type).toBe("type");
    expect(gateResult.response?.action.targetId).toBe("otp-input");
  });

  it("S3: Customer Support KYC Flow (Redacts Aadhaar & PAN)", async () => {
    const aadhaarCanary = generateCanary("AADHAAR", "e2e_3");
    const panCanary = generateCanary("PAN", "e2e_3");
    const phoneCanary = generateCanary("PHONE", "e2e_3");

    const { tree: rawTree } = createSupportPage({
      aadhaar: aadhaarCanary,
      pan: panCanary,
      phone: phoneCanary,
    });

    const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(rawTree);
    expect(ledger["AADHAAR"]).toBe(1);
    expect(ledger["PAN"]).toBe(1);
    expect(ledger["PHONE"]).toBe(1);

    const envelope: Envelope = {
      requestId: crypto.randomUUID(),
      task: "Summarize support ticket",
      snapshotVersion: 1,
      snapshot: sanitizedTree,
      availableSecrets: [],
      redactionLedger: ledger,
      timestamp: Date.now(),
    };

    const gateResult = await sendThroughGate(envelope, Array.from(rawValuesMap.keys()), {
      gatewayUrl: GATEWAY_URL,
      authToken,
    });

    if (!gateResult.allowed) {
      console.error("S2 Gate Blocked Reason:", gateResult.blockedReason);
    }
    expect(gateResult.allowed).toBe(true);
    expect(gateResult.response?.action.type).toBe("click");
    expect(gateResult.response?.action.targetId).toBe("resolve-btn");
  });

  it("S4: Video Conferencing Flow (Default-Deny video tiles & masks host email)", async () => {
    const emailCanary = generateCanary("EMAIL", "e2e_4");
    const { tree: rawTree } = createVideoConferencingPage({
      participantEmail: emailCanary,
    });

    // 1. Visual Path Default-Deny Assertion
    const denyRegions = identifyDefaultDenyRegions([
      {
        id: "video-feed-1",
        tag: "video",
        box: { x: 0, y: 0, width: 640, height: 480 },
      },
    ]);
    const fillResult = applySolidFillRedaction({ width: 1280, height: 720 }, denyRegions);
    expect(fillResult.redactedRegionCount).toBe(1);
    expect(fillResult.fillColor).toBe("#000000");

    // 2. Text Path Sanitization
    const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(rawTree);
    expect(ledger["EMAIL"]).toBe(1);

    const envelope: Envelope = {
      requestId: crypto.randomUUID(),
      task: "Mute the mic and open chat",
      snapshotVersion: 1,
      snapshot: sanitizedTree,
      availableSecrets: [],
      redactionLedger: ledger,
      timestamp: Date.now(),
    };

    const gateResult = await sendThroughGate(envelope, Array.from(rawValuesMap.keys()), {
      gatewayUrl: GATEWAY_URL,
      authToken,
    });

    expect(gateResult.allowed).toBe(true);
    expect(gateResult.response?.action.type).toBe("click");
    expect(gateResult.response?.action.targetId).toBe("mute-btn");
  });

  it("S5: Developer Settings Flow (Redacts Production API Key)", async () => {
    const apiKeyCanary = generateCanary("API_KEY", "e2e_5");
    const { tree: rawTree } = createDeveloperSettingsPage({ apiKey: apiKeyCanary });

    const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(rawTree);
    expect(ledger["API_KEY"]).toBe(1);

    const envelope: Envelope = {
      requestId: crypto.randomUUID(),
      task: "Configure webhook settings",
      snapshotVersion: 1,
      snapshot: sanitizedTree,
      availableSecrets: [],
      redactionLedger: ledger,
      timestamp: Date.now(),
    };

    const gateResult = await sendThroughGate(envelope, Array.from(rawValuesMap.keys()), {
      gatewayUrl: GATEWAY_URL,
      authToken,
    });

    if (!gateResult.allowed) {
      console.error("S2 Gate Blocked Reason:", gateResult.blockedReason);
    }
    expect(gateResult.allowed).toBe(true);
    expect(gateResult.response?.action.type).toBe("click");
    expect(gateResult.response?.action.targetId).toBe("save-btn");
  });

  it("Red-Team Switch: Deliberate canary leak is BLOCKED at Egress Gate", async () => {
    const cardCanary = generateCanary("CARD", "leak_test");
    const { tree: rawTree } = createCheckoutPage({
      card: cardCanary,
      email: generateCanary("EMAIL", "leak_test"),
      phone: generateCanary("PHONE", "leak_test"),
    });

    const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(rawTree);

    const envelope: Envelope = {
      requestId: crypto.randomUUID(),
      task: "Test Leak",
      snapshotVersion: 1,
      snapshot: sanitizedTree,
      availableSecrets: [],
      redactionLedger: ledger,
      timestamp: Date.now(),
    };

    // Activate red-team simulation switch
    const gateResult = await sendThroughGate(
      envelope,
      Array.from(rawValuesMap.keys()),
      {
        gatewayUrl: GATEWAY_URL,
        authToken,
        redTeamSimulateCanary: true,
      }
    );

    // Egress gate MUST intercept and block transmission
    expect(gateResult.allowed).toBe(false);
    expect(gateResult.blockedReason).toContain("GATE_TRIPWIRE_TRIGGERED");
  });

  it("Adversarial Defense: Prompt injection in untrusted DOM does not create unauthorized action", async () => {
    const { tree: rawTree } = createAdversarialPage();
    const { sanitizedTree } = sanitizeDOMTree(rawTree);

    // Test prohibited action: navigate to restricted scheme
    const maliciousAction: Action = {
      type: "navigate",
      url: "file:///etc/passwd",
    };

    const valResult = await validateAction(
      maliciousAction,
      sanitizedTree,
      1,
      "http://example.com",
      1
    );

    expect(valResult.valid).toBe(false);
    expect(valResult.tier).toBe("tier3");
    expect(valResult.errorReason).toContain("FORBIDDEN_URL_SCHEME");
  });

  it("Gateway Defense-in-Depth: Direct unredacted POST to gateway returns 422 SENSITIVE_DETECTED", async () => {
    const rawEnvelope = {
      requestId: crypto.randomUUID(),
      task: "Process card 4111-1111-1111-1111",
      snapshotVersion: 1,
      snapshot: {
        id: "root",
        tag: "div",
        attributes: {},
        children: [],
        isInteractive: false,
      },
      availableSecrets: [],
      redactionLedger: {},
      timestamp: Date.now(),
    };

    const res = await fetch(`${GATEWAY_URL}/v1/agent/step`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(rawEnvelope),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("SENSITIVE_DETECTED");
    // Ensure the response does not leak the raw card number in message
    expect(body.message).not.toContain("4111-1111-1111-1111");
  });
});
