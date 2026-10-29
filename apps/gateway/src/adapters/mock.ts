import { Envelope, Action } from "@privacylens/protocol";
import { Provider, ProviderResult } from "./types.js";

export class MockProvider implements Provider {
  name = "mock";

  async nextAction(input: {
    system: string;
    envelope: Envelope;
  }): Promise<ProviderResult> {
    const task = input.envelope.task.toLowerCase();
    const ver = input.envelope.snapshotVersion;

    let action: Action = { type: "done", reason: "Task complete" };

    // Scenario S1: E-Commerce Checkout
    if (task.includes("cheap") || task.includes("checkout") || task.includes("buy")) {
      if (ver === 1) {
        action = {
          type: "click",
          targetId: "item-2",
          reason: "Select cheapest item ($10 socks)",
        };
      } else if (ver === 2) {
        action = {
          type: "click",
          targetId: "pay-btn",
          reason: "Submit payment for selected item",
        };
      } else {
        action = { type: "done", reason: "Checkout flow complete" };
      }
    }
    // Scenario S2: Authentication & 2FA
    else if (
      task.includes("login") ||
      task.includes("log in") ||
      task.includes("auth") ||
      task.includes("verify") ||
      task.includes("otp")
    ) {
      if (ver === 1) {
        action = {
          type: "type",
          targetId: "otp-input",
          value: "829104",
          reason: "Enter verification OTP",
        };
      } else if (ver === 2) {
        action = {
          type: "click",
          targetId: "submit-btn",
          reason: "Submit login form",
        };
      } else {
        action = { type: "done", reason: "Authentication complete" };
      }
    }
    // Scenario S3: Customer Support KYC
    else if (task.includes("ticket") || task.includes("support")) {
      action = {
        type: "click",
        targetId: "resolve-btn",
        reason: "Summarize and escalate ticket",
      };
    }
    // Scenario S4: Video Conferencing
    else if (task.includes("mute") || task.includes("chat") || task.includes("call") || task.includes("video")) {
      if (ver === 1) {
        action = {
          type: "click",
          targetId: "mute-btn",
          reason: "Mute microphone",
        };
      } else if (ver === 2) {
        action = {
          type: "click",
          targetId: "chat-btn",
          reason: "Open side chat panel",
        };
      } else {
        action = { type: "done", reason: "Meeting controls configured" };
      }
    }
    // Scenario S5: Developer Settings
    else if (task.includes("webhook") || task.includes("settings")) {
      action = {
        type: "click",
        targetId: "save-btn",
        reason: "Save webhook configuration",
      };
    }

    return {
      action,
      note: action.reason,
      usage: { inputTokens: 110, outputTokens: 20 },
    };
  }
}

