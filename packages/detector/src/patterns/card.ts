import { DetectionFinding } from "../types.js";
import { validateLuhn, identifyCardBrand } from "../checksums/luhn.js";

// 13 to 19 digits with optional spaces or hyphens
const CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

// CVV pattern: 3 or 4 digits near security code keywords or standalone in context
const CVV_KEYWORD_REGEX = /\b(?:cvv|cvc|cid|security\s*code|card\s*verification)[^\w]{0,10}?(\d{3,4})\b/gi;

// Expiration date MM/YY or MM/YYYY
const EXPIRY_REGEX = /\b(0[1-9]|1[0-2])[\/\-](20\d{2}|\d{2})\b/g;

export function detectCardNumbers(text: string): DetectionFinding[] {
  const findings: DetectionFinding[] = [];
  let match: RegExpExecArray | null;

  CARD_REGEX.lastIndex = 0;
  while ((match = CARD_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const digits = raw.replace(/[\s-]/g, "");

    // Must be between 13 and 19 digits, pass Luhn, and have a recognized card brand or valid payment IIN prefix [2-6]
    if (digits.length >= 13 && digits.length <= 19 && validateLuhn(digits)) {
      const brand = identifyCardBrand(digits);
      if (brand !== "unknown" || /^[2-6]/.test(digits)) {
        findings.push({
          category: "CARD",
          source: "checksum",
          ruleId: `card.luhn.${brand}`,
          confidence: brand !== "unknown" ? 0.99 : 0.85,
          start: match.index,
          end: match.index + raw.length,
          matchedText: raw,
        });
      }
    }
  }

  // Detect CVV with keyword proximity
  CVV_KEYWORD_REGEX.lastIndex = 0;
  while ((match = CVV_KEYWORD_REGEX.exec(text)) !== null) {
    const cvvDigits = match[1];
    const fullMatch = match[0];
    const cvvStart = match.index + fullMatch.lastIndexOf(cvvDigits);
    findings.push({
      category: "CARD_CVV",
      source: "context",
      ruleId: "card.cvv.proximity",
      confidence: 0.95,
      start: cvvStart,
      end: cvvStart + cvvDigits.length,
      matchedText: cvvDigits,
    });
  }

  // Detect Expiry
  EXPIRY_REGEX.lastIndex = 0;
  while ((match = EXPIRY_REGEX.exec(text)) !== null) {
    findings.push({
      category: "CARD_EXPIRY",
      source: "regex",
      ruleId: "card.expiry",
      confidence: 0.9,
      start: match.index,
      end: match.index + match[0].length,
      matchedText: match[0],
    });
  }

  return findings;
}
