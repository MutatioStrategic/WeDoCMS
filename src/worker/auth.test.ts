import { describe, expect, it } from "vitest";
import { verifyExternalJwt } from "./auth";

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

describe("verified identity exchange", () => {
  it("accepts a valid HS256 identity token and rejects a tampered token", async () => {
    const secret = "test-secret-that-is-long-enough-for-auth";
    const header = encode({ alg: "HS256", typ: "JWT" });
    const payload = encode({ sub: "idp-user-1", email: "person@example.com", org_id: "org-1", exp: Math.floor(Date.now() / 1000) + 60 });
    const signingInput = `${header}.${payload}`;
    const token = `${signingInput}.${await sign(secret, signingInput)}`;
    await expect(verifyExternalJwt({ AUTH_JWT_SECRET: secret } as never, token)).resolves.toMatchObject({ sub: "idp-user-1", org_id: "org-1" });
    await expect(verifyExternalJwt({ AUTH_JWT_SECRET: secret } as never, `${token}tampered`)).resolves.toBeNull();
  });
});
