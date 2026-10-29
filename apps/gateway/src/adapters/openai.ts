import { Envelope, Action, ActionSchema } from "@privacylens/protocol";
import { Provider, ProviderResult } from "./types.js";

export class OpenAICompatibleProvider implements Provider {
  name = "openai-compatible";
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    apiKey = process.env.PROVIDER_API_KEY || "",
    baseUrl = process.env.BASE_URL || "https://api.openai.com/v1",
    model = process.env.MODEL || "gpt-4o-mini"
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async nextAction(input: {
    system: string;
    envelope: Envelope;
    signal?: AbortSignal;
  }): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new Error("Missing PROVIDER_API_KEY on gateway");
    }

    const nonce = crypto.randomUUID().slice(0, 8);
    const userContent = `
Task: ${input.envelope.task}
Snapshot Version: ${input.envelope.snapshotVersion}
<page nonce="${nonce}">
${JSON.stringify(input.envelope.snapshot, null, 2)}
</page>
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
        response_format: { type: "json_object" },
      }),
      signal: input.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI Provider Error (${res.status}): ${err.substring(0, 100)}`);
    }

    const data = await res.json();
    const rawAction = JSON.parse(data.choices[0].message.content);
    const action = ActionSchema.parse(rawAction);

    return {
      action,
      note: action.reason,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 100,
        outputTokens: data.usage?.completion_tokens || 20,
      },
    };
  }
}

