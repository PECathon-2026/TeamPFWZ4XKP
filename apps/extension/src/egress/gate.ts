import { Envelope, EnvelopeSchema, StepResponse, StepResponseSchema } from "@privacylens/protocol";
import { tripwireScan } from "@privacylens/detector";

export interface GateResult {
  allowed: boolean;
  blockedReason?: string;
  response?: StepResponse;
}

export interface GateConfig {
  gatewayUrl: string;
  authToken: string;
  redTeamSimulateCanary?: boolean;
}

const ALLOWED_DESTINATIONS = ["http://127.0.0.1:8787", "http://127.0.0.1:11434"];

/**
 * The SINGLE egress chokepoint for the extension (FR-D1).
 * Every outbound byte must pass through this function before being transmitted.
 */
export async function sendThroughGate(
  candidateEnvelope: unknown,
  rawSensitiveStrings: string[],
  config: GateConfig
): Promise<GateResult> {
  // 1. Strict Schema Validation
  const schemaCheck = EnvelopeSchema.safeParse(candidateEnvelope);
  if (!schemaCheck.success) {
    return {
      allowed: false,
      blockedReason: "GATE_SCHEMA_INVALID: Envelope failed strict schema validation",
    };
  }

  const envelope = schemaCheck.data;

  // 2. Destination Allowlist
  const isAllowedHost = ALLOWED_DESTINATIONS.some((dest) =>
    config.gatewayUrl.startsWith(dest)
  );
  if (!isAllowedHost) {
    return {
      allowed: false,
      blockedReason: `GATE_DESTINATION_FORBIDDEN: Target ${config.gatewayUrl} not in allowlist`,
    };
  }

  // 3. Redaction Ledger Check
  let serialized = JSON.stringify(envelope);

  // Red-team simulation switch for auditing and live demonstration (FR-D8)
  if (config.redTeamSimulateCanary) {
    serialized = serialized.replace(
      "[REDACTED:CARD#1]",
      "4111-1111-1111-1111"
    );
  }

  for (const rawSecret of rawSensitiveStrings) {
    if (rawSecret && serialized.includes(rawSecret)) {
      return {
        allowed: false,
        blockedReason: "GATE_LEDGER_LEAK: Detected unredacted raw secret present in outbound payload",
      };
    }
  }

  // 4. Broad Tripwire Scan (FR-D1)
  const tripwire = tripwireScan(serialized);
  if (tripwire.hit) {
    return {
      allowed: false,
      blockedReason: `GATE_TRIPWIRE_TRIGGERED: High-recall tripwire detected ${tripwire.category}`,
    };
  }

  // 5. Transmit (Single network call point)
  try {
    const res = await fetch(`${config.gatewayUrl}/v1/agent/step`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.authToken}`,
      },
      body: serialized,
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        allowed: false,
        blockedReason: `GATEWAY_ERROR_${res.status}: ${errText.substring(0, 100)}`,
      };
    }

    const data = await res.json();
    const validatedResponse = StepResponseSchema.parse(data);

    return {
      allowed: true,
      response: validatedResponse,
    };
  } catch (err: unknown) {
    return {
      allowed: false,
      blockedReason: `NETWORK_FAILURE: ${err instanceof Error ? err.message : "Unknown fetch failure"}`,
    };
  }
}

