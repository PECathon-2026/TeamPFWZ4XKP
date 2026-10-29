export type DetectionCategory =
  | "CARD"
  | "CARD_CVV"
  | "CARD_EXPIRY"
  | "AADHAAR"
  | "PAN"
  | "PASSWORD"
  | "OTP"
  | "EMAIL"
  | "PHONE"
  | "IFSC"
  | "UPI"
  | "API_KEY"
  | "IP_ADDRESS"
  | "CUSTOM";

export type DetectionSource = "regex" | "checksum" | "structural" | "context" | "custom";

export interface DetectionFinding {
  category: DetectionCategory;
  source: DetectionSource;
  ruleId: string;
  confidence: number;
  start: number;
  end: number;
  matchedText: string;
}

export interface SanitizationResult {
  sanitizedText: string;
  findings: DetectionFinding[];
  ledger: Record<string, number>;
  rawValuesMap: Map<string, string>; // rawValue -> placeholder
}

