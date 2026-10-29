# PrivacyLens — Auth, Permissions, and Approval Model

Related: `SYSTEM_DESIGN.md` §10 (risk tiers), `BACKEND.md` §3 and §9, `FRONTEND.md` §4.3.

---

## 1. Reframing "auth"

PS-004 requires no user accounts, and accounts would hurt the privacy story: a login creates a persistent identifier tied to a person's browsing tasks. [DECIDED: no accounts, no passwords, no emails collected.]

"Auth" here means six separate questions:

| # | Question | Section |
|---|---|---|
| 1 | What is the extension allowed to touch in the browser? | §3 |
| 2 | Who may talk to whom *inside* the extension? | §4 |
| 3 | Who may call the gateway? | §5 |
| 4 | Where do provider keys and user secrets live? | §6, §8 |
| 5 | Who authorizes consequential actions? | §7 |
| 6 | What are we not defending? | §9 |

## 2. Assets and adversaries

| Asset | Adversary | Example attack |
|---|---|---|
| User's sensitive page data | Malicious/compromised web page | Injection tries to make the agent leak or act |
| User's sensitive page data | Curious gateway or provider | Logging request bodies |
| Provider API key / budget | Anyone with the extension package | Unpack extension, extract a key, burn budget |
| Approval integrity | Malicious page | Swap button after approval; spoof approval UI |
| Vault contents | Local malware, page scripts | Read storage or DOM after injection |
| Extension capabilities | Other web pages | Message the extension from page context |

## 3. Layer 1: Extension permissions (least privilege)

```jsonc
{
  "manifest_version": 3,
  "permissions": ["activeTab", "scripting", "sidePanel", "storage", "offscreen"],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' http://127.0.0.1:8787 https://<gateway-host> http://127.0.0.1:11434"
  }
}
```

- **`activeTab` + `scripting`** instead of `<all_urls>`: access is granted only for the tab where the user starts a run, via a user gesture. [ASSUMPTION: verify exact `activeTab` lifetime and frame coverage against current Chrome docs.]
- **Optional host permissions** are requested at runtime only for sites where cross-origin frames must be inspected, and only with a user prompt.
- **No** `externally_connectable`, so web pages cannot message the extension. No `webRequest`, no `cookies`, no `history`, no `tabs` beyond what `activeTab` gives.
- **`connect-src` allowlist** is the browser-enforced backstop to the egress gate (SYSTEM_DESIGN §9). Even if the gate has a bug, the browser blocks requests to other hosts.
- `wasm-unsafe-eval` is only needed for OCR/face WASM; drop it in P0 builds that omit them.

## 4. Layer 2: Intra-extension message authentication

- Content scripts live in the **isolated world** and are never given a main-world bridge, so page JS cannot call extension messaging.
- The service worker handles messages only if:
  - `sender.id === chrome.runtime.id`,
  - for content-script messages, `sender.tab.id` and `sender.frameId` match the active run's tab/frame,
  - the payload passes zod validation, and
  - `snapshotVersion` matches the current version (stale messages are dropped).
- The content script accepts `EXECUTE` only via `chrome.runtime.onMessage` from the extension (never `window.postMessage`), and only with a valid approval token when the tier requires one.
- Page content is *data*. Nothing read from the page can ever become a message type, an action, or a tier.

## 5. Layer 3: Extension → Gateway

There are no users, so we authenticate **installs**, and we are honest about what that buys. [Certain: any secret shipped in a client is extractable. Install tokens give rate limiting and revocation, not identity.]

### 5.1 MVP tier (P0)

- Gateway issues a random bearer token at registration; the extension stores it in `chrome.storage.local`.
- Registration is rate-limited per salted IP hash (hash is salted with a per-boot random salt, kept in memory, expires in minutes).
- Per-token request limits and the global spend cap (BACKEND §10) are the real protection.
- In local dev the gateway can run with a static dev token.

### 5.2 Hardened tier (P1)

Device-bound tokens in the style of DPoP:

1. On first run the extension generates an **ECDSA P-256 keypair** with WebCrypto, `extractable: false`, and stores the `CryptoKey` in IndexedDB (extension origin).
2. `POST /v1/auth/register` carries the public JWK and a **proof-of-work** solution (hashcash-style; difficulty set by the gateway) so mass registration is costly.
3. Gateway returns a short-lived access token (about 15 minutes) containing the key thumbprint (`cnf.jkt`).
4. Each request adds a signature header over `method | path | sha256(body) | timestamp | nonce`. The gateway verifies against the key bound to the token, allows ±60 s skew, and rejects reused nonces (in-memory TTL cache).
5. Refresh uses a signed challenge, so a stolen token without the private key expires quickly and cannot be refreshed. The private key is non-extractable, so exfiltrating it takes code execution inside the extension.

### 5.3 What this does and doesn't give us

| Gives | Doesn't give |
|---|---|
| Per-install rate limits and revocation | Proof that the caller is *our* extension (a script can register its own keys, at PoW cost) |
| Replay resistance | Protection if the browser profile is compromised |
| Cheap bulk-abuse deterrence | Identity of any person (by design) |

`Origin: chrome-extension://<id>` checks and `ALLOWED_EXTENSION_IDS` are hygiene against casual misuse, **not** authentication, since non-browser clients can set any header. [Certain]

## 6. Layer 4: Provider keys

| Mode | Where the key lives | Notes |
|---|---|---|
| Gateway (default) | Server env var `PROVIDER_API_KEY` | Never sent to the extension, never logged |
| BYO key, direct from extension (optional, P2) | `chrome.storage.session` (cleared on browser close) after the user pastes it | Explicit warning in UI; the key is a user secret and is covered by the same detectors if it ever appears in page text |
| Local model | None | `127.0.0.1` only |

The gateway must refuse to start if `PROVIDER_API_KEY` is missing in a non-mock mode, and must never include it in any error body.

## 7. Layer 5: Human approval of consequential actions

This is the authorization model for the *agent*. The model proposes; the human disposes.

### 7.1 What requires approval

Tier 2 from SYSTEM_DESIGN §10: submits, purchases/deletes/sends, secretRef typing, cross-origin navigation or form posts, downloads. Tier 3 is never executable.

### 7.2 Binding approvals to the exact action (anti-TOCTOU)

The dangerous failure is not "user approved something bad" but "user approved X, then the page changed and Y ran." Design:

1. When validating an action, the service worker computes an **element fingerprint**: `{role, accessibleName, tagName, form action origin+path, formMethod, position among siblings, visible text hash}` and an `actionHash = SHA-256(type | fingerprint | params | tabId | pageOrigin | snapshotVersion)`. For `secretRef`, params contain the reference *name*, never the value.
2. The approval card shows the **resolved** fingerprint fields (what the element *is*), not the model's description.
3. On approve, the service worker mints `approvalToken = HMAC(sessionKey, actionHash | nonce | exp)` with `exp = now + 60 s`, single use. `sessionKey` is random, held in SW memory.
4. At execution, the content script **recomputes the fingerprint** of the target element. If it differs from the approved one, execution aborts and the run returns to Snapshotting with a `FINGERPRINT_MISMATCH` event. The token is verified in the SW before `EXECUTE` is sent, and the content script verifies the fingerprint match.
5. Tokens are consumed on use; reuse or expiry → denied.

### 7.3 Approval UI integrity

- Rendered only in the side panel. Page-injected overlays are non-interactive (closed shadow root, `pointer-events: none`).
- Approval requires an explicit click on a focused button; Enter/Space do not auto-approve.
- A page cannot dismiss, resize, or restyle the side panel.

### 7.4 Denials

Deny stops the run (P0) and records `DENIED` in the log. No "ask again with a different action" loop for the same tier-2 target without a fresh snapshot.

## 8. Layer 6: Secret vault

For bonus FR-C6 ("local secret injection").

| Aspect | Design |
|---|---|
| Storage | `chrome.storage.local`, entries encrypted with AES-GCM |
| Key derivation | PBKDF2-SHA256 (high iteration count) or Argon2id via WASM from the user's passphrase, per-vault random salt |
| Unlock | Derived key held in SW memory (or `storage.session`) with an idle timeout; "lock now" button |
| Reference use | Model sees only names such as `card.number` listed in the envelope as `availableSecrets:[{name,type}]` |
| Injection | SW sends the plaintext to the **content script only at the moment of `EXECUTE`** for an approved `type`+`secretRef` action; the content script sets the field value and discards it |
| Logging | Value never logged; run log shows `secretRef:"card.number"` |
| Gate interaction | Vault values are added to the redaction ledger when unlocked, so any appearance in outbound bytes blocks the request |

Accepted risks: once placed in the DOM, the value is visible to that page's own scripts (the site must receive it to complete the purchase), and a page could read it from the field. That is inherent to filling a form and is why secretRef typing is Tier 2.

## 9. Not defended (state this in the README)

- Compromised OS, browser, or another malicious extension with broad permissions.
- A page that legitimately receives a value the user approved filling in, then misuses it.
- A user who approves everything without reading; we reduce but cannot remove this.
- Sensitive data typed by the user **outside** the extension's observation.
- Network observers who can see the gateway endpoint metadata (use TLS; local mode avoids it).
- Leakage pathways we did not enumerate and test (P1–P9 in SYSTEM_DESIGN §12 define the scope of any claim).

## 10. Security test cases

| ID | Test | Expected |
|---|---|---|
| AU-1 | Web page calls `chrome.runtime.sendMessage` / `postMessage` to the extension | No effect (no `externally_connectable`, content script ignores `window` messages) |
| AU-2 | Content script receives `EXECUTE` without a token for a Tier-2 action | Rejected |
| AU-3 | Page swaps "Cancel" for "Pay" between approval and execution | `FINGERPRINT_MISMATCH`, nothing executed |
| AU-4 | Approval token reused or expired | Rejected |
| AU-5 | Page draws a fake "Approve" button in its own DOM | Inert; real approval only exists in side panel |
| AU-6 | Gateway request without token / expired token / replayed signature | 401 |
| AU-7 | `PROVIDER_API_KEY` search across built extension bundle and all gateway responses | Not found |
| AU-8 | Extension attempts `fetch` to a non-allowlisted host (test build with deliberate bug) | Blocked by CSP and by the gate |
| AU-9 | Vault locked → `secretRef` action | Fails with `VAULT_LOCKED`, no prompt for passphrase inside the page |
| AU-10 | Vault value present in any captured outbound byte | Gate blocks (ledger check) |
| AU-11 | Message from a different tab/frame than the active run | Dropped |

## 11. Open decisions

- **[OPEN]** Ship MVP tier only, or also the DPoP-style hardened tier? Recommendation: MVP first; the hardened tier is a good P1 differentiator but not worth it before the eval harness is green.
- **[OPEN]** Is the vault worth building given the time? It is a bonus item and also a strong demo moment (§9 of the PRD).