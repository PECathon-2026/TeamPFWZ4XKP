import { DetectionFinding, SanitizationResult, DetectionCategory } from "./types.js";
import { normalizeText } from "./normalizers.js";
import { detectCardNumbers } from "./patterns/card.js";
import { detectAadhaar } from "./patterns/aadhaar.js";
import { detectPAN } from "./patterns/pan.js";
import { detectContactInfo } from "./patterns/contact.js";
import { detectSecrets } from "./patterns/secrets.js";
import { detectOTP } from "./patterns/otp.js";
import { UserRule, applyUserRegexRules } from "./custom-rules.js";

/**
 * Runs all pattern detectors against input text and merges findings (FR-A6: Union Merge).
 */
export function detectAll(
  text: string,
  userRules: UserRule[] = [],
  currentDomain?: string
): DetectionFinding[] {
  if (!text) return [];

  const normalized = normalizeText(text);

  const rawFindings: DetectionFinding[] = [
    ...detectCardNumbers(normalized),
    ...detectAadhaar(normalized),
    ...detectPAN(normalized),
    ...detectContactInfo(normalized),
    ...detectSecrets(normalized),
    ...detectOTP(normalized),
    ...applyUserRegexRules(normalized, userRules, currentDomain),
  ];

  if (rawFindings.length === 0) return [];

  // Sort by start position ascending, then length descending
  rawFindings.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });

  // Resolve overlaps (Union policy)
  const merged: DetectionFinding[] = [];
  let current = rawFindings[0];

  for (let i = 1; i < rawFindings.length; i++) {
    const next = rawFindings[i];

    if (next.start < current.end) {
      // Overlapping findings: keep whichever has higher confidence or broader span
      if (next.end > current.end) {
        current = {
          ...current,
          end: next.end,
          matchedText: normalized.substring(current.start, next.end),
          confidence: Math.max(current.confidence, next.confidence),
        };
      }
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  return merged;
}

/**
 * Sanitizes input text, replacing sensitive values with typed placeholders [REDACTED:CATEGORY#n] (FR-B1).
 */
export function sanitizeString(
  text: string,
  existingMap: Map<string, string> = new Map(),
  existingLedger: Record<string, number> = {},
  userRules: UserRule[] = [],
  currentDomain?: string
): SanitizationResult {
  if (!text) {
    return {
      sanitizedText: "",
      findings: [],
      ledger: { ...existingLedger },
      rawValuesMap: existingMap,
    };
  }

  const findings = detectAll(text, userRules, currentDomain);
  if (findings.length === 0) {
    return {
      sanitizedText: text,
      findings: [],
      ledger: { ...existingLedger },
      rawValuesMap: existingMap,
    };
  }

  const ledger: Record<string, number> = { ...existingLedger };
  const rawValuesMap = existingMap;

  // Build replacement from right to left to preserve string offsets
  let result = text;
  const reversedFindings = [...findings].sort((a, b) => b.start - a.start);

  for (const finding of reversedFindings) {
    const rawVal = finding.matchedText;
    let placeholder = rawValuesMap.get(rawVal);

    if (!placeholder) {
      const catCount = (ledger[finding.category] || 0) + 1;
      ledger[finding.category] = catCount;
      placeholder = `[REDACTED:${finding.category}#${catCount}]`;
      rawValuesMap.set(rawVal, placeholder);
    }

    result =
      result.substring(0, finding.start) +
      placeholder +
      result.substring(finding.end);
  }

  return {
    sanitizedText: result,
    findings,
    ledger,
    rawValuesMap,
  };
}

/**
 * High-recall tripwire detector for the egress gate and gateway second-pass scan (FR-D1).
 * Checks if broad, un-sanitized sensitive patterns exist in outbound bytes.
 */
export function tripwireScan(text: string): {
  hit: boolean;
  category?: DetectionCategory;
  snippet?: string;
} {
  const findings = detectAll(text);
  if (findings.length > 0) {
    return {
      hit: true,
      category: findings[0].category,
      // Do not return raw sensitive text; return category and safe snippet length only
      snippet: `Match at offset ${findings[0].start} (${findings[0].category})`,
    };
  }
  return { hit: false };
}

