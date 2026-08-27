import { describe, expect, it } from "vitest";
import { isSupabasePublicKey, publicAuthConfig } from "./index";

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

describe("Worker-owned Supabase auth configuration", () => {
  it("accepts publishable keys and anon JWTs but rejects service-role-shaped keys", () => {
    expect(isSupabasePublicKey("sb_publishable_contract-test")).toBe(true);
    expect(isSupabasePublicKey(`header.${encode({ role: "anon" })}.signature`)).toBe(true);
    expect(isSupabasePublicKey(`header.${encode({ role: "service_role" })}.signature`)).toBe(false);
    expect(isSupabasePublicKey("service-role-secret")).toBe(false);
  });

  it("returns runtime Supabase configuration without exposing configuration secrets beyond the public key", () => {
    const config = publicAuthConfig(new Request("https://archive.example.com/api/auth/config"), {
      APP_ENV: "production",
      AUTH_PROVIDER: "both",
      SUPABASE_URL: "https://tenant.supabase.co",
      SUPABASE_AUDIENCE: "authenticated",
      SUPABASE_ANON_KEY: "sb_publishable_contract-test",
      APP_PUBLIC_URL: "https://archive.example.com",
    } as never) as Record<string, unknown>;
    expect(config).toEqual({ provider: "supabase", supabaseUrl: "https://tenant.supabase.co", publishableKey: "sb_publishable_contract-test", redirectUrl: "https://archive.example.com" });
    expect(config).not.toHaveProperty("SUPABASE_AUDIENCE");
  });

  it("fails closed for missing production config and uses explicit demo auth", () => {
    expect(publicAuthConfig(new Request("https://archive.example.com/api/auth/config"), { APP_ENV: "production", AUTH_PROVIDER: "both", APP_PUBLIC_URL: "https://archive.example.com" } as never)).toMatchObject({ provider: "unavailable", reason: "identity_provider_not_configured" });
    expect(publicAuthConfig(new Request("https://demo.example.com/api/auth/config"), { APP_ENV: "demo", DEMO_AUTH_ENABLED: "true", APP_PUBLIC_URL: "https://demo.example.com" } as never)).toEqual({ provider: "demo", redirectUrl: "https://demo.example.com" });
  });
});
