import { sanitizeDOMTree, tripwireScan } from "@privacylens/detector";
import { sendThroughGate } from "../apps/extension/src/egress/gate.js";
import { createCheckoutPage } from "./pages/s1-checkout.js";
import { generateCanary } from "./canaries/generator.js";
import { Envelope } from "@privacylens/protocol";

async function performAgentLeakageAudit() {
  console.log("================================================================");
  console.log(" 🛡️ PRIVACYLENS LIVE AGENT LEAKAGE & EGRESS GATE AUDIT");
  console.log("================================================================\n");

  const GATEWAY_URL = "http://127.0.0.1:8787";
  const AUTH_TOKEN = "dev_privacylens_token_001";

  // 1. Plant Sensitive Canaries in DOM
  const cardCanary = generateCanary("CARD", "audit_01");
  const emailCanary = generateCanary("EMAIL", "audit_01");
  const phoneCanary = generateCanary("PHONE", "audit_01");
  const panCanary = generateCanary("PAN", "audit_01");
  const passwordSecret = "UltraSecretPasswd2026!";

  const sensitiveCanaryList = [
    { label: "Payment Card (Luhn)", value: cardCanary.value },
    { label: "Customer Email", value: emailCanary.value },
    { label: "Phone Number", value: phoneCanary.value },
    { label: "PAN National ID", value: panCanary.value },
    { label: "Account Password", value: passwordSecret },
  ];

  console.log("[Phase 1] Planting Raw Sensitive Canaries into Web Page DOM:");
  sensitiveCanaryList.forEach((s) => {
    console.log(`  - Planted ${s.label.padEnd(25)}: "${s.value}"`);
  });

  // Construct raw DOM with planted canaries
  const { tree: rawTree } = createCheckoutPage({
    card: cardCanary,
    email: emailCanary,
    phone: phoneCanary,
  });

  // Add password and PAN inputs
  rawTree.children.push(
    {
      id: "pan-field",
      tag: "input",
      attributes: { type: "text", name: "pan", value: panCanary.value },
      isInteractive: true,
      children: [],
    },
    {
      id: "pwd-field",
      tag: "input",
      attributes: { type: "password", name: "password", value: passwordSecret },
      isInteractive: true,
      children: [],
    }
  );

  // 2. Perform Local Client-Side Sanitization
  console.log("\n[Phase 2] Running Local Layered Sanitizer (Zone 2 Trusted Core)...");
  const { sanitizedTree, ledger, rawValuesMap } = sanitizeDOMTree(rawTree);
  console.log("  ✓ Redaction Ledger Counts:", JSON.stringify(ledger));
  console.log(`  ✓ Raw Values Map entries tracked: ${rawValuesMap.size}`);

  // 3. Assemble Outbound Envelope for Egress Gate
  const candidateEnvelope: Envelope = {
    requestId: crypto.randomUUID(),
    task: "Select cheapest item and submit payment",
    snapshotVersion: 1,
    snapshot: sanitizedTree,
    availableSecrets: [
      { name: "card.number", type: "CARD" },
    ],
    redactionLedger: ledger,
    timestamp: Date.now(),
  };

  const rawSecretsList = [
    ...Array.from(rawValuesMap.keys()),
    passwordSecret,
  ];

  // 4. Inspect Outbound Wire Payload
  console.log("\n[Phase 3] Inspecting Candidate Wire Envelope at Single Egress Gate...");
  const serializedWirePayload = JSON.stringify(candidateEnvelope);
  console.log(`  - Total Wire Bytes: ${serializedWirePayload.length} bytes`);

  let leakCount = 0;
  console.log("\n[Phase 4] Scanning Wire Payload for Unredacted Canaries:");
  for (const canary of sensitiveCanaryList) {
    const rawDigits = canary.value.replace(/[\s-]/g, "");
    const foundDirect = serializedWirePayload.includes(canary.value);
    const foundDigits = rawDigits.length > 5 && serializedWirePayload.includes(rawDigits);

    if (foundDirect || foundDigits) {
      console.error(`  ❌ LEAK DETECTED: ${canary.label} ("${canary.value}") found in outbound wire payload!`);
      leakCount++;
    } else {
      console.log(`  ✅ SAFE: ${canary.label.padEnd(25)} -> NOT FOUND (0 occurrences in outbound wire)`);
    }
  }

  // Verify Typed Placeholders are Present Instead
  const expectedPlaceholders = [
    "[REDACTED:CARD#1]",
    "[REDACTED:EMAIL#1]",
    "[REDACTED:PHONE#1]",
    "[REDACTED:PAN#1]",
    "[REDACTED:PASSWORD#1]",
  ];

  console.log("\n[Phase 5] Verifying Irreversible Typed Placeholders in Wire Payload:");
  for (const placeholder of expectedPlaceholders) {
    const present = serializedWirePayload.includes(placeholder);
    console.log(`  ${present ? "✅" : "⚠️"} Placeholder ${placeholder.padEnd(25)} -> ${present ? "CONFIRMED PRESENT" : "Not matched"}`);
  }

  // 5. Send Through Single Egress Gate to Live Gateway
  console.log("\n[Phase 6] Transmitting Through Single Egress Gate to Gateway Endpoint...");
  const gateResult = await sendThroughGate(candidateEnvelope, rawSecretsList, {
    gatewayUrl: GATEWAY_URL,
    authToken: AUTH_TOKEN,
  });

  console.log(`  - Gate Allowed: ${gateResult.allowed}`);
  console.log(`  - Gateway Response Action:`, gateResult.response?.action);

  // 6. Red-Team Adversarial Canary Injection Test
  console.log("\n[Phase 7] Red-Team Test: Deliberately Injecting Raw Canary at Egress Gate...");
  const maliciousGateResult = await sendThroughGate(candidateEnvelope, rawSecretsList, {
    gatewayUrl: GATEWAY_URL,
    authToken: AUTH_TOKEN,
    redTeamSimulateCanary: true, // Deliberately injects 4111-1111-1111-1111 into wire payload
  });

  console.log(`  - Deliberate Injection Gate Verdict: Allowed = ${maliciousGateResult.allowed}`);
  console.log(`  - Interception Reason: "${maliciousGateResult.blockedReason}"`);

  if (!maliciousGateResult.allowed && maliciousGateResult.blockedReason?.includes("GATE_TRIPWIRE_TRIGGERED")) {
    console.log("  ✅ Red-Team Defense Verified: Egress Gate intercepted canary and aborted wire transmission.");
  } else {
    console.error("  ❌ Red-Team Test Failed: Gate permitted leaked canary!");
    leakCount++;
  }

  console.log("\n================================================================");
  console.log(` LEAKAGE AUDIT VERDICT: ${leakCount === 0 ? "PASSED (0 LEAKS DETECTED) 🛡️" : "FAILED"}`);
  console.log("================================================================\n");

  return {
    leakCount,
    passed: leakCount === 0,
    wirePayloadSnippet: serializedWirePayload.substring(0, 400),
  };
}

performAgentLeakageAudit().catch((err) => {
  console.error("Audit error:", err);
  process.exit(1);
});
