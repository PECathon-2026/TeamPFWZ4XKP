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

    // Collect all DOM nodes from snapshot for intelligent targeting
    const allNodes: any[] = [];
    const collect = (node: any) => {
      if (!node) return;
      allNodes.push(node);
      if (node.children) {
        for (const child of node.children) collect(child);
      }
    };
    if (input.envelope.snapshot) {
      collect(input.envelope.snapshot);
    }

    const hasNode = (id: string) => allNodes.some((n) => n.id === id);
    const findButton = (keyword: string) =>
      allNodes.find(
        (n) =>
          (n.tag === "button" || n.isInteractive) &&
          (n.id?.toLowerCase().includes(keyword.toLowerCase()) ||
            n.text?.toLowerCase().includes(keyword.toLowerCase()) ||
            n.attributes?.name?.toLowerCase().includes(keyword.toLowerCase()) ||
            n.attributes?.value?.toLowerCase().includes(keyword.toLowerCase()) ||
            n.attributes?.class?.toLowerCase().includes(keyword.toLowerCase()))
      );

    const findInput = (keywords: string[]) =>
      allNodes.find((n) => {
        if (n.tag !== "input" && n.tag !== "textarea") return false;
        const textToMatch = `${n.id || ""} ${n.name || ""} ${n.attributes?.name || ""} ${n.attributes?.placeholder || ""} ${n.attributes?.type || ""}`.toLowerCase();
        return keywords.some((k) => textToMatch.includes(k.toLowerCase()));
      });

    const isUnfilled = (node: any) => {
      if (!node) return false;
      const val = node.attributes?.value;
      return !val || val.trim() === "";
    };

    let action: Action = { type: "done", reason: "Task complete" };

    // 0. Direct Action matching ("click ...", "scroll ...", "type ...")
    if (task.startsWith("click ") || task.startsWith("press ")) {
      const targetQuery = task.replace(/^(click|press)\s+(on\s+)?(the\s+)?/i, "").trim();
      const matchedBtn = findButton(targetQuery) || allNodes.find((n) => n.id?.toLowerCase().includes(targetQuery.toLowerCase()));
      if (matchedBtn) {
        return {
          action: { type: "click", targetId: matchedBtn.id, reason: `Clicked ${matchedBtn.text || matchedBtn.id}` },
          usage: { inputTokens: 50, outputTokens: 10 },
        };
      }
    }

    if (task.startsWith("scroll")) {
      const dir = task.includes("up") ? "up" : "down";
      return {
        action: { type: "scroll", direction: dir, reason: `Scrolled ${dir}` },
        usage: { inputTokens: 50, outputTokens: 10 },
      };
    }

    // 1. Signup & Account Registration Workflow
    if (
      task.includes("sign up") ||
      task.includes("signup") ||
      task.includes("register") ||
      task.includes("create account") ||
      task.includes("new account")
    ) {
      const nameInput = findInput(["username", "name", "fullname", "user"]);
      const emailInput = findInput(["email", "mail"]);
      const passInput = findInput(["password", "pass"]);
      const confirmPassInput = findInput(["confirm", "repeat"]);
      const termsCheckbox = allNodes.find((n) => n.tag === "input" && n.attributes?.type === "checkbox");
      const submitBtn =
        findButton("sign up") ||
        findButton("signup") ||
        findButton("register") ||
        findButton("create") ||
        findButton("submit");

      if (nameInput && isUnfilled(nameInput)) {
        action = {
          type: "type",
          targetId: nameInput.id,
          value: "Alex Customer",
          reason: "Enter full registration name",
        };
      } else if (emailInput && isUnfilled(emailInput)) {
        action = {
          type: "type",
          targetId: emailInput.id,
          value: "alex.customer@example.com",
          reason: "Enter registration email address",
        };
      } else if (passInput && isUnfilled(passInput)) {
        action = {
          type: "type",
          targetId: passInput.id,
          value: "SecureP@ssw0rd!2026",
          reason: "Enter secure registration password",
        };
      } else if (confirmPassInput && isUnfilled(confirmPassInput)) {
        action = {
          type: "type",
          targetId: confirmPassInput.id,
          value: "SecureP@ssw0rd!2026",
          reason: "Confirm registration password",
        };
      } else if (termsCheckbox && !termsCheckbox.attributes?.checked) {
        action = {
          type: "click",
          targetId: termsCheckbox.id,
          reason: "Accept terms of service and conditions",
        };
      } else if (submitBtn) {
        action = {
          type: "click",
          targetId: submitBtn.id,
          reason: "Submit account registration",
        };
      } else {
        action = { type: "done", reason: "Account registration completed" };
      }
    }
    // 2. Search & Discovery Workflow
    else if (task.includes("search") || task.includes("find") || task.includes("lookup")) {
      const searchInput = findInput(["search", "query", "q", "find", "keyword"]);
      const searchBtn = findButton("search") || findButton("find") || findButton("go");
      if (searchInput && isUnfilled(searchInput)) {
        const query = task.replace(/^(search\s+for|find|search|lookup)\s+/i, "").trim() || "PrivacyLens";
        action = {
          type: "type",
          targetId: searchInput.id,
          value: query,
          reason: `Search for '${query}'`,
        };
      } else if (searchBtn) {
        action = { type: "click", targetId: searchBtn.id, reason: "Submit search query" };
      } else {
        action = { type: "done", reason: "Search completed" };
      }
    }

    // 1. KYC / Support Scenario (S3 & Demo Hub)
    if (
      task.includes("kyc") ||
      task.includes("verification") ||
      task.includes("ticket") ||
      task.includes("support")
    ) {
      if (ver === 1) {
        if (hasNode("resolve-btn")) {
          action = {
            type: "click",
            targetId: "resolve-btn",
            reason: "Summarize and escalate ticket with verified KYC credentials",
          };
        } else if (hasNode("pan")) {
          action = {
            type: "click",
            targetId: "pan",
            reason: "Focus and verify PAN document field",
          };
        } else {
          const btn = findButton("resolve") || findButton("submit") || findButton("verify") || findButton("pay");
          if (btn) {
            action = { type: "click", targetId: btn.id, reason: `Click ${btn.text || btn.id} to submit KYC` };
          } else {
            action = { type: "done", reason: "KYC credentials verified locally without leakage" };
          }
        }
      } else {
        action = { type: "done", reason: "KYC verification flow completed successfully" };
      }
    }
    // 2. E-Commerce Checkout (S1 & Demo Page)
    else if (
      task.includes("cheap") ||
      task.includes("checkout") ||
      task.includes("buy") ||
      task.includes("order")
    ) {
      if (ver === 1) {
        if (hasNode("item-2")) {
          action = {
            type: "click",
            targetId: "item-2",
            reason: "Select cheapest item ($10 socks)",
          };
        } else if (hasNode("pay-btn")) {
          action = {
            type: "click",
            targetId: "pay-btn",
            reason: "Proceed to payment for selected item",
          };
        } else {
          const btn = findButton("pay") || findButton("buy") || findButton("checkout");
          action = btn
            ? { type: "click", targetId: btn.id, reason: "Proceed to checkout" }
            : { type: "done", reason: "Checkout complete" };
        }
      } else if (ver === 2) {
        if (hasNode("pay-btn")) {
          action = {
            type: "click",
            targetId: "pay-btn",
            reason: "Submit payment for selected item",
          };
        } else {
          action = { type: "done", reason: "Payment complete" };
        }
      } else {
        action = { type: "done", reason: "Checkout flow complete" };
      }
    }
    // 3. Authentication & 2FA (S2)
    else if (
      task.includes("login") ||
      task.includes("log in") ||
      task.includes("auth") ||
      task.includes("verify") ||
      task.includes("otp")
    ) {
      if (ver === 1) {
        if (hasNode("otp-input")) {
          action = {
            type: "type",
            targetId: "otp-input",
            value: "829104",
            reason: "Enter verification OTP code",
          };
        } else if (hasNode("submit-btn")) {
          action = {
            type: "click",
            targetId: "submit-btn",
            reason: "Submit login credentials",
          };
        } else {
          action = { type: "done", reason: "Authentication complete" };
        }
      } else if (ver === 2) {
        if (hasNode("submit-btn")) {
          action = {
            type: "click",
            targetId: "submit-btn",
            reason: "Submit login form",
          };
        } else {
          action = { type: "done", reason: "Authentication complete" };
        }
      } else {
        action = { type: "done", reason: "Authentication complete" };
      }
    }
    // 4. Video Conferencing (S4)
    else if (
      task.includes("mute") ||
      task.includes("chat") ||
      task.includes("call") ||
      task.includes("video")
    ) {
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
    // 5. Developer Settings (S5)
    else if (task.includes("webhook") || task.includes("settings")) {
      action = {
        type: "click",
        targetId: "save-btn",
        reason: "Save webhook configuration",
      };
    }
    // 6. Generic Fallback: Click first relevant interactive element
    else {
      const btn = findButton("submit") || findButton("pay") || findButton("resolve") || findButton("btn");
      if (btn && ver === 1) {
        action = {
          type: "click",
          targetId: btn.id,
          reason: `Click ${btn.text || btn.id} to advance task`,
        };
      } else {
        action = { type: "done", reason: "Task actions completed on page" };
      }
    }

    return {
      action,
      note: action.reason,
      usage: { inputTokens: 110, outputTokens: 20 },
    };
  }
}

