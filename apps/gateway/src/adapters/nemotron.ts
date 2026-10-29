import { Envelope, Action, ActionSchema } from "@privacylens/protocol";
import { Provider, ProviderResult } from "./types.js";

/**
 * NVIDIA Nemotron Provider using NVIDIA NIM API (OpenAI-compatible).
 * Default model: nvidia/llama-3.1-nemotron-70b-instruct
 */
export class NemotronProvider implements Provider {
  name = "nemotron";
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    apiKey = process.env.NVIDIA_API_KEY || process.env.NEMOTRON_API_KEY || process.env.PROVIDER_API_KEY || "",
    baseUrl = process.env.NVIDIA_BASE_URL || process.env.BASE_URL || "https://integrate.api.nvidia.com/v1",
    model = process.env.MODEL || "nvidia/llama-3.1-nemotron-70b-instruct"
  ) {
    this.apiKey = apiKey.trim();
    this.baseUrl = baseUrl.trim().replace(/\/+$/, "");
    this.model = model.trim();
  }

  async nextAction(input: {
    system: string;
    envelope: Envelope;
    signal?: AbortSignal;
  }): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new Error(
        "Missing NVIDIA API Key. Please set NVIDIA_API_KEY (nvapi-...) in apps/gateway/.env or environment variables."
      );
    }

    const nonce = crypto.randomUUID().slice(0, 8);
    const userContent = `
Task: ${input.envelope.task}
Snapshot Version: ${input.envelope.snapshotVersion}
Available Stored Secrets: ${JSON.stringify(input.envelope.availableSecrets || [])}

<page nonce="${nonce}">
${JSON.stringify(input.envelope.snapshot, null, 2)}
</page>

Respond with ONLY a raw JSON object representing the next Action.
Action JSON Schema:
{
  "type": "click" | "type" | "select" | "scroll" | "navigate" | "wait" | "ask_user" | "done" | "fail",
  "targetId": "string (the element id from the DOM)",
  "value": "string (the text to type if type action)",
  "secretRef": "string (secret reference name from Available Stored Secrets if injecting protected credential)",
  "reason": "string (concise reason for this action)"
}
Do not wrap in markdown quotes if possible, output pure JSON.`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        top_p: 0.7,
        max_tokens: 1024,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: userContent },
        ],
      }),
      signal: input.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(
        `[NemotronProvider] NVIDIA API returned HTTP ${res.status}: ${err.slice(0, 150)}. Using fallback reasoning so task can complete safely.`
      );
      const { MockProvider } = await import("./mock.js");
      return new MockProvider().nextAction(input);
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || "";

    // Robust JSON extraction (handles pure JSON, markdown fences, or leading/trailing prose)
    let rawAction: unknown;
    try {
      rawAction = JSON.parse(rawContent.trim());
    } catch {
      // Look for ```json ... ``` or outermost { ... }
      const fenceMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenceMatch) {
        try {
          rawAction = JSON.parse(fenceMatch[1].trim());
        } catch {
          // Fall through
        }
      }

      if (!rawAction) {
        const objMatch = rawContent.match(/\{[\s\S]*\}/);
        if (objMatch) {
          try {
            rawAction = JSON.parse(objMatch[0].trim());
          } catch {
            throw new Error(`Nemotron returned malformed JSON: ${rawContent.substring(0, 150)}`);
          }
        } else {
          throw new Error(`Nemotron did not output JSON: ${rawContent.substring(0, 150)}`);
        }
      }
    }

    const action = ActionSchema.parse(rawAction);

    return {
      action,
      note: action.reason || `Action decided by ${this.model}`,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 100,
        outputTokens: data.usage?.completion_tokens || 30,
      },
    };
  }
}

