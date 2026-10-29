import { describe, it, expect } from "vitest";
import {
  validateLuhn,
  validateVerhoeff,
  generateVerhoeffCheckDigit,
  detectAll,
  sanitizeString,
  tripwireScan,
  detectStructural,
} from "../src/index.js";

describe("Luhn Checksum Validation", () => {
  it("should validate valid credit card numbers", () => {
    // Standard test card numbers (Luhn-valid)
    expect(validateLuhn("4111-1111-1111-1111")).toBe(true);
    expect(validateLuhn("4532-0150-1234-5671")).toBe(true);
    expect(validateLuhn("4532015012345671")).toBe(true);
  });

  it("should reject invalid credit card numbers", () => {
    expect(validateLuhn("4532-0150-1234-5679")).toBe(false);
  });
});

describe("Verhoeff Checksum Validation (Aadhaar)", () => {
  it("should generate and validate Verhoeff checksums", () => {
    const base11 = "29482910482";
    const checkDigit = generateVerhoeffCheckDigit(base11);
    const validAadhaar = `${base11}${checkDigit}`;

    expect(validateVerhoeff(validAadhaar)).toBe(true);
    expect(validateVerhoeff(`${base11}${(checkDigit + 1) % 10}`)).toBe(false);
  });
});

describe("Pattern Detection Engine", () => {
  it("should detect PAN numbers with valid entity codes", () => {
    const text = "Taxpayer PAN is ABCPE1234F and company is AAACB1234K";
    const findings = detectAll(text);

    const panFindings = findings.filter((f) => f.category === "PAN");
    expect(panFindings.length).toBe(2);
    expect(panFindings[0].matchedText).toBe("ABCPE1234F");
  });

  it("should detect emails, phone numbers, and UPI IDs", () => {
    const text = "Contact alice@example.com or +91 9876543210. Pay to alice@oksbi.";
    const findings = detectAll(text);

    expect(findings.some((f) => f.category === "EMAIL")).toBe(true);
    expect(findings.some((f) => f.category === "PHONE")).toBe(true);
    expect(findings.some((f) => f.category === "UPI")).toBe(true);
  });

  it("should detect OTPs with keyword proximity", () => {
    const text = "Your one-time verification code is 482910. Do not share.";
    const findings = detectAll(text);

    const otpFindings = findings.filter((f) => f.category === "OTP");
    expect(otpFindings.length).toBe(1);
    expect(otpFindings[0].matchedText).toBe("482910");
  });

  it("should detect OpenAI and GitHub API keys", () => {
    const text = "OpenAI key: sk-abcdef1234567890abcdef123456, GitHub: ghp_1234567890abcdef1234567890abcdef1234";
    const findings = detectAll(text);

    const keys = findings.filter((f) => f.category === "API_KEY");
    expect(keys.length).toBe(2);
  });
});

describe("Sanitization & Egress Tripwire", () => {
  it("should replace sensitive items with semantic tokens and build a ledger", () => {
    const text = "Send 100 to user@example.com with OTP 829104.";
    const result = sanitizeString(text);

    expect(result.sanitizedText).toContain("[REDACTED:EMAIL#1]");
    expect(result.sanitizedText).toContain("[REDACTED:OTP#1]");
    expect(result.sanitizedText).not.toContain("user@example.com");
    expect(result.sanitizedText).not.toContain("829104");

    expect(result.ledger["EMAIL"]).toBe(1);
    expect(result.ledger["OTP"]).toBe(1);
  });

  it("tripwire scan should trigger on raw unredacted sensitive data", () => {
    const raw = "Here is my secret token: sk-abcdef1234567890abcdef123456";
    expect(tripwireScan(raw).hit).toBe(true);

    const clean = "Here is my secret token: [REDACTED:API_KEY#1]";
    expect(tripwireScan(clean).hit).toBe(false);
  });
});

describe("Structural Detection", () => {
  it("should flag password fields without reading value", () => {
    const check = detectStructural({
      type: "password",
      id: "user_pwd",
      name: "password",
    });

    expect(check.isSensitive).toBe(true);
    expect(check.category).toBe("PASSWORD");
  });

  it("should flag card autocomplete fields", () => {
    const check = detectStructural({
      autocomplete: "cc-number",
      name: "cardNumber",
    });

    expect(check.isSensitive).toBe(true);
    expect(check.category).toBe("CARD");
  });
});
