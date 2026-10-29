import { DetectionFinding } from "../types.js";

// Valid 4th character entity types in Indian PAN:
// P - Individual, C - Company, H - HUF, A - AOP, B - BOI, F - Firm,
// T - Trust, L - Local Authority, J - Artificial Juridical Person, G - Government
const PAN_REGEX = /\b([A-Z]{3})([CPHFATBLJG])([A-Z])([0-9]{4})([A-Z])\b/g;

export function detectPAN(text: string): DetectionFinding[] {
  const findings: DetectionFinding[] = [];
  let match: RegExpExecArray | null;

  PAN_REGEX.lastIndex = 0;
  while ((match = PAN_REGEX.exec(text)) !== null) {
    const raw = match[0];
    findings.push({
      category: "PAN",
      source: "regex",
      ruleId: "pan.in.format",
      confidence: 0.98,
      start: match.index,
      end: match.index + raw.length,
      matchedText: raw,
    });
  }

  return findings;
}
