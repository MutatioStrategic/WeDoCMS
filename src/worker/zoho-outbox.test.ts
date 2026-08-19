import { describe, expect, it } from "vitest";
import { decryptZohoSecret, encryptZohoSecret, sha256Hex } from "./zoho-outbox";

describe("Zoho outbox secret boundary", () => {
  it("encrypts refresh tokens so D1 never needs plaintext", async () => {
    const encrypted = await encryptZohoSecret("refresh-token", "test-encryption-key");
    expect(encrypted.ciphertext).not.toContain("refresh-token");
    expect(await decryptZohoSecret(encrypted.ciphertext, encrypted.iv, "test-encryption-key")).toBe("refresh-token");
    await expect(decryptZohoSecret(encrypted.ciphertext, encrypted.iv, "wrong-key")).rejects.toBeTruthy();
  });

  it("produces stable hashes for contract payloads", async () => {
    expect(await sha256Hex('{"id":"campaign-1"}')).toBe(await sha256Hex('{"id":"campaign-1"}'));
    expect(await sha256Hex('{"id":"campaign-1"}')).not.toBe(await sha256Hex('{"id":"campaign-2"}'));
  });
});
