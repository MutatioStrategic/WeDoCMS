import { describe, expect, it } from "vitest";
import { canonicalJson, createDiditSession, signDiditWebhookV2, verifyDiditWebhook } from "./didit";

describe("Didit integration", () => {
  it("uses recursively sorted canonical JSON for V2 signatures", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [{ q: 1, a: 2 }] })).toBe('{"a":{"b":3,"y":2},"list":[{"a":2,"q":1}],"z":1}');
  });

  it("verifies timestamped V2 webhooks and rejects stale timestamps", async () => {
    const payload = { session_id: "session-1", status: "Approved", webhook_type: "status.updated" };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signDiditWebhookV2("secret", timestamp, payload);
    expect(await verifyDiditWebhook({ secret: "secret", rawBody: JSON.stringify(payload), payload, signatureV2: signature, timestamp })).toBe(true);
    expect(await verifyDiditWebhook({ secret: "secret", rawBody: JSON.stringify(payload), payload, signatureV2: signature, timestamp: "1" })).toBe(false);
  });

  it("creates a hosted session without sending identity evidence", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const session = await createDiditSession({
      apiKey: "key",
      workflowId: "workflow",
      vendorData: "user-1",
      callbackUrl: "https://app.example/account",
      contactDetails: { email: "person@example.com", phone: "+27821234567" },
      fetcher: async (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify({ session_id: "session-1", session_kind: "user", url: "https://verification.didit.me/session-1", status: "Not Started", workflow_id: "workflow", vendor_data: "user-1" }), { status: 201, headers: { "Content-Type": "application/json" } });
      },
    });
    expect(session.sessionId).toBe("session-1");
    expect(calls[0]?.init?.headers).toMatchObject({ "x-api-key": "key" });
  });
});
