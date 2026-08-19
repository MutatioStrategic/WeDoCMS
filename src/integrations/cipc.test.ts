import { describe, expect, it } from "vitest";
import { CipcLookupAdapter } from "./cipc";

describe("CipcLookupAdapter", () => {
  it("normalizes a verified registration without retaining provider payload fields", async () => {
    let request: Request | undefined;
    const adapter = new CipcLookupAdapter({ endpoint: "https://cipc.example/lookup", token: "secret", fetcher: async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ registrationNumber: "2026/123", registeredName: "Archive Pty Ltd", verified: true, providerReference: "lookup-1", directors: [{ idNumber: "sensitive" }] }));
    } });
    await expect(adapter.lookup("2026/123")).resolves.toEqual({ registrationNumber: "2026/123", registeredName: "Archive Pty Ltd", verified: true, providerReference: "lookup-1", status: undefined });
    expect(request?.headers.get("Authorization")).toBe("Bearer secret");
  });
});
