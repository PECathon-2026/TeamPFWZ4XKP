import { Envelope, Action, ActionSchema } from "@privacylens/protocol";
import { Provider, ProviderResult } from "./types.js";

export class AnthropicProvider implements Provider {
  name = "anthropic";
  private apiKey: string;
  private model: string;

  constructor(
    apiKey = process.env.PROVIDER_API_KEY || process.env.ANTHROPIC_API_KEY || "",
    model = process.env.MODEL || "claude-3-5-haiku-20241022"
  ) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async nextAction(input: {
    system: string;
    envelope: Envelope;
    signal?: AbortSignal;
  }): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new Error("Missing PROVIDER_API_KEY or ANTHROPIC_API_KEY on gateway");
    }

    const nonce = crypto.randomUUID().slice(0, 8);
    const userContent = `
Task: ${input.envelope.task}
Snapshot Version: ${input.envelope.snapshotVersion}
<page nonce="${nonce}">
${JSON.stringify(input.envelope.snapshot, null, 2)}
</page>
`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: input.system,
        messages: [{ role: "user", content: userContent }],
        tools: [
          {
            name: "next_action",
            description: "Propose next atomic browser automation action",
            input_schema: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "click",
                    "type",
                    "select",
                    "scroll",
                    "navigate",
                    "wait",
                    "ask_user",
                    "done",
                    "fail",
                  ],
                },
                targetId: { type: "string" },
                value: { type: "string" },
                reason: { type: "string" },
              },
              required: ["type"],
            },
          },
        ],
        tool_choice: { type: "auto" },
      }),
      signal: input.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API Error (${res.status}): ${err.substring(0, 150)}`);
    }

    const data = await res.json();
    let rawAction: unknown;

    // Check for tool_use block
    const toolBlock = data.content?.find((b: any) => b.type === "tool_use" && b.name === "next_action");
    if (toolBlock && toolBlock.input) {
      rawAction = toolBlock.input;
    } else {
      // Fallback: parse JSON from text block
      const textBlock = data.content?.find((b: any) => b.type === "text");
      if (textBlock && textBlock.text) {
        const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
        rawAction = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(textBlock.text);
      }
    }

    if (!rawAction) {
      throw new Error("No valid action returned by Anthropic model");
    }

    const action = ActionSchema.parse(rawAction);

    return {
      action,
      note: action.reason || "Action proposed by Claude",
      usage: {
        inputTokens: data.usage?.input_tokens || 100,
        outputTokens: data.usage?.output_tokens || 30,
      },
      rawForCapture: JSON.stringify(data),
    };
  }
}
