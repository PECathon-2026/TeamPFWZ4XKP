import { Envelope, Action } from "@privacylens/protocol";

export interface ProviderResult {
  action: Action;
  note?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface Provider {
  name: string;
  nextAction(input: {
    system: string;
    envelope: Envelope;
    signal?: AbortSignal;
  }): Promise<ProviderResult>;
}

