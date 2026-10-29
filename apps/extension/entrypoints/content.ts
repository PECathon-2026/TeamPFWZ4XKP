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

  // For input elements, read the live .value property (not the stale 'value' HTML attribute)
  if (tagName === "input" && (element as HTMLInputElement).type !== "password") {
    const liveValue = (element as HTMLInputElement).value;
    if (liveValue) {
      attributes["value"] = liveValue;
    }
  }
  // For textarea elements too
  if (tagName === "textarea") {
    const liveValue = (element as HTMLTextAreaElement).value;
    if (liveValue) {
      attributes["value"] = liveValue;
    }
  }
  // For select elements, read the live selected value
  if (tagName === "select") {
    const liveValue = (element as HTMLSelectElement).value;
    if (liveValue) {
      attributes["value"] = liveValue;
    }
    // Also capture the selected option's text
    const selectedOption = (element as HTMLSelectElement).selectedOptions[0];
    if (selectedOption?.text) {
      attributes["title"] = selectedOption.text;
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

let overlayShadowRoot: ShadowRoot | null = null;
let overlayHost: HTMLElement | null = null;

/**
 * Renders non-intrusive read-only redaction highlights in a closed shadow DOM (FRONTEND.md §1 & §4.2).
 */
function renderPrivacyOverlay() {
  if (!overlayHost) {
    overlayHost = document.createElement("div");
    overlayHost.id = "privacylens-shield-container";
    overlayHost.style.position = "absolute";
    overlayHost.style.top = "0";
    overlayHost.style.left = "0";
    overlayHost.style.width = "100%";
    overlayHost.style.height = "100%";
    overlayHost.style.pointerEvents = "none";
    overlayHost.style.zIndex = "2147483647";
    overlayShadowRoot = overlayHost.attachShadow({ mode: "closed" });
    document.body.appendChild(overlayHost);
  }

  if (!overlayShadowRoot) return;

  overlayShadowRoot.innerHTML = `
    <style>
      .pl-badge {
        position: absolute;
        background: #0284c7;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        pointer-events: auto;
        cursor: default;
        z-index: 2147483647;
      }
      .pl-highlight {
        position: absolute;
        border: 2px dashed #0284c7;
        background: rgba(56, 189, 248, 0.08);
        border-radius: 6px;
        pointer-events: none;
        z-index: 2147483646;
      }
    </style>
  `;

  const selector = [
    'input[type="password"]',
    'input[autocomplete*="cc-"]',
    'input[autocomplete="cc-number"]',
    'input[autocomplete="cc-csc"]',
    'input[autocomplete="cc-exp"]',
    'input[name*="card"]',
    'input[name*="cvv"]',
    'input[name*="cvc"]',
    'input[name*="pan"]',
    'input[id*="card"]',
    'input[id*="cvv"]',
    'input[id*="cvc"]',
  ].join(", ");
  const inputs = document.querySelectorAll<HTMLElement>(selector);
  inputs.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const box = document.createElement("div");
    box.className = "pl-highlight";
    box.style.left = `${rect.left + scrollX - 2}px`;
    box.style.top = `${rect.top + scrollY - 2}px`;
    box.style.width = `${rect.width + 4}px`;
    box.style.height = `${rect.height + 4}px`;

    const badge = document.createElement("div");
    badge.className = "pl-badge";
    badge.textContent = "🛡️ PrivacyLens Protected";
    badge.title = "Protected locally. Raw value is never sent to the model.";
    badge.style.left = `${Math.max(rect.left + scrollX, rect.right + scrollX - 140)}px`;
    badge.style.top = `${Math.max(0, rect.top + scrollY - 10)}px`;

    overlayShadowRoot?.appendChild(box);
    overlayShadowRoot?.appendChild(badge);
  });
}

/**
 * Message listener for extension orchestrator.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SNAPSHOT") {
    elementIdMap.clear();
    currentSnapshotVersion = message.snapshotVersion;
    const root = buildDOMSnapshot(document.body);
    try {
      renderPrivacyOverlay();
    } catch {
      // Non-fatal if overlay fails to draw
    }
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

