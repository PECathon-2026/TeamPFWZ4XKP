/**
 * Text normalizers to handle obfuscation (FR-A5).
 */

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g;

/**
 * Normalizes full-width digits and Unicode variants to standard ASCII characters.
 */
export function normalizeText(input: string): string {
  if (!input) return "";

  // 1. Unicode NFKC normalization
  let normalized = input.normalize("NFKC");

  // 2. Strip zero-width characters used for evading regex
  normalized = normalized.replace(ZERO_WIDTH_REGEX, "");

  // 3. Convert full-width ASCII digits (0xFF10 - 0xFF19) if any remain
  normalized = normalized.replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );

  return normalized;
}

/**
 * Strip separators (spaces, hyphens, dots) from candidate token.
 */
export function stripSeparators(input: string): string {
  return input.replace(/[\s\-._]/g, "");
}

