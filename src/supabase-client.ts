import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: { url: string; key: string; client: SupabaseClient } | undefined;

/**
 * Keep one GoTrue client per browser context. Multiple clients using the same
 * Supabase storage key can race during token refresh and session recovery.
 */
export function getSupabaseClient(url: string, key: string): SupabaseClient {
  const normalizedUrl = url.trim().replace(/\/+$/, "");
  const normalizedKey = key.trim();
  if (cached?.url === normalizedUrl && cached.key === normalizedKey) return cached.client;
  const client = createClient(normalizedUrl, normalizedKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  cached = { url: normalizedUrl, key: normalizedKey, client };
  return client;
}
