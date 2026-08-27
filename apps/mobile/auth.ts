import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock, type Session } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import "react-native-url-polyfill/auto";
import { friendlySupabasePhoneError, normalizeSouthAfricanPhone } from "../../src/phone";
import { friendlySupabaseAuthError } from "../../src/supabase-auth";

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
const ACCOUNT_INTENT_STORAGE_KEY = "veld.mobile.account-intent.v1";
const SUPABASE_EMAIL_REDIRECT_URL = "veldarchive://auth/confirmed";
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

type AccountIntent = "buyer" | "seller";

function normalizedPhone(phone: string): string {
  return normalizeSouthAfricanPhone(phone);
}

async function persistAccountIntent(intent: AccountIntent | null): Promise<void> {
  if (Platform.OS === "web") {
    if (intent) globalThis.localStorage?.setItem(ACCOUNT_INTENT_STORAGE_KEY, intent);
    else globalThis.localStorage?.removeItem(ACCOUNT_INTENT_STORAGE_KEY);
    return;
  }
  if (intent) await AsyncStorage.setItem(ACCOUNT_INTENT_STORAGE_KEY, intent);
  else await AsyncStorage.removeItem(ACCOUNT_INTENT_STORAGE_KEY);
}

async function readAccountIntent(): Promise<AccountIntent | undefined> {
  const value = Platform.OS === "web"
    ? globalThis.localStorage?.getItem(ACCOUNT_INTENT_STORAGE_KEY)
    : await AsyncStorage.getItem(ACCOUNT_INTENT_STORAGE_KEY);
  return value === "seller" || value === "buyer" ? value : undefined;
}

async function exchangeSupabaseSession(apiBaseUrl: string, identitySession: Session, accountIntent?: AccountIntent): Promise<MobileApiSession> {
  const response = await fetch(`${apiBaseUrl}/api/auth/exchange`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${identitySession.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionTransport: "bearer", ...(accountIntent === "seller" ? { accountIntent: "seller" } : {}) }),
  });
  const body = await response.json().catch(() => null) as ExchangeResponse | null;
  if (!response.ok || !body?.authenticated || !body.sessionToken || !body.csrfToken || !body.expiresAt || !body.user) {
    throw new Error(body?.error ?? "The contributor session could not be created.");
  }
  const session = body as MobileApiSession;
  await persistSession(session);
  await persistAccountIntent(null);
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
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const recoveryPending = useRef(false);

  const adoptIdentitySession = useCallback(async (identitySession: Session, accountIntent?: AccountIntent) => {
    const next = await exchangeSupabaseSession(apiBaseUrl, identitySession, accountIntent);
    setSession(next);
    setError(null);
    return next;
  }, [apiBaseUrl]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        const openedForRecovery = initialUrl?.startsWith("veldarchive://auth/recovery") ?? false;
        if (openedForRecovery) {
          recoveryPending.current = true;
          if (active) setPasswordRecovery(true);
        }
        const restored = openedForRecovery ? null : await restoreApiSession(apiBaseUrl);
        if (restored) {
          if (active) setSession(restored);
          return;
        }
        const identitySession = (await supabase?.auth.getSession())?.data.session;
        if (identitySession && !recoveryPending.current) {
          const next = await exchangeSupabaseSession(apiBaseUrl, identitySession, await readAccountIntent());
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
      if (event === "PASSWORD_RECOVERY") {
        recoveryPending.current = true;
        if (active) setPasswordRecovery(true);
        return;
      }
      if ((event === "TOKEN_REFRESHED" || event === "USER_UPDATED") && identitySession && !recoveryPending.current) {
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

    const handleAuthLink = async (url: string | null) => {
      if (!url || !supabase || !(url.startsWith("veldarchive://auth/confirmed") || url.startsWith("veldarchive://auth/recovery"))) return;
      const isRecovery = url.startsWith("veldarchive://auth/recovery");
      try {
        const normalized = url.replace("#", "?");
        const parameters = new URL(normalized).searchParams;
        const code = parameters.get("code");
        let identitySession: Session | null = null;
        if (code) {
          const result = await supabase.auth.exchangeCodeForSession(code);
          if (result.error) throw result.error;
          identitySession = result.data.session;
        } else {
          const accessToken = parameters.get("access_token");
          const refreshToken = parameters.get("refresh_token");
          if (accessToken && refreshToken) {
            const result = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            if (result.error) throw result.error;
            identitySession = result.data.session;
          }
        }
        if (identitySession && isRecovery) {
          recoveryPending.current = true;
          if (active) setPasswordRecovery(true);
          return;
        }
        if (identitySession) {
          const next = await exchangeSupabaseSession(apiBaseUrl, identitySession, await readAccountIntent());
          if (active) { setSession(next); setError(null); }
        }
      } catch (linkError) {
        if (active) setError(linkError instanceof Error ? linkError.message : "Email confirmation could not be completed.");
      }
    };
    void Linking.getInitialURL().then(handleAuthLink);
    const linkSubscription = Linking.addEventListener("url", ({ url }) => { void handleAuthLink(url); });

    return () => {
      active = false;
      authSubscription?.unsubscribe();
      appStateSubscription?.remove();
      linkSubscription.remove();
    };
  }, [apiBaseUrl]);

  const signIn = useCallback(async (email: string, password: string, accountIntent?: AccountIntent) => {
    if (!supabase) throw new Error("Supabase authentication is not configured for this build.");
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (!result.data.session) throw new Error("Confirm your email before signing in.");
      return await adoptIdentitySession(result.data.session, accountIntent);
    } catch (signInError) {
      const message = friendlySupabaseAuthError(signInError, "signin");
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, [adoptIdentitySession]);

  const signUp = useCallback(async (email: string, password: string, displayName: string, accountIntent: AccountIntent = "buyer") => {
    if (!supabase) throw new Error("Supabase authentication is not configured for this build.");
    setLoading(true);
    setError(null);
    await persistAccountIntent(accountIntent);
    try {
      const result = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: SUPABASE_EMAIL_REDIRECT_URL,
          data: { display_name: displayName.trim() || email.trim().split("@")[0], account_intent: accountIntent },
        },
      });
      if (result.error) throw result.error;
      if (result.data.session) {
        await adoptIdentitySession(result.data.session, accountIntent);
        return { confirmationRequired: false };
      }
      return { confirmationRequired: true };
    } catch (signUpError) {
      await persistAccountIntent(null);
      const message = friendlySupabaseAuthError(signUpError, "signup");
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, [adoptIdentitySession]);

  const resendSignupConfirmation = useCallback(async (email: string) => {
    if (!supabase) throw new Error("Supabase authentication is not configured for this build.");
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: SUPABASE_EMAIL_REDIRECT_URL } });
      if (result.error) throw result.error;
    } catch (resendError) {
      const message = friendlySupabaseAuthError(resendError, "resend");
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error("Supabase authentication is not configured for this build.");
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: "veldarchive://auth/recovery" });
      if (result.error) throw result.error;
    } catch (resetError) {
      const message = friendlySupabaseAuthError(resetError, "reset");
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error("Supabase authentication is not configured for this build.");
    if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.updateUser({ password });
      if (result.error) throw result.error;
      await supabase.auth.signOut();
      await persistSession(null);
      recoveryPending.current = false;
      setPasswordRecovery(false);
      setSession(null);
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "The password could not be updated.";
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const sendPhoneCode = useCallback(async (phone: string, shouldCreateUser: boolean, accountIntent: AccountIntent = "seller") => {
    if (!supabase) throw new Error("Supabase authentication is not configured for this build.");
    const value = normalizedPhone(phone);
    setLoading(true);
    setError(null);
    await persistAccountIntent(accountIntent);
    try {
      const result = await supabase.auth.signInWithOtp({ phone: value, options: { shouldCreateUser } });
      if (result.error) throw result.error;
      return { phone: value };
    } catch (phoneError) {
      await persistAccountIntent(null);
      const message = friendlySupabasePhoneError(phoneError, "send");
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyPhoneCode = useCallback(async (phone: string, token: string, displayName = "", accountIntent: AccountIntent = "seller") => {
    if (!supabase) throw new Error("Supabase authentication is not configured for this build.");
    const value = normalizedPhone(phone);
    if (!/^\d{6}$/.test(token.trim())) throw new Error("Enter the 6-digit SMS code.");
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.verifyOtp({ phone: value, token: token.trim(), type: "sms" });
      if (result.error) throw result.error;
      if (!result.data.session) throw new Error("The SMS code was accepted, but no session was created.");
      if (displayName.trim()) {
        const updated = await supabase.auth.updateUser({ data: { display_name: displayName.trim() } });
        if (updated.error) throw updated.error;
      }
      const current = (await supabase.auth.getSession()).data.session ?? result.data.session;
      return await adoptIdentitySession(current, accountIntent);
    } catch (phoneError) {
      const message = friendlySupabasePhoneError(phoneError, "verify");
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

  return { configured: mobileAuthConfigured, error, loading, passwordRecovery, requestPasswordReset, resendSignupConfirmation, updatePassword, session, sendPhoneCode, signIn, signOut, signUp, verifyPhoneCode };
}
