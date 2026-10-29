import { DetectionFinding } from "../types.js";
import { validateVerhoeff } from "../checksums/verhoeff.js";

// Aadhaar: 12 digits, first digit is 2-9, optional spaces/hyphens as 4-digit groups
const AADHAAR_REGEX = /\b([2-9]\d{3}[ -]?\d{4}[ -]?\d{4})\b/g;

export function detectAadhaar(text: string): DetectionFinding[] {
  const findings: DetectionFinding[] = [];
  let match: RegExpExecArray | null;

  AADHAAR_REGEX.lastIndex = 0;
  while ((match = AADHAAR_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const digits = raw.replace(/[\s-]/g, "");

    if (digits.length === 12 && validateVerhoeff(digits)) {
      findings.push({
        category: "AADHAAR",
        source: "checksum",
        ruleId: "aadhaar.verhoeff",
        confidence: 0.99,
        start: match.index,
        end: match.index + raw.length,
        matchedText: raw,
      });
    }
  }

  return findings;
}
