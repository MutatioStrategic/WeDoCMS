import { describe, expect, it } from "vitest";
import { canonicalize, redactAuditData, verifyAuditEvent } from "./audit";

describe("audit event integrity", () => {
  it("canonicalizes object keys deterministically", () => {
    expect(canonicalize({ z: 1, a: { d: true, c: ["x", 2] } })).toBe('{"a":{"c":["x",2],"d":true},"z":1}');
  });

  it("redacts identity-bearing fields before they enter the audit payload", () => {
    expect(redactAuditData({ email: "person@example.test", nested: { passportNumber: "secret", reason: "rights review" } })).toEqual({
      email: "[REDACTED]",
      nested: { passportNumber: "[REDACTED]", reason: "rights review" },
    });
  });

  it("verifies an Ed25519-signed event", async () => {
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const event = {
      schemaVersion: 1 as const,
      eventId: "event-0001",
      streamId: "asset:asset-1",
      sequence: 1,
      occurredAt: "2026-08-13T00:00:00.000Z",
      actor: { id: "contributor-1", type: "contributor" as const },
      action: "asset.created",
      resource: { type: "asset", id: "asset-1" },
      data: { title: "Test asset" },
      residencyRegion: "za" as const,
      previousHash: "GENESIS",
      hash: "not-used-by-this-unit-test",
      signature: "not-used-by-this-unit-test",
      signatureAlgorithm: "Ed25519" as const,
      keyId: "test-key",
      publicKeyJwk,
      r2Key: "events/za/asset:asset-1/1-event-0001.json",
    };
    const canonical = canonicalize({
      schemaVersion: event.schemaVersion,
      eventId: event.eventId,
      streamId: event.streamId,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      actor: event.actor,
      action: event.action,
      resource: event.resource,
      data: event.data,
      residencyRegion: event.residencyRegion,
      previousHash: event.previousHash,
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, new TextEncoder().encode(hash));
    const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const result = await verifyAuditEvent({} as never, { ...event, hash, signature: encoded });
    expect(result).toEqual({ hashValid: true, signatureValid: true });
    expect(encoded).toHaveLength(88);
  });
});
