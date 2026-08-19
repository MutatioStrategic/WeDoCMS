import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock, type Session } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import "react-native-url-polyfill/auto";

declare const process: {
  env: {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  };
};

export type MobileUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  organizationId: string;
  organizationName: string;
};

export type MobileApiSession = {
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
  user: MobileUser;
};

type StoredSession = Pick<MobileApiSession, "sessionToken" | "csrfToken" | "expiresAt">;
type ExchangeResponse = Partial<MobileApiSession> & { authenticated?: boolean; error?: string };

const SESSION_STORAGE_KEY = "veld.mobile.api-session.v1";
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)?.trim() ?? "";

export const mobileAuthConfigured = Boolean(supabaseUrl && supabasePublishableKey && !supabasePublishableKey.startsWith("replace-"));

export const supabase = mobileAuthConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        ...(Platform.OS === "web" ? {} : { storage: AsyncStorage }),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        lock: processLock,
      },
    })
  : null;

async function persistSession(session: MobileApiSession | null): Promise<void> {
  if (!session) {
    if (Platform.OS === "web") globalThis.localStorage?.removeItem(SESSION_STORAGE_KEY);
    else await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
    return;
  }
  const stored: StoredSession = {
    sessionToken: session.sessionToken,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  };
  const value = JSON.stringify(stored);
  if (Platform.OS === "web") globalThis.localStorage?.setItem(SESSION_STORAGE_KEY, value);
  else await SecureStore.setItemAsync(SESSION_STORAGE_KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

async function readStoredSession(): Promise<StoredSession | null> {
  try {
    const value = Platform.OS === "web"
      ? globalThis.localStorage?.getItem(SESSION_STORAGE_KEY) ?? null
      : await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredSession>;
    if (typeof parsed.sessionToken !== "string" || typeof parsed.csrfToken !== "string" || typeof parsed.expiresAt !== "string") return null;
    if (Date.parse(parsed.expiresAt) <= Date.now()) return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function mobileSessionHeaders(session: MobileApiSession): Record<string, string> {
  return {
    Authorization: `VeldSession ${session.sessionToken}`,
    "X-CSRF-Token": session.csrfToken,
  };
}

async function exchangeSupabaseSession(apiBaseUrl: string, identitySession: Session): Promise<MobileApiSession> {
  const response = await fetch(`${apiBaseUrl}/api/auth/exchange`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${identitySession.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionTransport: "bearer" }),
  });
  const body = await response.json().catch(() => null) as ExchangeResponse | null;
  if (!response.ok || !body?.authenticated || !body.sessionToken || !body.csrfToken || !body.expiresAt || !body.user) {
    throw new Error(body?.error ?? "The contributor session could not be created.");
  }
  const session = body as MobileApiSession;
  await persistSession(session);
  return session;
}

async function restoreApiSession(apiBaseUrl: string): Promise<MobileApiSession | null> {
  const stored = await readStoredSession();
  if (!stored) return null;
  const response = await fetch(`${apiBaseUrl}/api/me`, {
    headers: { Accept: "application/json", Authorization: `VeldSession ${stored.sessionToken}` },
  });
  const body = await response.json().catch(() => null) as { authenticated?: boolean; user?: MobileUser } | null;
  if (!response.ok || !body?.authenticated || !body.user) {
    await persistSession(null);
    return null;
  }
  return { ...stored, user: body.user };
}

export function useMobileAuth(apiBaseUrl: string) {
  const [session, setSession] = useState<MobileApiSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const adoptIdentitySession = useCallback(async (identitySession: Session) => {
    const next = await exchangeSupabaseSession(apiBaseUrl, identitySession);
    setSession(next);
    setError(null);
    return next;
  }, [apiBaseUrl]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const restored = await restoreApiSession(apiBaseUrl);
        if (restored) {
          if (active) setSession(restored);
          return;
        }
        const identitySession = (await supabase?.auth.getSession())?.data.session;
        if (identitySession) {
          const next = await exchangeSupabaseSession(apiBaseUrl, identitySession);
          if (active) setSession(next);
        }
      } catch (restoreError) {
        if (active) setError(restoreError instanceof Error ? restoreError.message : "Contributor sign-in could not be restored.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    const authSubscription = supabase?.auth.onAuthStateChange((event, identitySession) => {
      if (event === "SIGNED_OUT") {
        void persistSession(null);
        if (active) setSession(null);
        return;
      }
      if ((event === "TOKEN_REFRESHED" || event === "USER_UPDATED") && identitySession) {
        void exchangeSupabaseSession(apiBaseUrl, identitySession).then((next) => {
          if (active) setSession(next);
        }).catch((exchangeError) => {
          if (active) setError(exchangeError instanceof Error ? exchangeError.message : "Contributor session refresh failed.");
        });
      }
    }).data.subscription;

    const appStateSubscription = Platform.OS === "web" || !supabase ? null : AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });

    return () => {
      active = false;
      authSubscription?.unsubscribe();
      appStateSubscription?.remove();
    };
  }, [apiBaseUrl]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error("Supabase authentication is not configured for this build.");
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (!result.data.session) throw new Error("Confirm your email before signing in.");
      return await adoptIdentitySession(result.data.session);
    } catch (signInError) {
      const message = signInError instanceof Error ? signInError.message : "Sign-in failed.";
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, [adoptIdentitySession]);

  const signOut = useCallback(async () => {
    const current = session;
    setLoading(true);
    try {
      if (current) {
        await fetch(`${apiBaseUrl}/api/auth/logout`, {
          method: "POST",
          headers: { Accept: "application/json", ...mobileSessionHeaders(current) },
        }).catch(() => null);
      }
      await supabase?.auth.signOut();
      await persistSession(null);
      setSession(null);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, session]);

  return { configured: mobileAuthConfigured, error, loading, session, signIn, signOut };
}
