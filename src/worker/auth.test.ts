import { describe, expect, it, vi } from "vitest";
import { applicationRoleFromClaims, verifyExternalJwt } from "./auth";

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

  it("accepts an Auth0-style RS256 token from the configured JWKS", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const header = encode({ alg: "RS256", typ: "JWT", kid: "auth0-key-1" });
    const payload = encode({ sub: "auth0|user-1", email: "person@example.com", org_id: "org_auth0", iss: "https://tenant.example/", aud: "https://api.example", roles: ["editor"], exp: Math.floor(Date.now() / 1000) + 60 });
    const signingInput = `${header}.${payload}`;
    const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signingInput)));
    let binary = "";
    for (const byte of signature) binary += String.fromCharCode(byte);
    const encodedSignature = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "auth0-key-1" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(verifyExternalJwt({ AUTH_JWKS_URL: "https://tenant.example/.well-known/jwks.json", AUTH_ISSUER: "https://tenant.example/", AUTH_AUDIENCE: "https://api.example" } as never, `${signingInput}.${encodedSignature}`)).resolves.toMatchObject({ sub: "auth0|user-1", org_id: "org_auth0" });
    const claims = await verifyExternalJwt({ AUTH_JWKS_URL: "https://tenant.example/.well-known/jwks.json", AUTH_ISSUER: "https://tenant.example/", AUTH_AUDIENCE: "https://api.example" } as never, `${signingInput}.${encodedSignature}`);
    expect(claims).not.toBeNull();
    expect(applicationRoleFromClaims(claims!, {} as never)).toBe("editor");
    vi.unstubAllGlobals();
  });
});
