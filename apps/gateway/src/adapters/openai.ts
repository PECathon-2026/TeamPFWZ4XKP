import { Envelope, Action, ActionSchema } from "@privacylens/protocol";
import { Provider, ProviderResult } from "./types.js";

export class OpenAICompatibleProvider implements Provider {
  name = "openai-compatible";
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    apiKey = process.env.PROVIDER_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl = process.env.BASE_URL || "https://api.openai.com/v1",
    model = process.env.MODEL || "gpt-4o-mini"
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
      throw new Error("Missing PROVIDER_API_KEY or OPENAI_API_KEY on gateway");
    }

    const nonce = crypto.randomUUID().slice(0, 8);
    const userContent = `
Task: ${input.envelope.task}
Snapshot Version: ${input.envelope.snapshotVersion}
<page nonce="${nonce}">
${JSON.stringify(input.envelope.snapshot, null, 2)}
</page>

Respond with ONLY a raw JSON object matching the Action schema.
Schema:
{
  "type": "click" | "type" | "select" | "scroll" | "navigate" | "wait" | "ask_user" | "done" | "fail",
  "targetId": "string (optional)",
  "value": "string (optional)",
  "secretRef": "string (optional)",
  "reason": "string (optional)"
}
`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: userContent },
        ],
      }),
      signal: input.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI Provider Error (${res.status}): ${err.substring(0, 150)}`);
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || "";

    let rawAction: unknown;
    try {
      rawAction = JSON.parse(rawContent.trim());
    } catch {
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
          rawAction = JSON.parse(objMatch[0].trim());
        } else {
          throw new Error(`Failed to parse action JSON: ${rawContent.substring(0, 100)}`);
        }
      }
    }

    const action = ActionSchema.parse(rawAction);

    return {
      action,
      note: action.reason || `Action decided by ${this.model}`,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 100,
        outputTokens: data.usage?.completion_tokens || 20,
      },
    };
  }
}
