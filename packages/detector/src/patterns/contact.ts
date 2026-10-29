import { DetectionFinding } from "../types.js";

// Standard RFC 5322 compatible email regex
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Indian Mobile numbers (+91 optional, 10 digits starting with 6-9)
const IN_PHONE_REGEX = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g;

// General E.164 international phone numbers (+ followed by 7-15 digits)
const E164_PHONE_REGEX = /\+[1-9]\d{6,14}\b/g;

// UPI ID / VPA: username@bank
const UPI_REGEX = /\b[a-zA-Z0-9.\-_]{2,256}@(okhdfcbank|oksbi|okaxis|okicici|paytm|ybl|ibl|axl|upi|apl|fbl|barodampay|kotak)\b/gi;

// Indian Financial System Code (IFSC): 4 letters + '0' + 6 alphanumeric
const IFSC_REGEX = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;

export function detectContactInfo(text: string): DetectionFinding[] {
  const findings: DetectionFinding[] = [];
  let match: RegExpExecArray | null;

  // 1. Email detection
  EMAIL_REGEX.lastIndex = 0;
  while ((match = EMAIL_REGEX.exec(text)) !== null) {
    findings.push({
      category: "EMAIL",
      source: "regex",
      ruleId: "email.rfc5322",
      confidence: 0.98,
      start: match.index,
      end: match.index + match[0].length,
      matchedText: match[0],
    });
  }

  // 2. UPI detection (check before phone to avoid overlaps on phone@upi)
  UPI_REGEX.lastIndex = 0;
  while ((match = UPI_REGEX.exec(text)) !== null) {
    findings.push({
      category: "UPI",
      source: "regex",
      ruleId: "upi.vpa",
      confidence: 0.97,
      start: match.index,
      end: match.index + match[0].length,
      matchedText: match[0],
    });
  }

  // 3. Indian Phone numbers
  IN_PHONE_REGEX.lastIndex = 0;
  while ((match = IN_PHONE_REGEX.exec(text)) !== null) {
    const raw = match[0];
    findings.push({
      category: "PHONE",
      source: "regex",
      ruleId: "phone.in",
      confidence: 0.95,
      start: match.index,
      end: match.index + raw.length,
      matchedText: raw,
    });
  }

  // 4. E.164 International Phone numbers
  E164_PHONE_REGEX.lastIndex = 0;
  while ((match = E164_PHONE_REGEX.exec(text)) !== null) {
    const raw = match[0];
    findings.push({
      category: "PHONE",
      source: "regex",
      ruleId: "phone.e164",
      confidence: 0.93,
      start: match.index,
      end: match.index + raw.length,
      matchedText: raw,
    });
  }

  // 5. IFSC codes
  IFSC_REGEX.lastIndex = 0;
  while ((match = IFSC_REGEX.exec(text)) !== null) {
    findings.push({
      category: "IFSC",
      source: "regex",
      ruleId: "ifsc.code",
      confidence: 0.96,
      start: match.index,
      end: match.index + match[0].length,
      matchedText: match[0],
    });
  }

  return findings;
}
