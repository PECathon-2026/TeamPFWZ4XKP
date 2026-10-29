import { DOMNode, Action, ElementFingerprint } from "@privacylens/protocol";

// Allowlist of safe element tags
const ALLOWED_TAGS = new Set([
  "a", "button", "input", "select", "textarea", "form",
  "label", "p", "span", "div", "h1", "h2", "h3", "h4",
  "h5", "h6", "table", "tr", "td", "th", "ul", "ol", "li", "code"
]);

const ALLOWED_ATTRIBUTES = new Set([
  "id", "name", "type", "role", "aria-label", "placeholder",
  "title", "alt", "href", "action", "method", "autocomplete",
  "disabled", "class"
]);

// Map from ephemeral ID to live DOM Element
const elementIdMap = new Map<string, HTMLElement>();
let currentSnapshotVersion = 0;

/**
 * Traverses DOM and builds safe serialized tree adhering to allowlist.
 */
function buildDOMSnapshot(element: HTMLElement, idCounter = { val: 0 }): DOMNode | null {
  const tagName = element.tagName.toLowerCase();

  // Filter out disallowed elements
  if (!ALLOWED_TAGS.has(tagName)) {
    return null;
  }

  // Filter hidden elements
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return null;
  }

  const id = element.id ? element.id : `node_${idCounter.val++}`;
  elementIdMap.set(id, element);
  if (element.id && id !== element.id) {
    elementIdMap.set(element.id, element);
  }

  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    const attrName = attr.name.toLowerCase();
    if (ALLOWED_ATTRIBUTES.has(attrName)) {
      // NEVER read value of password input!
      if (tagName === "input" && attrName === "value" && (element as HTMLInputElement).type === "password") {
        continue;
      }
      attributes[attrName] = attr.value;
    }
  }

  // Check interactive
  const isInteractive =
    tagName === "button" ||
    tagName === "a" ||
    tagName === "input" ||
    tagName === "select" ||
    tagName === "textarea" ||
    element.onclick !== null ||
    element.getAttribute("role") === "button";

  const children: DOMNode[] = [];
  for (const child of Array.from(element.children)) {
    if (child instanceof HTMLElement) {
      const childNode = buildDOMSnapshot(child, idCounter);
      if (childNode) {
        children.push(childNode);
      }
    }
  }

  // Get direct text content
  let directText = "";
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      directText += node.textContent.trim() + " ";
    }
  }
  directText = directText.trim();

  return {
    id,
    tag: tagName,
    role: element.getAttribute("role") || undefined,
    name: element.getAttribute("aria-label") || attributes["name"] || undefined,
    text: directText || undefined,
    attributes,
    children,
    isInteractive,
  };
}

/**
 * Recomputes element fingerprint at execution time (Anti-TOCTOU).
 */
function verifyFingerprint(element: HTMLElement, fp: ElementFingerprint): boolean {
  if (element.tagName.toLowerCase() !== fp.tagName.toLowerCase()) return false;
  if (fp.role && element.getAttribute("role") !== fp.role) return false;
  if (fp.formAction && element.getAttribute("action") !== fp.formAction) return false;
  return true;
}

/**
 * Message listener for extension orchestrator.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SNAPSHOT") {
    elementIdMap.clear();
    currentSnapshotVersion = message.snapshotVersion;
    const root = buildDOMSnapshot(document.body);
    sendResponse({ ok: true, rawTree: root });
    return true;
  }

  if (message.type === "EXECUTE") {
    const action: Action = message.action;
    const targetElement = action.targetId
      ? (elementIdMap.get(action.targetId) || document.getElementById(action.targetId) || undefined)
      : undefined;

    if (action.targetId && !targetElement) {
      sendResponse({ ok: false, reasonCode: "ELEMENT_STALE_OR_MISSING" });
      return true;
    }

    // Verify fingerprint if provided
    if (targetElement && message.fingerprint) {
      const match = verifyFingerprint(targetElement, message.fingerprint);
      if (!match) {
        sendResponse({ ok: false, reasonCode: "FINGERPRINT_MISMATCH" });
        return true;
      }
    }

    // Execute Action
    try {
      if (action.type === "click" && targetElement) {
        targetElement.click();
      } else if (action.type === "type" && targetElement instanceof HTMLInputElement) {
        const textToFill = message.vaultSecretValue || action.value || "";
        targetElement.value = textToFill;
        targetElement.dispatchEvent(new Event("input", { bubbles: true }));
        targetElement.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (action.type === "scroll") {
        window.scrollBy(0, action.direction === "up" ? -300 : 300);
      }

      sendResponse({ ok: true });
    } catch (err: unknown) {
      sendResponse({ ok: false, reasonCode: `EXECUTION_FAILED: ${err instanceof Error ? err.message : "unknown"}` });
    }
    return true;
  }
});

