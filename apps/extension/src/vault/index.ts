import { SecretMetadata } from "@privacylens/protocol";

export interface StoredSecret {
  name: string;
  type: string;
  ciphertext: string; // base64
  iv: string;         // base64
}

/**
 * Client-Side Cryptographic Vault using WebCrypto AES-GCM (AUTH §8).
 * Stores encrypted user secrets; decrypts in memory only upon approved Tier-2 action.
 */
export class SecretVault {
  private activeKey: CryptoKey | null = null;
  private masterSalt: Uint8Array | null = null;
  private plaintextCache = new Map<string, string>(); // name -> plaintext
  private secrets = new Map<string, StoredSecret>();

  /**
   * Derives an AES-GCM 256-bit key from a user passphrase via PBKDF2.
   */
  private async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Initializes or unlocks the vault with user passphrase.
   */
  async unlock(passphrase: string): Promise<boolean> {
    this.plaintextCache.clear();

    if (!this.masterSalt) {
      // First initialization: generate master salt and key
      this.masterSalt = crypto.getRandomValues(new Uint8Array(16));
      this.activeKey = await this.deriveKey(passphrase, this.masterSalt);
      return true;
    }

    // Existing vault: derive master key using stored master salt
    const key = await this.deriveKey(passphrase, this.masterSalt);

    for (const [name, secret] of this.secrets.entries()) {
      try {
        const iv = Uint8Array.from(atob(secret.iv), (c) => c.charCodeAt(0));
        const ciphertext = Uint8Array.from(atob(secret.ciphertext), (c) => c.charCodeAt(0));

        const decryptedBuffer = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          ciphertext
        );

        const plaintext = new TextDecoder().decode(decryptedBuffer);
        this.plaintextCache.set(name, plaintext);
      } catch {
        // Tag verification failed; wrong passphrase
        return false;
      }
    }

    this.activeKey = key;
    return true;
  }

  /**
   * Adds and encrypts a secret in the vault.
   */
  async addSecret(name: string, type: string, plaintext: string, passphrase?: string): Promise<void> {
    if (!this.activeKey) {
      if (!passphrase) {
        throw new Error("Vault is locked. Provide passphrase to encrypt.");
      }
      await this.unlock(passphrase);
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.activeKey!,
      enc.encode(plaintext)
    );

    const stored: StoredSecret = {
      name,
      type,
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
      iv: btoa(String.fromCharCode(...iv)),
    };

    this.secrets.set(name, stored);
    this.plaintextCache.set(name, plaintext);
  }

  /**
   * Retrieves decrypted secret by reference name (for authorized injection only).
   */
  getSecret(name: string): string | undefined {
    return this.plaintextCache.get(name);
  }

  /**
   * Returns metadata only (name + type) to safely expose to cloud models (FR-C6).
   */
  getAvailableSecrets(): SecretMetadata[] {
    return Array.from(this.secrets.values()).map((s) => ({
      name: s.name,
      type: s.type,
    }));
  }

  /**
   * Returns all plaintext secrets currently held in memory.
   * Fed into the Egress Gate Redaction Ledger to assert they never leave the extension.
   */
  getAllPlaintextForLedger(): string[] {
    return Array.from(this.plaintextCache.values());
  }

  /**
   * Locks the vault and purges plaintext from memory.
   */
  lock(): void {
    this.activeKey = null;
    this.plaintextCache.clear();
  }

  isUnlocked(): boolean {
    return this.activeKey !== null;
  }
}
