import { Envelope, Action } from "@privacylens/protocol";

export function getMockAction(envelope: Envelope): Action {
  const task = envelope.task.toLowerCase();

  if (task.includes("cheap") || task.includes("checkout") || task.includes("buy") || task.includes("pay")) {
    if (envelope.snapshotVersion <= 2) {
      return {
        type: "click",
        targetId: "pay-btn",
        reason: "Submit payment for selected item ($9.99)",
      };
    }
    return { type: "done", reason: "Checkout flow complete" };
  }

  if (
    task.includes("login") ||
    task.includes("log in") ||
    task.includes("auth") ||
    task.includes("verify") ||
    task.includes("otp")
  ) {
    if (envelope.snapshotVersion === 1) {
      return {
        type: "type",
        targetId: "otp-input",
        value: "829104",
        reason: "Enter verification OTP",
      };
    }
    if (envelope.snapshotVersion === 2) {
      return {
        type: "click",
        targetId: "submit-btn",
        reason: "Submit login form",
      };
    }
    return { type: "done", reason: "Authentication complete" };
  }

  if (task.includes("ticket") || task.includes("support")) {
    return {
      type: "click",
      targetId: "resolve-btn",
      reason: "Summarize and escalate ticket",
    };
  }

  if (task.includes("webhook") || task.includes("settings")) {
    return {
      type: "click",
      targetId: "save-btn",
      reason: "Save webhook configuration",
    };
  }

  return { type: "done", reason: "Task complete" };
}

