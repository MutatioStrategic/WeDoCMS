import { describe, expect, it, vi } from "vitest";
import { applicationRoleFromClaims, enrichExternalIdentity, identityDisplayNameForClaims, identityEmailForClaims, isDemoEnvironment, responseWithSession, roleForNewAccount, sessionTokenFromRequest, verifyExternalJwt, verifyExternalJwtWithProvider } from "./auth";

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
  it("only enables demo authentication in the explicit demo environment", () => {
    expect(isDemoEnvironment({ APP_ENV: "demo", DEMO_AUTH_ENABLED: "true" })).toBe(true);
    expect(isDemoEnvironment({ APP_ENV: "development", DEMO_AUTH_ENABLED: "true" })).toBe(false);
    expect(isDemoEnvironment({ APP_ENV: "production", DEMO_AUTH_ENABLED: "true" })).toBe(false);
  });

  it("keeps production session cookies host-scoped when no cookie domain is configured", () => {
    const response = responseWithSession(new Response("ok"), "session.token", { APP_ENV: "production" } as never);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
  });

  it("keeps the active session host-scoped when a legacy dashboard cookie domain remains", () => {
    const response = responseWithSession(new Response("ok"), "session.token", { APP_ENV: "production", AUTH_COOKIE_DOMAIN: "veld-archive.pages.dev" } as never);
    const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [response.headers.get("Set-Cookie") ?? ""];
    const activeCookie = cookies.find((cookie) => cookie.includes("va_session=session.token")) ?? "";
    const legacyExpiry = cookies.find((cookie) => cookie.includes("Domain=veld-archive.pages.dev")) ?? "";
    expect(activeCookie).toContain("Secure");
    expect(activeCookie).not.toContain("Domain=");
    expect(legacyExpiry).toContain("Max-Age=0");
  });

  it("keeps local demo sessions usable on plain HTTP across browser engines", () => {
    const response = responseWithSession(new Response("ok"), "session.token", { APP_ENV: "demo", APP_PUBLIC_URL: "http://127.0.0.1:8788" } as never);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("allows a new buyer identity to enroll as a seller without escalating privileged roles", () => {
    expect(roleForNewAccount("buyer", "seller")).toBe("contributor");
    expect(roleForNewAccount("buyer")).toBe("buyer");
    expect(roleForNewAccount("editor", "seller")).toBe("editor");
    expect(roleForNewAccount("admin", "seller")).toBe("admin");
  });

  it("derives a stable internal contact for verified phone-only identities", async () => {
    const claims = { sub: "phone-user", phone: "+27821234567", user_metadata: { display_name: "Phone Seller" } } as never;
    const email = await identityEmailForClaims(claims);
    expect(email).toMatch(/^phone-[a-f0-9]{64}@identity\.invalid$/);
    expect(email).not.toContain("27821234567");
    expect(identityDisplayNameForClaims(claims)).toBe("Phone Seller");
  });

  it("rejects a Supabase phone identity outside South Africa", async () => {
    const secret = "test-secret-that-is-long-enough-for-auth";
    const header = encode({ alg: "HS256", typ: "JWT" });
    const payload = encode({ sub: "foreign-phone-user", phone: "+14155550123", exp: Math.floor(Date.now() / 1000) + 60 });
    const signingInput = `${header}.${payload}`;
    const token = `${signingInput}.${await sign(secret, signingInput)}`;
    await expect(verifyExternalJwtWithProvider({ AUTH_PROVIDER: "supabase", SUPABASE_JWT_SECRET: secret } as never, token)).resolves.toBeNull();
  });

  it("falls back to Supabase Auth validation for legacy signing while preserving the South African phone boundary", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "supabase-user-1",
        email: "person@example.com",
        phone: "+27821234567",
        email_confirmed_at: "2026-08-20T10:00:00.000Z",
        user_metadata: { display_name: "Example Person" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "supabase-user-2",
        phone: "+14155550123",
        email_confirmed_at: "2026-08-20T10:00:00.000Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const env = { AUTH_PROVIDER: "supabase", SUPABASE_URL: "https://tenant.supabase.co", SUPABASE_ANON_KEY: "public-anon-key" } as never;
    await expect(verifyExternalJwtWithProvider(env, "header.payload.signature")).resolves.toMatchObject({ provider: "supabase", claims: { sub: "supabase-user-1", phone: "+27821234567", name: "Example Person", email_verified: true } });
    await expect(verifyExternalJwtWithProvider(env, "header.payload.signature")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://tenant.supabase.co/auth/v1/user", expect.objectContaining({ headers: expect.objectContaining({ apikey: "public-anon-key", Authorization: "Bearer header.payload.signature" }) }));
    vi.unstubAllGlobals();
  });

  it("accepts an email-only Supabase identity when the provider returns a blank phone claim", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: "supabase-email-user",
      email: "email-only@example.com",
      phone: "",
      email_confirmed_at: "2026-08-20T10:00:00.000Z",
      user_metadata: {},
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const identity = await verifyExternalJwtWithProvider(
      { AUTH_PROVIDER: "supabase", SUPABASE_URL: "https://tenant.supabase.co", SUPABASE_ANON_KEY: "public-anon-key" } as never,
      "header.payload.signature",
    );
    expect(identity).toMatchObject({ provider: "supabase", claims: { sub: "supabase-email-user", email: "email-only@example.com", email_verified: true } });
    expect(identity?.claims.phone).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("accepts native app sessions through the dedicated authorization scheme", () => {
    expect(sessionTokenFromRequest(new Request("https://api.example.test/me", { headers: { Authorization: "StockvelSession session-id.token-secret" } }))).toBe("session-id.token-secret");
    expect(sessionTokenFromRequest(new Request("https://api.example.test/me", { headers: { Authorization: "VeldSession legacy-session.token-secret" } }))).toBe("legacy-session.token-secret");
    expect(sessionTokenFromRequest(new Request("https://api.example.test/me", { headers: { Authorization: "Bearer external.jwt.token" } }))).toBeNull();
    expect(sessionTokenFromRequest(new Request("https://api.example.test/me", { headers: { Cookie: "va_session=cookie-session.token", Authorization: "StockvelSession header-session.token" } }))).toBe("cookie-session.token");
  });

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
    await expect(verifyExternalJwt({ AUTH_JWKS_URL: "https://tenant.example/.well-known/jwks.json", AUTH_ISSUER: "https://tenant.example/" } as never, `${signingInput}.${encodedSignature}`)).resolves.toBeNull();
    await expect(verifyExternalJwt({ AUTH_JWKS_URL: "https://tenant.example/.well-known/jwks.json", AUTH_ISSUER: "https://tenant.example/", AUTH_AUDIENCE: "https://api.example" } as never, `${signingInput}.${encodedSignature}`)).resolves.toMatchObject({ sub: "auth0|user-1", org_id: "org_auth0" });
    const claims = await verifyExternalJwt({ AUTH_JWKS_URL: "https://tenant.example/.well-known/jwks.json", AUTH_ISSUER: "https://tenant.example/", AUTH_AUDIENCE: "https://api.example" } as never, `${signingInput}.${encodedSignature}`);
    expect(claims).not.toBeNull();
    expect(applicationRoleFromClaims(claims!, {} as never)).toBe("editor");
    const supabaseIdentity = await verifyExternalJwtWithProvider({ AUTH_PROVIDER: "supabase", SUPABASE_JWKS_URL: "https://supabase.example/auth/v1/.well-known/jwks.json", SUPABASE_ISSUER: "https://tenant.example/", SUPABASE_AUDIENCE: "https://api.example" } as never, `${signingInput}.${encodedSignature}`);
    expect(supabaseIdentity?.provider).toBe("supabase");
    vi.unstubAllGlobals();
  });

  it("resolves Auth0 profile and verified-email claims through UserInfo", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sub: "auth0|user-1", email: "person@example.com", email_verified: true, name: "Example Person" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const identity = await enrichExternalIdentity(
      { AUTH_ISSUER: "https://tenant.example/" } as never,
      "access-token",
      { provider: "auth0", claims: { sub: "auth0|user-1" } },
    );
    expect(identity?.claims).toMatchObject({ email: "person@example.com", email_verified: true, name: "Example Person" });
    expect(fetchMock).toHaveBeenCalledWith("https://tenant.example/userinfo", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer access-token" }) }));
    vi.unstubAllGlobals();
  });

  it("requires a configured JWT secret instead of accepting unsigned identity claims", async () => {
    const header = encode({ alg: "none", typ: "JWT" });
    const payload = encode({ sub: "untrusted-user", role: "admin" });
    await expect(verifyExternalJwt({ APP_ENV: "production" } as never, `${header}.${payload}.`)).resolves.toBeNull();
  });
});
