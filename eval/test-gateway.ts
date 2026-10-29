import { Envelope } from "@privacylens/protocol";

async function testGateway() {
  const GATEWAY = "http://127.0.0.1:8787";

  console.log("Checking Gateway Health...");
  try {
    const health = await fetch(`${GATEWAY}/healthz`).then((r) => r.json());
    console.log("✓ Health Check:", health);
  } catch (e) {
    console.log("Gateway is not currently running. Start it with: npm --workspace=@privacylens/gateway run dev");
    return;
  }

  // 1. Register Auth Token
  const auth = await fetch(`${GATEWAY}/v1/auth/register`, { method: "POST" }).then((r) => r.json());
  console.log("✓ Registered Install Token:", auth.accessToken);

  // 2. Test Step with Sanitized Envelope
  const cleanEnvelope: Envelope = {
    requestId: "11111111-1111-4111-8111-111111111111",
    task: "Buy the cheapest item",
    snapshotVersion: 1,
    snapshot: {
      id: "root",
      tag: "div",
      attributes: {},
      children: [],
      isInteractive: false,
    },
    availableSecrets: [],
    redactionLedger: { CARD: 1 },
    timestamp: Date.now(),
  };

  const stepRes = await fetch(`${GATEWAY}/v1/agent/step`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify(cleanEnvelope),
  });

  const stepData = await stepRes.json();
  console.log("✓ Sanitized Step Response (Status 200):", stepData.action);

  // 3. Test Tripwire Gate - Send raw unredacted card number
  const leakingEnvelope = {
    ...cleanEnvelope,
    task: "Buy with card 4111-1111-1111-1111",
  };

  const tripwireRes = await fetch(`${GATEWAY}/v1/agent/step`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify(leakingEnvelope),
  });

  const tripwireData = await tripwireRes.json();
  console.log(
    `✓ Second-Pass Tripwire Block (Status ${tripwireRes.status}):`,
    tripwireData.code,
    "-",
    tripwireData.message
  );
}

testGateway().catch(console.error);

