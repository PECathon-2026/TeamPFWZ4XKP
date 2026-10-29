import {
  Action,
  RiskTier,
  DOMNode,
  ElementFingerprint,
  buildActionCanonicalString,
  sha256Hex,
} from "@privacylens/protocol";

export interface ActionValidationResult {
  valid: boolean;
  tier: RiskTier;
  errorReason?: string;
  fingerprint?: ElementFingerprint;
  actionHash?: string;
}

/**
 * Validates an action proposed by the model against the current DOM snapshot (FR-C3).
 */
export async function validateAction(
  action: Action,
  snapshotTree: DOMNode,
  tabId: number,
  pageOrigin: string,
  snapshotVersion: number
): Promise<ActionValidationResult> {
  // 1. Prohibited action checks (Tier 3)
  if (action.type === "navigate" && action.url) {
    if (action.url.startsWith("file://") || action.url.startsWith("chrome://")) {
      return {
        valid: false,
        tier: "tier3",
        errorReason: "FORBIDDEN_URL_SCHEME: Attempt to navigate to restricted scheme",
      };
    }
  }

  // 2. Element existence check if action targets an element
  let targetNode: DOMNode | undefined;
  if (action.targetId) {
    targetNode = findNodeById(snapshotTree, action.targetId);
    if (!targetNode) {
      return {
        valid: false,
        tier: "tier1",
        errorReason: `TARGET_NOT_FOUND: Node ${action.targetId} absent from snapshot`,
      };
    }
  }

  // 3. Compute Risk Tier
  let tier: RiskTier = "tier1";
  if (action.type === "scroll" || action.type === "wait" || action.type === "done" || action.type === "ask_user") {
    tier = "tier0";
  } else if (action.secretRef) {
    // Secret injection is always consequential Tier 2
    tier = "tier2";
  } else if (targetNode) {
    const attrs = targetNode.attributes || {};
    const textDesc = `${targetNode.name || ""} ${targetNode.text || ""} ${attrs.class || ""}`.toLowerCase();
    const isSubmit =
      attrs.type === "submit" ||
      /\b(pay|buy|purchase|checkout|delete|send|submit|transfer|confirm)\b/.test(textDesc);

    if (isSubmit) {
      tier = "tier2";
    }
  }

  // 4. Compute Element Fingerprint & Action Hash (Anti-TOCTOU)
  let fingerprint: ElementFingerprint | undefined;
  let actionHash: string | undefined;

  if (targetNode) {
    const attrs = targetNode.attributes || {};
    fingerprint = {
      targetId: targetNode.id,
      tagName: targetNode.tag,
      role: targetNode.role,
      accessibleName: targetNode.name,
      formAction: attrs.action,
      formMethod: attrs.method,
      textHash: await sha256Hex(targetNode.text || ""),
    };

    const canonicalStr = buildActionCanonicalString(
      action,
      fingerprint,
      tabId,
      pageOrigin,
      snapshotVersion
    );
    actionHash = await sha256Hex(canonicalStr);
  }

  return {
    valid: true,
    tier,
    fingerprint,
    actionHash,
  };
}

function findNodeById(root: DOMNode, id: string): DOMNode | undefined {
  if (root.id === id || root.attributes?.id === id) return root;
  for (const child of root.children || []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return undefined;
}
