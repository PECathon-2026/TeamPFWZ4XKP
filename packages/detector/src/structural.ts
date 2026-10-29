import { DetectionFinding, DetectionCategory } from "./types.js";

export interface ElementAttributes {
  type?: string;
  name?: string;
  id?: string;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  autocomplete?: string;
  value?: string;
}

/**
 * Structural detection based on DOM element metadata and attributes (FR-A2).
 */
export function detectStructural(attrs: ElementAttributes): {
  isSensitive: boolean;
  category?: DetectionCategory;
  ruleId?: string;
} {
  const type = (attrs.type || "").toLowerCase();
  const autocomplete = (attrs.autocomplete || "").toLowerCase();
  const name = (attrs.name || "").toLowerCase();
  const id = (attrs.id || "").toLowerCase();
  const placeholder = (attrs.placeholder || "").toLowerCase();
  const ariaLabel = (attrs.ariaLabel || "").toLowerCase();

  const combinedMeta = `${name} ${id} ${placeholder} ${ariaLabel}`;

  // 1. Password input elements (Never read the value!)
  if (
    type === "password" ||
    autocomplete === "current-password" ||
    autocomplete === "new-password" ||
    /\b(password|passwd|pwd)\b/.test(combinedMeta)
  ) {
    return {
      isSensitive: true,
      category: "PASSWORD",
      ruleId: "structural.password",
    };
  }

  // 2. Card numbers
  if (
    autocomplete === "cc-number" ||
    /\b(cc[-_]?num|card[-_]?num|card[-_]?number)\b/.test(combinedMeta)
  ) {
    return {
      isSensitive: true,
      category: "CARD",
      ruleId: "structural.card.number",
    };
  }

  // 3. Card CVV / CVC
  if (
    autocomplete === "cc-csc" ||
    /\b(cvv|cvc|cid|security[-_]?code)\b/.test(combinedMeta)
  ) {
    return {
      isSensitive: true,
      category: "CARD_CVV",
      ruleId: "structural.card.cvv",
    };
  }

  // 4. One-Time Password (OTP)
  if (
    autocomplete === "one-time-code" ||
    /\b(otp|verification[-_]?code|passcode)\b/.test(combinedMeta)
  ) {
    return {
      isSensitive: true,
      category: "OTP",
      ruleId: "structural.otp",
    };
  }

  // 5. Aadhaar
  if (/\b(aadhaar|aadhar|uidai)\b/.test(combinedMeta)) {
    return {
      isSensitive: true,
      category: "AADHAAR",
      ruleId: "structural.aadhaar",
    };
  }

  // 6. PAN
  if (/\b(pan[-_]?number|pan[-_]?card|pan[-_]?no)\b/.test(combinedMeta)) {
    return {
      isSensitive: true,
      category: "PAN",
      ruleId: "structural.pan",
    };
  }

  return { isSensitive: false };
}

