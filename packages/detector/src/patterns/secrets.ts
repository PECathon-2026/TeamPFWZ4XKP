import { DetectionFinding } from "../types.js";

// OpenAI API Keys (legacy sk-... and modern sk-proj-...)
const OPENAI_KEY_REGEX = /\b(sk-[a-zA-Z0-9_\-]{20,})\b/g;

// GitHub Personal Access Tokens
const GITHUB_PAT_REGEX = /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/g;

// AWS Access Key ID
const AWS_KEY_REGEX = /\b(AKIA[0-9A-Z]{16})\b/g;

// JSON Web Token (JWT)
const JWT_REGEX = /\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g;

// Generic secret near keyword
const GENERIC_SECRET_REGEX = /\b(?:api_key|access_token|secret_key|client_secret|auth_token|bearer)[=:\s]{1,4}["']?([a-zA-Z0-9_\-]{16,})["']?/gi;

export function detectSecrets(text: string): DetectionFinding[] {
  const findings: DetectionFinding[] = [];
  let match: RegExpExecArray | null;

  // OpenAI keys
  OPENAI_KEY_REGEX.lastIndex = 0;
  while ((match = OPENAI_KEY_REGEX.exec(text)) !== null) {
    findings.push({
      category: "API_KEY",
      source: "regex",
      ruleId: "key.openai",
      confidence: 0.99,
      start: match.index,
      end: match.index + match[0].length,
      matchedText: match[0],
    });
  }

  // GitHub tokens
  GITHUB_PAT_REGEX.lastIndex = 0;
  while ((match = GITHUB_PAT_REGEX.exec(text)) !== null) {
    findings.push({
      category: "API_KEY",
      source: "regex",
      ruleId: "key.github",
      confidence: 0.99,
      start: match.index,
      end: match.index + match[0].length,
      matchedText: match[0],
    });
  }

  // AWS Access Keys
  AWS_KEY_REGEX.lastIndex = 0;
  while ((match = AWS_KEY_REGEX.exec(text)) !== null) {
    findings.push({
      category: "API_KEY",
      source: "regex",
      ruleId: "key.aws",
      confidence: 0.99,
      start: match.index,
      end: match.index + match[0].length,
      matchedText: match[0],
    });
  }

  // JWTs
  JWT_REGEX.lastIndex = 0;
  while ((match = JWT_REGEX.exec(text)) !== null) {
    findings.push({
      category: "API_KEY",
      source: "regex",
      ruleId: "key.jwt",
      confidence: 0.98,
      start: match.index,
      end: match.index + match[0].length,
      matchedText: match[0],
    });
  }

  // Generic keyword-associated secrets
  GENERIC_SECRET_REGEX.lastIndex = 0;
  while ((match = GENERIC_SECRET_REGEX.exec(text)) !== null) {
    const secretValue = match[1];
    const fullMatch = match[0];
    const secretStart = match.index + fullMatch.indexOf(secretValue);
    findings.push({
      category: "API_KEY",
      source: "context",
      ruleId: "key.generic.entropy",
      confidence: 0.9,
      start: secretStart,
      end: secretStart + secretValue.length,
      matchedText: secretValue,
    });
  }

  return findings;
}
