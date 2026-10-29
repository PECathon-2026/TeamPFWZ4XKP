import { DOMNode } from "@privacylens/protocol";
import { sanitizeString } from "./engine.js";
import { detectStructural } from "./structural.js";
import { UserRule, matchUserSelectorRule } from "./custom-rules.js";

export interface DOMSanitizationResult {
  sanitizedTree: DOMNode;
  ledger: Record<string, number>;
  rawValuesMap: Map<string, string>;
}

/**
 * Recursively sanitizes a DOM tree using layered detectors (structural + pattern + user rules).
 */
export function sanitizeDOMTree(
  root: DOMNode,
  existingMap: Map<string, string> = new Map(),
  existingLedger: Record<string, number> = {},
  userRules: UserRule[] = [],
  currentDomain?: string
): DOMSanitizationResult {
  const ledger: Record<string, number> = { ...existingLedger };
  const rawValuesMap = existingMap;

  function sanitizeNode(node: DOMNode): DOMNode {
    const newAttributes: Record<string, string> = { ...(node.attributes || {}) };

    // 0. User-defined selector rules (FR-D7)
    const customRule = matchUserSelectorRule(node, userRules, currentDomain);
    if (customRule) {
      const cat = customRule.category;
      const count = (ledger[cat] || 0) + 1;
      ledger[cat] = count;
      const placeholder = `[REDACTED:${cat}#${count}]`;

      if (node.text) {
        rawValuesMap.set(node.text, placeholder);
      }
      if (newAttributes.value) {
        rawValuesMap.set(newAttributes.value, placeholder);
      }

      return {
        ...node,
        text: node.text ? placeholder : undefined,
        attributes: {
          ...newAttributes,
          value: newAttributes.value ? placeholder : newAttributes.value,
        },
        children: (node.children || []).map((c) => sanitizeNode(c)),
      };
    }

    // 1. Structural check
    const structural = detectStructural({
      type: newAttributes.type,
      name: newAttributes.name,
      id: node.id,
      role: node.role,
      ariaLabel: newAttributes["aria-label"],
      placeholder: newAttributes.placeholder,
      autocomplete: newAttributes.autocomplete,
      value: newAttributes.value,
    });

    if (structural.isSensitive && structural.category) {
      const rawVal = newAttributes.value || "[STRUCTURAL_HIDDEN]";
      let placeholder = rawValuesMap.get(rawVal);
      if (!placeholder) {
        const count = (ledger[structural.category] || 0) + 1;
        ledger[structural.category] = count;
        placeholder = `[REDACTED:${structural.category}#${count}]`;
        if (newAttributes.value) {
          rawValuesMap.set(rawVal, placeholder);
        }
      }
      newAttributes.value = placeholder;
    }

    // 2. Pattern sanitization on text
    let sanitizedText = node.text;
    if (sanitizedText) {
      const res = sanitizeString(sanitizedText, rawValuesMap, ledger, userRules, currentDomain);
      sanitizedText = res.sanitizedText;
      Object.assign(ledger, res.ledger);
    }

    // 3. Pattern sanitization on sensitive-bearing attributes
    for (const attrKey of ["placeholder", "value", "title", "alt", "aria-label"]) {
      if (newAttributes[attrKey]) {
        const res = sanitizeString(newAttributes[attrKey], rawValuesMap, ledger, userRules, currentDomain);
        newAttributes[attrKey] = res.sanitizedText;
        Object.assign(ledger, res.ledger);
      }
    }

    // 4. Recurse children
    const sanitizedChildren = (node.children || []).map((child) => sanitizeNode(child));

    return {
      ...node,
      text: sanitizedText,
      attributes: newAttributes,
      children: sanitizedChildren,
    };
  }

  const sanitizedTree = sanitizeNode(root);

  return {
    sanitizedTree,
    ledger,
    rawValuesMap,
  };
}
