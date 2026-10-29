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
  provider?: string;
  model?: string;
  redTeamSimulateCanary?: boolean;
}

function isAllowedGatewayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Allow localhost HTTP or any HTTPS
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    )
      return true;
    return false;
  } catch {
    return false;
  }
}

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
  const isAllowedHost = isAllowedGatewayUrl(config.gatewayUrl);
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

  // 5. Auth token check (if using localhost dev, allow empty token if gateway permits; otherwise check)
  // If the user specified an auth token, send it. If empty and communicating locally, proceed.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.authToken && config.authToken.trim()) {
    headers["Authorization"] = `Bearer ${config.authToken.trim()}`;
  } else {
    // Provide dev fallback header for local development
    headers["Authorization"] = "Bearer local_dev_token";
  }

  if (config.provider) {
    headers["X-Provider"] = config.provider;
  }
  if (config.model) {
    headers["X-Model"] = config.model;
  }

  // 6. Transmit (Single network call point)
  try {
    const res = await fetch(`${config.gatewayUrl}/v1/agent/step`, {
      method: "POST",
      headers,
      body: serialized,
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        allowed: false,
        blockedReason: `GATEWAY_ERROR_${res.status}: ${errText.substring(0, 150)}`,
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
