import { Action, ElementFingerprint } from "./action.js";

/**
 * Creates a deterministic canonical representation of an action and its targeted element.
 */
export function buildActionCanonicalString(
  action: Action,
  fingerprint: ElementFingerprint | undefined,
  tabId: number,
  pageOrigin: string,
  snapshotVersion: number
): string {
  const parts = [
    `type:${action.type}`,
    `target:${action.targetId ?? ""}`,
    `value:${action.value ?? ""}`,
    `secretRef:${action.secretRef ?? ""}`,
    `tabId:${tabId}`,
    `origin:${pageOrigin}`,
    `version:${snapshotVersion}`,
  ];

  if (fingerprint) {
    parts.push(
      `fp.tag:${fingerprint.tagName}`,
      `fp.role:${fingerprint.role ?? ""}`,
      `fp.name:${fingerprint.accessibleName ?? ""}`,
      `fp.formAction:${fingerprint.formAction ?? ""}`,
      `fp.textHash:${fingerprint.textHash}`
    );
  }

  return parts.join("|");
}

/**
 * Hash string helper using WebCrypto (works in Node 19+ and browser environments).
 */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

