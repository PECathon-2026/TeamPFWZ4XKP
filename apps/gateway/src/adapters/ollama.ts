import { Envelope, Action, ActionSchema } from "@privacylens/protocol";
import { Provider, ProviderResult } from "./types.js";

export class OllamaProvider implements Provider {
  name = "ollama";
  private endpoint: string;
  private model: string;

  constructor(endpoint = "http://127.0.0.1:11434", model = "llama3.2") {
    this.endpoint = endpoint;
    this.model = process.env.MODEL || model;
  }

  async nextAction(input: {
    system: string;
    envelope: Envelope;
    signal?: AbortSignal;
  }): Promise<ProviderResult> {
    const prompt = `
Task: ${input.envelope.task}
Snapshot Version: ${input.envelope.snapshotVersion}
DOM Representation:
${JSON.stringify(input.envelope.snapshot, null, 2)}

Respond ONLY with a JSON object conforming to:
{
  "type": "click" | "type" | "select" | "scroll" | "navigate" | "wait" | "ask_user" | "done" | "fail",
  "targetId": "string (optional)",
  "value": "string (optional)",
  "reason": "string (optional)"
}
`;

    const res = await fetch(`${this.endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        system: input.system,
        prompt,
        format: "json",
        stream: false,
        options: { temperature: 0 },
      }),
      signal: input.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP Error: ${res.statusText}`);
    }

    const data = await res.json();
    const parsedAction = JSON.parse(data.response);
    const action = ActionSchema.parse(parsedAction);

    return {
      action,
      note: action.reason || "Local model action",
      usage: {
        inputTokens: data.prompt_eval_count || 100,
        outputTokens: data.eval_count || 30,
      },
    };
  }
}

