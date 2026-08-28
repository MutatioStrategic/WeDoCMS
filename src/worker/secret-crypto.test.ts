import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secret-crypto";

describe("secret crypto", () => {
  it("round-trips a secret without retaining plaintext in the encrypted fields", async () => {
    const encrypted = await encryptSecret("webhook-secret", "encryption-key", "WEBHOOK_SECRET_ENCRYPTION_KEY");
    expect(encrypted.ciphertext).not.toContain("webhook-secret");
    await expect(decryptSecret(encrypted.ciphertext, encrypted.iv, "encryption-key", "WEBHOOK_SECRET_ENCRYPTION_KEY")).resolves.toBe("webhook-secret");
  });

  it("rejects decryption with the wrong key", async () => {
    const encrypted = await encryptSecret("webhook-secret", "encryption-key", "WEBHOOK_SECRET_ENCRYPTION_KEY");
    await expect(decryptSecret(encrypted.ciphertext, encrypted.iv, "another-key", "WEBHOOK_SECRET_ENCRYPTION_KEY")).rejects.toThrow();
  });
});
