import { describe, it, expect } from "vitest";
import { DOMNode } from "@privacylens/protocol";
import {
  UserRule,
  applyUserRegexRules,
  sanitizeDOMTree,
} from "../src/index.js";

describe("User-Defined Privacy Rules Engine (FR-D7)", () => {
  it("should match custom user regex rule and generate explainable findings", () => {
    const rules: UserRule[] = [
      {
        id: "emp-badge",
        name: "Internal Employee Badge",
        type: "regex",
        pattern: "EMP-\\d{5}",
        category: "CUSTOM",
        description: "Redact company employee badge numbers",
        enabled: true,
      },
    ];

    const text = "Assigned to engineer with badge EMP-48201 today.";
    const findings = applyUserRegexRules(text, rules);

    expect(findings.length).toBe(1);
    expect(findings[0].matchedText).toBe("EMP-48201");
    expect(findings[0].ruleId).toBe("user.rule.emp-badge");
    expect(findings[0].confidence).toBe(1.0);
  });

  it("should respect domain filtering on custom rules", () => {
    const rules: UserRule[] = [
      {
        id: "domain-secret",
        name: "Staging Token",
        type: "regex",
        pattern: "STG-[A-Z0-9]{8}",
        category: "CUSTOM",
        domainPattern: "staging\\.internal\\.corp",
        description: "Redact staging tokens only on internal domain",
        enabled: true,
      },
    ];

    const text = "Token is STG-9A8B7C6D";

    // Should NOT match on external domain
    expect(applyUserRegexRules(text, rules, "example.com").length).toBe(0);

    // SHOULD match on staging domain
    const match = applyUserRegexRules(text, rules, "staging.internal.corp");
    expect(match.length).toBe(1);
    expect(match[0].matchedText).toBe("STG-9A8B7C6D");
  });

  it("should redact DOM nodes matching user CSS selector rules", () => {
    const rules: UserRule[] = [
      {
        id: "private-class",
        name: "Confidential Section",
        type: "css_selector",
        pattern: ".private-data",
        category: "CUSTOM",
        description: "Redact anything marked with class private-data",
        enabled: true,
      },
    ];

    const root: DOMNode = {
      id: "root",
      tag: "div",
      isInteractive: false,
      attributes: {},
      children: [
        {
          id: "secret-block",
          tag: "p",
          text: "Executive quarterly bonus numbers",
          isInteractive: false,
          attributes: { class: "private-data text-red" },
          children: [],
        },
      ],
    };

    const { sanitizedTree, ledger } = sanitizeDOMTree(root, new Map(), {}, rules);
    expect(sanitizedTree.children?.[0].text).toBe("[REDACTED:CUSTOM#1]");
    expect(ledger["CUSTOM"]).toBe(1);
  });
});

