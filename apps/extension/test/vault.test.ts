import { describe, it, expect } from "vitest";
import { SecretVault } from "../src/vault/index.js";

describe("Client-Side Cryptographic Vault", () => {
  it("should encrypt and decrypt secrets with AES-GCM", async () => {
    const vault = new SecretVault();
    const passphrase = "MasterPassphrase42!";

    await vault.addSecret("card.number", "CARD", "4111-1111-1111-1111", passphrase);
    await vault.addSecret("account.pwd", "PASSWORD", "MySecretPassword99!", passphrase);

    // 1. Model sees metadata only
    const available = vault.getAvailableSecrets();
    expect(available).toEqual([
      { name: "card.number", type: "CARD" },
      { name: "account.pwd", type: "PASSWORD" },
    ]);

    // 2. Local retrieval
    expect(vault.getSecret("card.number")).toBe("4111-1111-1111-1111");
    expect(vault.getSecret("account.pwd")).toBe("MySecretPassword99!");

    // 3. Lock clears plaintext from memory
    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
    expect(vault.getSecret("card.number")).toBeUndefined();

    // 4. Unlock with correct passphrase restores access
    const unlocked = await vault.unlock(passphrase);
    expect(unlocked).toBe(true);
    expect(vault.getSecret("card.number")).toBe("4111-1111-1111-1111");

    // 5. Unlock with wrong passphrase fails
    const failUnlock = await vault.unlock("WrongPassword!");
    expect(failUnlock).toBe(false);
  });

  it("should feed all plaintext secrets into ledger strings for egress defense", async () => {
    const vault = new SecretVault();
    await vault.addSecret("api.token", "API_KEY", "sk-proj-test1234567890abcdef", "pass");

    const ledgerSecrets = vault.getAllPlaintextForLedger();
    expect(ledgerSecrets).toContain("sk-proj-test1234567890abcdef");
  });
});

