import { DetectionFinding, DetectionCategory } from "./types.js";
import { DOMNode } from "@privacylens/protocol";

export interface UserRule {
  id: string;
  name: string;
  type: "regex" | "css_selector";
  pattern: string;
  category: DetectionCategory | "CUSTOM";
  domainPattern?: string;
  description: string;
  enabled: boolean;
}

/**
 * Evaluates custom user regex rules against text (FR-D7).
 */
export function applyUserRegexRules(
  text: string,
  rules: UserRule[],
  currentDomain?: string
): DetectionFinding[] {
  const findings: DetectionFinding[] = [];

  for (const rule of rules) {
    if (!rule.enabled || rule.type !== "regex") continue;

    // Check domain constraint if specified
    if (rule.domainPattern && currentDomain) {
      const domainRegex = new RegExp(rule.domainPattern, "i");
      if (!domainRegex.test(currentDomain)) continue;
    }

    try {
      const regex = new RegExp(rule.pattern, "gi");
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const matched = match[0];
        findings.push({
          category: rule.category as DetectionCategory,
          source: "custom",
          ruleId: `user.rule.${rule.id}`,
          confidence: 1.0,
          start: match.index,
          end: match.index + matched.length,
          matchedText: matched,
        });
      }
    } catch (err) {
      console.warn(`Invalid user regex rule "${rule.name}":`, err);
    }
  }

  return findings;
}

/**
 * Checks if a DOM node matches any user-defined CSS selector rules (FR-D7).
 */
export function matchUserSelectorRule(
  node: DOMNode,
  rules: UserRule[],
  currentDomain?: string
): UserRule | undefined {
  const nodeTag = node.tag.toLowerCase();
  const nodeClass = (node.attributes?.class || "").toLowerCase();
  const nodeId = (node.attributes?.id || "").toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled || rule.type !== "css_selector") continue;

    if (rule.domainPattern && currentDomain) {
      const domainRegex = new RegExp(rule.domainPattern, "i");
      if (!domainRegex.test(currentDomain)) continue;
    }

    const sel = rule.pattern.toLowerCase().trim();

    // Match by class (e.g. ".confidential" or "confidential")
    if (sel.startsWith(".")) {
      const className = sel.slice(1);
      if (nodeClass.split(/\s+/).includes(className)) return rule;
    }
    // Match by ID (e.g. "#secret-notes")
    else if (sel.startsWith("#")) {
      const idName = sel.slice(1);
      if (nodeId === idName) return rule;
    }
    // Match by tag
    else if (sel === nodeTag) {
      return rule;
    }
  }

  return undefined;
}

