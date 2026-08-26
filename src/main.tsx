import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Auth0Provider, useAuth0, type Auth0ContextInterface } from "@auth0/auth0-react";
import { createClient, type Session as SupabaseSession, type SupabaseClient } from "@supabase/supabase-js";
import { archiveDomain, type AccountLifecycle, type Asset, type BuyerAnalytics, type CommunityOverview, type ContributorAnalytics, type ContributorPerformance, type CreatorProfile, type DiscoveryResponse, type LicenceProduct, type LicenceType, type MonetizationModel, type PortfolioCollection, type SavedSearch, type SearchResponse, type TakedownReason, type UserLightbox, type WorkflowStage } from "./shared";
import { friendlySupabasePhoneError } from "./phone";
import "./styles.css";
import { CommunityWorkspace } from "./community";
import { StudioWorkspace } from "./studio";
import { RightsGuide } from "./rights-guide";
import { StakeholderDiagrams } from "./stakeholder-diagrams";
import { WordPressIntegrationPanel } from "./wordpress-integration";
import type { BrandKit, CampaignBrief, CampaignPlatform, CampaignRecommendation, CampaignStage } from "./campaign-intelligence";
import { cropPresets, defaultEditRecipe, derivativeForPreset, fitCrop, safeZonePercent, type CropPreset, type EditRecipe } from "./campaign-editor";
import { Icon, type IconName } from "./ui";
import { buyerAgreement, paymentDisclosure } from "./legal/agreements";

declare global {
  interface Window {
    turnstile?: { render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; "expired-callback"?: () => void }) => string; reset: (widgetId?: string) => void };
  }
}

function TurnstileChallenge({ onToken }: { onToken: (token: string) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sitekey = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? import.meta.env.VITE_TURNSTILE_SITEKEY) as string | undefined;
    if (!sitekey || sitekey.startsWith("replace-") || !ref.current || !window.turnstile) return undefined;
    const widgetId = window.turnstile.render(ref.current, { sitekey, action: "contributor-contract", callback: onToken, "expired-callback": () => onToken("") });
    return () => { window.turnstile?.reset(widgetId); };
  }, [onToken]);
  return <div ref={ref} aria-label="Bot protection challenge" />;
}

type View = "explore" | "search" | "campaigns" | "contributors" | "contributor" | "buyer" | "review" | "governance" | "community" | "account" | "studio" | "rights" | "stakeholders" | "wordpress";
type SidebarSection = { label: string; items: Array<{ view: View; label: string; icon: IconName; badge?: string }> };
const gatedViews = new Set<View>(["campaigns", "contributor", "buyer", "review", "governance", "account", "studio", "wordpress"]);
const sidebarSections: SidebarSection[] = [
  { label: "Discover", items: [{ view: "explore", label: "Explore archive", icon: "compass" }, { view: "search", label: "Search workbench", icon: "search" }, { view: "community", label: "Community", icon: "users" }] },
  { label: "Workspaces", items: [{ view: "campaigns", label: "Campaign intelligence", icon: "sparkles", badge: "3A" }, { view: "studio", label: "Media studio", icon: "image" }, { view: "contributors", label: "Creator marketplace", icon: "briefcase" }, { view: "buyer", label: "Buyer ROI", icon: "grid" }] },
  { label: "Operations", items: [{ view: "contributor", label: "Contributor insights", icon: "layout" }, { view: "review", label: "Editorial review", icon: "shield" }, { view: "governance", label: "Governance", icon: "workflow" }, { view: "wordpress", label: "WordPress", icon: "settings" }] },
  { label: "Reference", items: [{ view: "rights", label: "Rights guide", icon: "shield" }, { view: "stakeholders", label: "System overview", icon: "layout" }, { view: "account", label: "Account", icon: "settings" }] },
];
type SessionUser = { id: string; email: string; displayName: string; role: string; organizationId: string; organizationName: string };
type AppNotification = { id: string; type: string; title: string; body: string; resource_type?: string | null; resource_id?: string | null; read_at?: string | null; created_at: string };
type Auth0Bridge = Pick<Auth0ContextInterface, "isAuthenticated" | "isLoading" | "getAccessTokenSilently" | "loginWithRedirect" | "logout">;
type SupabaseAuthMode = "signin" | "signup" | "forgot" | "reset";
type DemoRole = "buyer" | "contributor" | "editor" | "admin";

function canAccessView(view: View, role: string | undefined, authenticated: boolean): boolean {
  if (!gatedViews.has(view)) return true;
  if (!authenticated) return false;
  if (role === "admin") return true;
  if (view === "account") return true;
  if (view === "campaigns" || view === "buyer" || view === "studio") return role === "buyer";
  if (view === "contributor") return role === "contributor" || role === "editor";
  if (view === "review" || view === "governance" || view === "wordpress") return role === "editor";
  return false;
}

const auth0Domain = (import.meta.env.VITE_AUTH0_DOMAIN as string | undefined)?.trim();
const auth0ClientId = (import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined)?.trim();
const auth0Audience = (import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined)?.trim();
const auth0Organization = (import.meta.env.VITE_AUTH0_ORGANIZATION as string | undefined)?.trim();
const configuredValue = (value: string | undefined): value is string => Boolean(value && !value.startsWith("replace-") && !value.startsWith("your-"));
const auth0Configured = configuredValue(auth0Domain) && configuredValue(auth0ClientId);
const auth0Scopes = "openid profile email";
const demoMode = import.meta.env.MODE === "demo" || import.meta.env.VITE_DEMO_MODE === "true";
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseKey = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined))?.trim();
const supabaseConfigured = configuredValue(supabaseUrl) && configuredValue(supabaseKey);
const supabaseClient: SupabaseClient | undefined = supabaseConfigured ? createClient(supabaseUrl!, supabaseKey!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : undefined;
const emptyDiscovery: DiscoveryResponse = { trending: [], savedSearches: [], recommendations: [], personalized: false };
const recoveryLinkPresent = (): boolean => typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("passwordRecovery") === "1" || /(?:^|&)type=recovery(?:&|$)/.test(window.location.hash.replace(/^#/, "")));

function App({ auth0, supabase }: { auth0?: Auth0Bridge; supabase?: SupabaseClient }) {
  const [view, setView] = useState<View>(() => window.location.pathname === "/account" ? "account" : window.location.pathname.startsWith("/creators") ? "contributors" : "explore");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [searchRequestId, setSearchRequestId] = useState(0);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [sort, setSort] = useState<"relevance" | "newest" | "popular" | "random">("relevance");
  const [orientation, setOrientation] = useState<"all" | "landscape" | "portrait" | "square">("all");
  const [notice, setNotice] = useState("Live archive results are loaded from the verified content service.");
  const [reviewItems, setReviewItems] = useState<Asset[]>([]);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [lightboxes, setLightboxes] = useState<UserLightbox[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryResponse>(emptyDiscovery);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pendingAssetId, setPendingAssetId] = useState(() => new URLSearchParams(window.location.search).get("asset"));
  const [pendingAssetPurchase, setPendingAssetPurchase] = useState(() => new URLSearchParams(window.location.search).get("purchase") === "1");
  const assetRestoreAttempted = React.useRef(false);
  const [devRole, setDevRole] = useState<DemoRole>("buyer");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [supabaseAuthOpen, setSupabaseAuthOpen] = useState(recoveryLinkPresent);
  const [supabaseAuthMode, setSupabaseAuthMode] = useState<SupabaseAuthMode>(() => recoveryLinkPresent() ? "reset" : "signin");
  const [supabaseAuthMethod, setSupabaseAuthMethod] = useState<"email" | "phone">("email");
  const [supabaseAccountIntent, setSupabaseAccountIntent] = useState<"buyer" | "seller">("buyer");
  const [supabaseEmail, setSupabaseEmail] = useState("");
  const [supabasePassword, setSupabasePassword] = useState("");
  const [supabasePasswordConfirmation, setSupabasePasswordConfirmation] = useState("");
  const [supabasePhone, setSupabasePhone] = useState("");
  const [supabasePhoneCode, setSupabasePhoneCode] = useState("");
  const [supabasePhoneCodeSent, setSupabasePhoneCodeSent] = useState(false);
  const [supabaseDisplayName, setSupabaseDisplayName] = useState("");
  const [supabaseAuthBusy, setSupabaseAuthBusy] = useState(false);
  const [supabaseAuthMessage, setSupabaseAuthMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const authExchangeAttempted = React.useRef(false);
  const supabaseExchangeAttempted = React.useRef(false);
  const supabaseRecoveryPending = React.useRef(recoveryLinkPresent());
  const supabaseAccountIntentRef = React.useRef<"buyer" | "seller">("buyer");

  const api = useCallback((path: string, init: RequestInit = {}) => fetch(path, { ...init, credentials: "include", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}), ...(init.headers ?? {}) } }), [csrfToken]);

  useEffect(() => {
    void fetch("/api/auth/session", { credentials: "include" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { authenticated: boolean; user?: SessionUser; csrfToken?: string };
      if (data.authenticated && data.user) { setSessionUser(data.user); setCsrfToken(data.csrfToken ?? ""); }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!auth0 || auth0.isLoading) return undefined;
    if (!auth0.isAuthenticated) {
      authExchangeAttempted.current = false;
      return undefined;
    }
    if (authExchangeAttempted.current) return undefined;
    authExchangeAttempted.current = true;
    let active = true;
    void auth0.getAccessTokenSilently({ authorizationParams: { scope: auth0Scopes, ...(auth0Audience ? { audience: auth0Audience } : {}) } })
      .then((token) => fetch("/api/auth/exchange", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...(auth0Organization ? { organizationId: auth0Organization } : {}), ...(window.sessionStorage.getItem("veld.account-intent") === "seller" ? { accountIntent: "seller" } : {}) }),
      }))
      .then(async (response) => {
        if (!response.ok) throw new Error("Identity exchange failed");
        return response.json() as Promise<{ user: SessionUser; csrfToken: string }>;
      })
      .then((data) => {
        if (!active) return;
        setSessionUser(data.user);
        setCsrfToken(data.csrfToken);
        if (data.user.role === "contributor") setView("contributor");
        window.sessionStorage.removeItem("veld.account-intent");
        setNotice(`Signed in to ${data.user.organizationName}.`);
      })
      .catch(() => {
        authExchangeAttempted.current = false;
        if (active) setNotice("Your identity could not be connected to a provisioned organisation.");
      });
    return () => { active = false; };
  }, [auth0?.getAccessTokenSilently, auth0?.isAuthenticated, auth0?.isLoading]);

  const exchangeSupabaseSession = useCallback(async (session: SupabaseSession | null): Promise<void> => {
    if (!session?.access_token || supabaseExchangeAttempted.current) return;
    supabaseExchangeAttempted.current = true;
    try {
      const accountIntent = window.sessionStorage.getItem("veld.account-intent") === "seller" || supabaseAccountIntentRef.current === "seller" ? "seller" : undefined;
      const response = await fetch("/api/auth/exchange", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(accountIntent ? { accountIntent } : {}) });
      if (!response.ok) throw new Error("Identity exchange failed");
      const data = await response.json() as { user: SessionUser; csrfToken: string };
      setSessionUser(data.user);
      setCsrfToken(data.csrfToken);
      if (accountIntent === "seller" || data.user.role === "contributor") setView("contributor");
      window.sessionStorage.removeItem("veld.account-intent");
      supabaseAccountIntentRef.current = "buyer";
      setSupabaseAccountIntent("buyer");
      setSupabaseAuthOpen(false);
      setSupabasePassword("");
      setSupabaseAuthMessage(null);
      setNotice(`Signed in to ${data.user.organizationName} with Supabase.`);
    } catch {
      supabaseExchangeAttempted.current = false;
      setSupabaseAuthMessage({ tone: "error", text: "Supabase accepted the sign-in, but Veld could not connect this account to an organisation. Ask an administrator to provision it." });
      setNotice("Supabase sign-in succeeded, but this account is not connected to a provisioned organisation.");
    }
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    if (!supabaseRecoveryPending.current) void supabase.auth.getSession().then(({ data }) => { if (active) void exchangeSupabaseSession(data.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        supabaseRecoveryPending.current = true;
        setSupabaseAuthOpen(true);
        setSupabaseAuthMode("reset");
        setSupabaseAuthMessage({ tone: "success", text: "Choose a new password for your archive account." });
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }
      if (event === "USER_UPDATED" && supabaseRecoveryPending.current) return;
      if (active) void exchangeSupabaseSession(session);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [exchangeSupabaseSession, supabase]);

  async function submitSupabaseAuth(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!supabase) return;
    setSupabaseAuthBusy(true);
    setSupabaseAuthMessage(null);
    try {
      if (supabaseAuthMode === "forgot") {
        const email = supabaseEmail.trim();
        if (!email) throw new Error("Enter the email address for your archive account.");
        const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/?passwordRecovery=1` });
        if (result.error) throw result.error;
        setSupabaseAuthMode("signin");
        setSupabasePassword("");
        setSupabasePasswordConfirmation("");
        setSupabaseAuthMessage({ tone: "success", text: "If an account uses that email, we sent a password reset link. Check your inbox and spam folder." });
        return;
      }
      if (supabaseAuthMode === "reset") {
        if (supabasePassword.length < 8) throw new Error("Use a password with at least 8 characters.");
        if (supabasePassword !== supabasePasswordConfirmation) throw new Error("Passwords do not match.");
        const result = await supabase.auth.updateUser({ password: supabasePassword });
        if (result.error) throw result.error;
        await supabase.auth.signOut();
        supabaseRecoveryPending.current = false;
        setSupabasePassword("");
        setSupabasePasswordConfirmation("");
        setSupabaseAuthMode("signin");
        setSupabaseAuthMessage({ tone: "success", text: "Your password has been updated. Sign in with your new password." });
        return;
      }
      if (supabaseAuthMethod === "phone") {
        const phone = archiveDomain.normalizeSouthAfricanPhone(supabasePhone);
        if (!supabasePhoneCodeSent) {
          const result = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: supabaseAuthMode === "signup" } });
          if (result.error) throw result.error;
          setSupabasePhoneCodeSent(true);
          setSupabaseAuthMessage({ tone: "success", text: "A 6-digit code was sent by SMS. Enter it here to continue." });
          return;
        }
        if (!/^\d{6}$/.test(supabasePhoneCode.trim())) throw new Error("Enter the 6-digit SMS code.");
        const result = await supabase.auth.verifyOtp({ phone, token: supabasePhoneCode.trim(), type: "sms" });
        if (result.error) throw result.error;
        if (!result.data.session) throw new Error("The SMS code was accepted, but no session was created.");
        if (supabaseDisplayName.trim()) {
          const updated = await supabase.auth.updateUser({ data: { display_name: supabaseDisplayName.trim() } });
          if (updated.error) throw updated.error;
        }
        const current = (await supabase.auth.getSession()).data.session ?? result.data.session;
        await exchangeSupabaseSession(current);
        setSupabasePhoneCode("");
        return;
      }
      const result = supabaseAuthMode === "signup"
        ? await supabase.auth.signUp({ email: supabaseEmail.trim(), password: supabasePassword, options: { emailRedirectTo: window.location.origin, data: { display_name: supabaseEmail.trim().split("@")[0] } } })
        : await supabase.auth.signInWithPassword({ email: supabaseEmail.trim(), password: supabasePassword });
      if (result.error) throw result.error;
      if (result.data.session) await exchangeSupabaseSession(result.data.session);
      else {
        setSupabaseAuthMode("signin");
        setSupabasePassword("");
        setSupabaseAuthMessage({ tone: "success", text: "Account created. Confirm your email, then sign in to claim 3 free artist-approved photo downloads before choosing a plan." });
        setNotice("Account created. Confirm your email, then sign in to claim your free photo downloads.");
      }
    } catch (error) {
      const message = supabaseAuthMethod === "phone"
        ? friendlySupabasePhoneError(error, supabasePhoneCodeSent ? "verify" : "send")
        : error instanceof Error ? error.message : "Supabase authentication failed.";
      setSupabaseAuthMessage({ tone: "error", text: message });
      setNotice(message);
    } finally {
      setSupabaseAuthBusy(false);
    }
  }

  useEffect(() => {
    if (supabaseAuthOpen && supabaseAuthMethod === "phone") {
      const phoneInput = document.querySelector<HTMLInputElement>(".auth-panel input[type='tel']");
      phoneInput?.removeAttribute("pattern");
      if (phoneInput) phoneInput.placeholder = "073 712 3456";
    }
  }, [supabaseAuthOpen, supabaseAuthMethod]);

  useEffect(() => {
    if (!sessionUser) { setLightboxes([]); return; }
    void api("/api/lightboxes").then(async (response) => {
      if (!response.ok) throw new Error("Lightboxes unavailable");
      const data = await response.json() as { results: UserLightbox[] };
      setLightboxes(data.results);
    }).catch(() => setLightboxes([]));
  }, [api, sessionUser]);

  const refreshDiscovery = useCallback(() => {
    void api("/api/discovery").then(async (response) => {
      if (!response.ok) throw new Error("Discovery unavailable");
      setDiscovery(await response.json() as DiscoveryResponse);
    }).catch(() => setDiscovery(emptyDiscovery));
  }, [api]);

  useEffect(() => { refreshDiscovery(); }, [refreshDiscovery, sessionUser, lightboxes.length]);

  useEffect(() => {
    if (!sessionUser) { setNotifications([]); return; }
    void api("/api/notifications").then(async (response) => { if (response.ok) setNotifications((await response.json() as { results: AppNotification[] }).results); }).catch(() => setNotifications([]));
  }, [api, sessionUser]);

  async function markNotificationRead(id: string): Promise<void> {
    const response = await api(`/api/notifications/${id}/read`, { method: "POST", body: "{}" });
    if (response.ok) setNotifications((current) => current.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item));
  }

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = performance.now();
    let loadingTimer: ReturnType<typeof setTimeout> | undefined;
    setAssetsLoading(true);
    const params = new URLSearchParams({ q: activeQuery, kind: filter, status: "published", sort, orientation });
    fetch(`/api/assets?${params}`, { signal: controller.signal, credentials: "include" })
      .then(async (response) => { if (!response.ok) throw new Error("API unavailable"); return response.json() as Promise<SearchResponse>; })
      .then((data) => setAssets(data.results.map((asset) => archiveDomain.withMatchExplanation(asset, activeQuery))))
      .catch(() => {
        if (controller.signal.aborted) return;
        setAssets([]);
        setNotice("The verified content service is unavailable. No fallback media is shown.");
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        const remaining = Math.max(0, 900 - (performance.now() - startedAt));
        loadingTimer = setTimeout(() => setAssetsLoading(false), remaining);
      });
    return () => { controller.abort(); if (loadingTimer) clearTimeout(loadingTimer); };
  }, [activeQuery, filter, sort, orientation, searchRequestId]);

  useEffect(() => {
    if (!pendingAssetId || selectedAsset || assetsLoading || assetRestoreAttempted.current) return;
    assetRestoreAttempted.current = true;
    const clearAssetIntent = () => {
      const params = new URLSearchParams(window.location.search);
      params.delete("asset");
      params.delete("purchase");
      const query = params.toString();
      window.history.replaceState({}, document.title, `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    };
    const listedAsset = assets.find((candidate) => candidate.id === pendingAssetId);
    if (listedAsset) {
      setSelectedAsset(listedAsset);
      clearAssetIntent();
      return;
    }
    void api(`/api/assets/${encodeURIComponent(pendingAssetId)}`).then(async (response) => {
      if (!response.ok) throw new Error("The selected asset is no longer available.");
      const restored = await response.json() as Asset;
      setSelectedAsset(archiveDomain.withMatchExplanation(restored, activeQuery));
      clearAssetIntent();
    }).catch((error) => {
      setPendingAssetPurchase(false);
      setPendingAssetId(null);
      clearAssetIntent();
      setNotice(error instanceof Error ? error.message : "The selected asset could not be restored.");
    });
  }, [activeQuery, api, assets, assetsLoading, pendingAssetId, selectedAsset]);

  async function loadReviewQueue() {
    try {
      const response = await api("/api/admin/review");
      if (!response.ok) throw new Error("Review API unavailable");
      const data = await response.json() as { results: Asset[] };
      setReviewItems(data.results);
    } catch {
      setReviewItems([]);
      setNotice("The editorial queue is unavailable. No local decisions were applied.");
    }
  }

  function chooseSupabaseAccountIntent(intent: "buyer" | "seller"): void {
    supabaseAccountIntentRef.current = intent;
    setSupabaseAccountIntent(intent);
    if (intent === "seller") window.sessionStorage.setItem("veld.account-intent", "seller");
    else window.sessionStorage.removeItem("veld.account-intent");
  }

  function navigate(nextView: View) {
    if (!canAccessView(nextView, sessionUser?.role, Boolean(sessionUser))) {
      if (!sessionUser && gatedViews.has(nextView)) {
        if (nextView === "contributor") openSellerSignUp();
        else openBuyerSignIn();
        return;
      }
      setNotice(nextView === "contributor" ? "Contributor access is required for seller tools." : nextView === "buyer" || nextView === "campaigns" || nextView === "studio" ? "Buyer access is required for this workspace." : "Editor access is required for this workspace.");
      return;
    }
    setView(nextView);
    if (nextView === "review") void loadReviewQueue();
  }

  async function devSignIn(role: DemoRole = devRole): Promise<void> {
    const endpoint = demoMode ? "/api/auth/demo-login" : "/api/auth/dev-login";
    const response = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    if (!response.ok) { setNotice(demoMode ? "The live demo session is unavailable. Check that the demo Worker and seed data are deployed." : "Local authentication is unavailable; start the local Worker and apply the identity migration first."); return; }
    const data = await response.json() as { user: SessionUser; csrfToken: string };
    setSessionUser(data.user);
    setCsrfToken(data.csrfToken);
    setDevRole(data.user.role as DemoRole);
    setNotice(demoMode ? `Demo session active as ${data.user.role}. No real account or transaction is used.` : `Signed in locally as ${data.user.role}.`);
  }

  function trackEvent(payload: Record<string, unknown>) {
    if (!analyticsConsent) return;
    void fetch("/api/analytics/events", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, consent: true }) }).catch(() => undefined);
  }

  async function createLightbox(name: string): Promise<UserLightbox | null> {
    try {
      const response = await api("/api/lightboxes", { method: "POST", body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error();
      const created = await response.json() as UserLightbox;
      setLightboxes((current) => [created, ...current]);
      return created;
    } catch {
      setNotice("That lightbox could not be created. Check its name and try again.");
      return null;
    }
  }

  async function saveToLightbox(lightboxId: string, assetId: string): Promise<boolean> {
    try {
      const response = await api(`/api/lightboxes/${lightboxId}/assets`, { method: "POST", body: JSON.stringify({ assetId }) });
      if (!response.ok) throw new Error();
      setLightboxes((current) => current.map((box) => box.id === lightboxId && !box.assetIds.includes(assetId) ? { ...box, assetIds: [...box.assetIds, assetId], assetCount: box.assetCount + 1 } : box));
      setNotice("Saved to your lightbox.");
      return true;
    } catch {
      setNotice("This asset could not be saved. Sign in and ensure the archive service is available.");
      return false;
    }
  }

  async function saveCurrentSearch(alertFrequency: SavedSearch["alertFrequency"]): Promise<void> {
    const value = activeQuery || query.trim();
    if (!sessionUser) { setNotice("Sign in to save searches and configure alerts."); return; }
    if (value.length < 2) { setNotice("Enter a search before saving it."); return; }
    const response = await api("/api/saved-searches", { method: "POST", body: JSON.stringify({ name: value.slice(0, 120), query: value, mediaKind: filter, alertFrequency }) });
    if (!response.ok) { setNotice(response.status === 409 ? "That search is already saved." : "The search could not be saved."); return; }
    setNotice(alertFrequency === "none" ? "Search saved for your next visit." : `${alertFrequency === "daily" ? "Daily" : "Weekly"} in-app alerts are on for this search.`);
    refreshDiscovery();
  }

  async function deleteSavedSearch(id: string): Promise<void> {
    const response = await api(`/api/saved-searches/${id}`, { method: "DELETE" });
    if (!response.ok) { setNotice("The saved search could not be removed."); return; }
    setNotice("Saved search removed.");
    refreshDiscovery();
  }

  function useDiscoveryQuery(value: string) {
    setQuery(value);
    setActiveQuery(value);
    setAssetsLoading(true);
    setSearchRequestId((current) => current + 1);
    setView("search");
    trackEvent({ type: "search", query: value });
    setNotice(`Searching the archive for “${value}”`);
  }

  function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    setActiveQuery(value);
    setAssetsLoading(true);
    setSearchRequestId((current) => current + 1);
    trackEvent({ type: "search", query: value });
    setView("search");
    setNotice(query.trim() ? `Searching the archive for “${query.trim()}”` : "Showing the latest verified South African media");
  }

  const verifiedCount = useMemo(() => assets.filter((asset) => asset.humanVerified).length, [assets]);
  function openAsset(asset: Asset) { setSelectedAsset(asset); trackEvent({ type: "asset_view", assetId: asset.id }); }
  function openBuyerSignIn(assetId?: string): void {
    chooseSupabaseAccountIntent("buyer");
    if (assetId) {
      setPendingAssetId(assetId);
      setPendingAssetPurchase(true);
    }
    const returnPath = assetId
      ? `${window.location.pathname}?asset=${encodeURIComponent(assetId)}&purchase=1`
      : window.location.pathname;
    if (auth0) {
      void auth0.loginWithRedirect({ authorizationParams: { ...(auth0Audience ? { audience: auth0Audience } : {}), ...(auth0Organization ? { organization: auth0Organization } : {}) }, appState: { returnTo: returnPath } });
      return;
    }
    if (supabase) {
      setSupabaseAuthMode("signup");
      setSupabaseAuthOpen(true);
      setNotice(assetId ? "Create a buyer account or switch to sign in. Your selected asset will remain open." : "Create a buyer account, or switch to sign in if you already have one.");
      return;
    }
    if (demoMode || import.meta.env.DEV) {
      void devSignIn("buyer");
      return;
    }
    setNotice("An external identity provider is not configured for this deployment.");
  }

  function openSellerSignUp(): void {
    chooseSupabaseAccountIntent("seller");
    if (auth0) {
      window.sessionStorage.setItem("veld.account-intent", "seller");
      void auth0.loginWithRedirect({ authorizationParams: { ...(auth0Audience ? { audience: auth0Audience } : {}), ...(auth0Organization ? { organization: auth0Organization } : {}) }, appState: { returnTo: "/contributor" } });
      return;
    }
    if (supabase) {
      setSupabaseAuthMode("signup");
      setSupabaseAuthOpen(true);
      setNotice("Create a seller account to complete verification, then upload your first media record.");
      return;
    }
    if (demoMode || import.meta.env.DEV) {
      void devSignIn("contributor");
      return;
    }
    setNotice("An external identity provider is not configured for this deployment.");
  }
  async function downloadFreePhoto(asset: Asset): Promise<void> {
    if (!sessionUser) { setNotice("Create an account to claim your introductory free photo downloads."); setSupabaseAuthMode("signup"); setSupabaseAuthOpen(Boolean(supabase)); return; }
    const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}/original`, { credentials: "include", redirect: "manual" });
    if (response.status === 302) { window.location.assign(response.headers.get("Location") ?? `/api/assets/${encodeURIComponent(asset.id)}/original`); return; }
    const body = await response.json().catch(() => ({})) as { error?: string };
    setNotice(body.error ?? "This photo could not be downloaded. Try again or choose a bundle.");
  }
  useEffect(() => {
    window.scrollTo(0, 0);
    setMobileSidebarOpen(false);
  }, [view]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "complete") return;
    setNotice(params.get("demo") === "1" ? "Demo licence purchased. No real transaction was made; the simulated contract is now in your purchase history." : "Payment checkout returned. Original access is available only after the provider payment webhook is verified.");
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      navigate("search");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionUser]);
  const currentViewLabel = sidebarSections.flatMap((section) => section.items).find((item) => item.view === view)?.label ?? "Explore archive";

  return <div className={`app-shell better-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    <BetterSidebar view={view} navigate={navigate} collapsed={sidebarCollapsed} mobileOpen={mobileSidebarOpen} authenticated={Boolean(sessionUser)} role={sessionUser?.role} onToggleCollapse={() => setSidebarCollapsed((value) => !value)} onCloseMobile={() => setMobileSidebarOpen(false)} />
    <header className="topbar">
      <button type="button" className="better-mobile-menu" aria-label="Open navigation" onClick={() => setMobileSidebarOpen(true)}><Icon name="menu" /></button>
      <button className="wordmark wordmark-button" onClick={() => navigate("explore")} aria-label="Veld Archive home"><span className="mark">V</span><span>veld<span className="muted">archive</span></span></button>
      <div className="better-context"><span>VELD ARCHIVE / WORKSPACE</span><strong>{currentViewLabel}</strong></div>
      <nav className="nav-links" aria-label="Primary navigation"><button onClick={() => navigate("explore")}>Explore</button><button className="stakeholder-nav-link" onClick={() => navigate("stakeholders")}>System overview <span>NEW</span></button><button className="rights-nav-link" onClick={() => navigate("rights")}>Rights guide <span>NEW</span></button><button className="campaign-nav" onClick={() => navigate("campaigns")}>Campaigns <span>3A</span></button><button onClick={() => navigate("contributors")}>Creators</button><button onClick={() => navigate("community")}>Community & collections</button><button className="studio-nav-link" onClick={() => navigate("studio")}>Media studio <span>NEW</span></button><button onClick={() => navigate("wordpress")}>WordPress <span>NEW</span></button><button onClick={() => navigate("contributor")}>Contributor insights</button><button onClick={() => navigate("buyer")}>Buyer ROI</button><button onClick={() => navigate("review")}>Editorial review</button><button className="governance-link" onClick={() => navigate("governance")}>Governance <span>NEW</span></button></nav>
      <div className={`top-actions ${demoMode ? "demo-top-actions" : ""}`}>
        {demoMode && <span className="demo-mode-pill" role="status">DEMO · no real transactions</span>}
        {demoMode && !sessionUser && <label className="role-switcher">Demo role <select value={devRole} onChange={(event) => setDevRole(event.target.value as DemoRole)}><option value="buyer">Buyer</option><option value="contributor">Seller</option><option value="editor">Editor</option><option value="admin">Admin</option></select></label>}
        {demoMode && !sessionUser && <button className="dark-button local-dev-login" onClick={() => void devSignIn()}>Enter demo</button>}
        {demoMode && sessionUser && <label className="role-switcher">Switch role <select value={devRole} onChange={(event) => void devSignIn(event.target.value as DemoRole)}><option value="buyer">Buyer</option><option value="contributor">Seller</option><option value="editor">Editor</option><option value="admin">Admin</option></select></label>}
        {demoMode && sessionUser && <button className="ghost-button demo-sign-out" onClick={() => { void api("/api/auth/logout", { method: "POST" }).then(() => { setSessionUser(null); setCsrfToken(""); setNotice("Demo session ended."); }); }}>Exit demo</button>}
        {!demoMode && import.meta.env.DEV && !sessionUser && <label className="role-switcher">Local role <select value={devRole} onChange={(event) => setDevRole(event.target.value as DemoRole)}><option value="buyer">Buyer</option><option value="contributor">Contributor</option><option value="editor">Editor</option><option value="admin">Admin</option></select></label>}
        {!demoMode && import.meta.env.DEV && !sessionUser && <button className="ghost-button local-dev-login" onClick={() => void devSignIn()}>Local sign in</button>}
        {!sessionUser && <><button className="dark-button role-action buyer-signup-button" onClick={() => openBuyerSignIn()}>Create buyer account</button><button className="ghost-button role-action seller-signup-button" onClick={openSellerSignUp}>Sell your media</button></>}
        {sessionUser?.role === "buyer" && <button className="dark-button role-action" onClick={() => navigate("search")}>Find media <span>↗</span></button>}
        {(sessionUser?.role === "contributor" || sessionUser?.role === "editor") && <button className="dark-button role-action" onClick={() => navigate("contributor")}>+ Upload media <span>↗</span></button>}
        {sessionUser?.role === "admin" && <button className="dark-button role-action" onClick={() => navigate("review")}>Review queue <span>↗</span></button>}
        {!sessionUser && <button className="ghost-button" aria-expanded={supabase ? supabaseAuthOpen : undefined} onClick={async () => { if (auth0) { await auth0.loginWithRedirect({ authorizationParams: { ...(auth0Audience ? { audience: auth0Audience } : {}), ...(auth0Organization ? { organization: auth0Organization } : {}) } }); return; } if (supabase) { setSupabaseAuthMode("signin"); setSupabaseAuthOpen(true); return; } if (!import.meta.env.DEV) { setNotice("An external identity provider is not configured for this deployment."); return; } await devSignIn(); }}>Sign in</button>}
        {sessionUser && <><button className="ghost-button" onClick={() => navigate("account")}>Account</button><button className="ghost-button" onClick={() => { void api("/api/auth/logout", { method: "POST" }).then(() => { setSessionUser(null); setCsrfToken(""); setNotice("Signed out."); if (auth0) auth0.logout({ logoutParams: { returnTo: window.location.origin } }); if (supabase) void supabase.auth.signOut(); }); }}>Sign out</button></>}
      </div>
    </header>
    {supabase && supabaseAuthOpen && !sessionUser && supabaseAuthMode === "signup" && <p className="auth-intent-note" role="status">{supabaseAccountIntent === "seller" ? "Seller account: complete verification and payout setup before uploading media." : "Buyer account: create an account to keep your selected asset and continue to licence terms."}</p>}
    {supabase && supabaseAuthOpen && !sessionUser && <section className="auth-panel" aria-label="Supabase authentication"><div><span className="section-kicker">SUPABASE AUTH</span><h2>{supabaseAuthMode === "signup" ? "Create your archive account." : supabaseAuthMode === "forgot" ? "Reset your password." : supabaseAuthMode === "reset" ? "Choose a new password." : "Welcome back."}</h2><p>{supabaseAuthMode === "forgot" ? "Enter your email and we’ll send a secure reset link. For your privacy, the response is the same whether an account exists." : supabaseAuthMode === "reset" ? "Your reset link is verified by Supabase. Set a new password, then sign in again." : supabaseAuthMethod === "phone" ? "Use a one-time SMS code. SMS delivery must be enabled for this Supabase project." : "Email/password authentication is handled by Supabase; Veld receives only the verified access token."}</p></div><form onSubmit={(event) => void submitSupabaseAuth(event)}>{supabaseAuthMessage && <p className={`auth-feedback ${supabaseAuthMessage.tone}`} role={supabaseAuthMessage.tone === "error" ? "alert" : "status"} aria-live="polite">{supabaseAuthMessage.text}</p>}{["signin", "signup"].includes(supabaseAuthMode) && <div className="auth-method-switch" role="group" aria-label="Verification method"><button type="button" className={supabaseAuthMethod === "email" ? "active" : ""} onClick={() => { setSupabaseAuthMethod("email"); setSupabasePhoneCodeSent(false); setSupabaseAuthMessage(null); }}>Email</button><button type="button" className={supabaseAuthMethod === "phone" ? "active" : ""} onClick={() => { setSupabaseAuthMethod("phone"); setSupabasePhoneCodeSent(false); setSupabaseAuthMessage(null); }}>SMS</button></div>}{supabaseAuthMode === "reset" ? <><label>New password<input type="password" autoComplete="new-password" minLength={8} required value={supabasePassword} onChange={(event) => setSupabasePassword(event.target.value)} /></label><label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={supabasePasswordConfirmation} onChange={(event) => setSupabasePasswordConfirmation(event.target.value)} /></label></> : supabaseAuthMethod === "phone" && ["signin", "signup"].includes(supabaseAuthMode) ? <>{supabaseAuthMode === "signup" && <label>Display name<input type="text" autoComplete="name" required value={supabaseDisplayName} onChange={(event) => setSupabaseDisplayName(event.target.value)} /></label>}<label>Phone number<input type="tel" autoComplete="tel" inputMode="tel" pattern="\+[1-9][0-9]{7,14}" required disabled={supabasePhoneCodeSent} value={supabasePhone} onChange={(event) => setSupabasePhone(event.target.value)} /></label>{supabasePhoneCodeSent && <label>SMS code<input type="text" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={supabasePhoneCode} onChange={(event) => setSupabasePhoneCode(event.target.value)} /></label>}</> : <><label>Email<input type="email" autoComplete="email" required value={supabaseEmail} onChange={(event) => setSupabaseEmail(event.target.value)} /></label>{["signin", "signup"].includes(supabaseAuthMode) && <label>Password<input type="password" autoComplete={supabaseAuthMode === "signup" ? "new-password" : "current-password"} minLength={8} required value={supabasePassword} onChange={(event) => setSupabasePassword(event.target.value)} /></label>}</>}<div className="modal-actions"><button type="submit" className="dark-button" disabled={supabaseAuthBusy}>{supabaseAuthBusy ? "Working…" : supabaseAuthMode === "forgot" ? "Send reset link" : supabaseAuthMode === "reset" ? "Update password" : supabaseAuthMethod === "phone" ? supabasePhoneCodeSent ? "Verify SMS code" : "Send SMS code" : supabaseAuthMode === "signup" ? "Create account" : "Sign in"}</button>{supabaseAuthMode === "signin" && supabaseAuthMethod === "email" && <button type="button" className="text-button" onClick={() => { setSupabaseAuthMode("forgot"); setSupabasePassword(""); setSupabaseAuthMessage(null); }}>Forgot password?</button>}{["signin", "signup"].includes(supabaseAuthMode) && <button type="button" className="ghost-button" onClick={() => { setSupabaseAuthMode((mode) => mode === "signup" ? "signin" : "signup"); setSupabasePassword(""); setSupabasePasswordConfirmation(""); setSupabasePhoneCodeSent(false); setSupabaseAuthMessage(null); }}>{supabaseAuthMode === "signup" ? "Use existing account" : "Create an account"}</button>}{supabaseAuthMode === "forgot" && <button type="button" className="ghost-button" onClick={() => { setSupabaseAuthMode("signin"); setSupabaseAuthMessage(null); }}>Back to sign in</button>}{supabaseAuthMode === "reset" && <button type="button" className="ghost-button" onClick={() => { setSupabaseAuthMode("signin"); setSupabasePassword(""); setSupabasePasswordConfirmation(""); setSupabaseAuthMessage(null); }}>Back to sign in</button>}<button type="button" className="ghost-button" onClick={() => setSupabaseAuthOpen(false)}>Close</button></div></form></section>}
    {sessionUser && <details className="notification-center"><summary>Alerts {notifications.some((item) => !item.read_at) && <span>{notifications.filter((item) => !item.read_at).length}</span>}</summary><div><strong>In-app alerts</strong>{notifications.length ? notifications.slice(0, 8).map((item) => <article className={item.read_at ? "read" : ""} key={item.id}><h3>{item.title}</h3><p>{item.body}</p><small>{new Date(item.created_at).toLocaleDateString("en-ZA")}</small>{!item.read_at && <button type="button" onClick={() => void markNotificationRead(item.id)}>Mark read</button>}</article>) : <p>No alerts yet. Saved-search matches will appear here.</p>}</div></details>}
    {!analyticsConsent && <button className="privacy-consent" onClick={() => setAnalyticsConsent(true)}>Allow anonymous demand insights</button>}

    {view === "explore" && <ExploreView query={query} setQuery={setQuery} runSearch={runSearch} assets={assets} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} orientation={orientation} setOrientation={setOrientation} verifiedCount={verifiedCount} notice={notice} onOpen={openAsset} authenticated={Boolean(sessionUser)} discovery={discovery} onUseQuery={useDiscoveryQuery} onSaveSearch={saveCurrentSearch} onDeleteSearch={deleteSavedSearch} />}
    {view === "search" && <SearchResultsView query={query} setQuery={setQuery} activeQuery={activeQuery} runSearch={runSearch} assets={assets} assetsLoading={assetsLoading} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} orientation={orientation} setOrientation={setOrientation} notice={notice} onOpen={openAsset} />}
    {view === "campaigns" && <CampaignWorkspace api={api} onNotice={setNotice} onOpen={openAsset} role={sessionUser?.role} />}
    {view === "contributors" && <CreatorMarketplace onOpen={openAsset} />}
    {view === "contributor" && <><ContributorFlowHeader onUpload={() => document.getElementById("contributor-upload")?.scrollIntoView({ behavior: "smooth", block: "start" })} /><AnalyticsDashboard role="contributor" /><MarketplaceLegalDocuments api={api} /><SellerVerificationPanel api={api} onNotice={setNotice} /><div id="contributor-upload"><ContributorWorkspace api={api} onNotice={setNotice} /></div><div id="contributor-library"><ContributorAssetLibrary api={api} onNotice={setNotice} /></div></>}
    {view === "buyer" && <><BuyerFlowHeader onSearch={() => navigate("search")} onCampaigns={() => navigate("campaigns")} onAccount={() => navigate("account")} /><AnalyticsDashboard role="buyer" onOpenAccount={() => navigate("account")} /></>}
    {view === "review" && <ReviewWorkspace items={reviewItems} api={api} onNotice={setNotice} onReload={loadReviewQueue} />}
    {view === "governance" && <><MarketplaceLegalDocuments api={api} /><GovernanceWorkspace api={api} onNotice={setNotice} /></>}
    {view === "community" && <CommunityWorkspace api={api} onNotice={setNotice} sessionUser={sessionUser} />}
    {view === "account" && <><BuyerSubscriptionPanel api={api} onNotice={setNotice} /><AccountWorkspace api={api} auth0={auth0} onNotice={setNotice} buyer={sessionUser?.role === "buyer" || sessionUser?.role === "admin"} /></>}
    {view === "studio" && <StudioWorkspace assets={assets} onNotice={setNotice} />}
    {view === "rights" && <RightsGuide />}
    {view === "stakeholders" && <StakeholderDiagrams />}
    {view === "wordpress" && <WordPressIntegrationPanel api={api} onNotice={setNotice} />}

    <footer><button className="wordmark wordmark-button" onClick={() => navigate("explore")}><span className="mark">V</span><span>veld<span className="muted">archive</span></span></button><button className="footer-guide-link" onClick={() => navigate("rights")}>Rights guide ↗</button><button className="footer-guide-link" onClick={() => navigate("stakeholders")}>System overview ↗</button><span>© 2026 Veld Archive · South Africa</span><span>Context before category.</span></footer>
    {selectedAsset && <AssetModal asset={selectedAsset} api={api} autoOpenPurchase={pendingAssetPurchase} onClose={() => { setSelectedAsset(null); setPendingAssetPurchase(false); }} onNotice={setNotice} onRequireSignIn={openBuyerSignIn} authenticated={Boolean(sessionUser)} lightboxes={lightboxes} onCreateLightbox={createLightbox} onSaveToLightbox={saveToLightbox} onDownload={downloadFreePhoto} />}
  </div>;
}

function BetterSidebar({ view, navigate, collapsed, mobileOpen, authenticated, role, onToggleCollapse, onCloseMobile }: { view: View; navigate: (nextView: View) => void; collapsed: boolean; mobileOpen: boolean; authenticated: boolean; role?: string; onToggleCollapse: () => void; onCloseMobile: () => void }) {
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const expanded = mobileOpen || !collapsed || hoverExpanded;
  return <>
    {mobileOpen && <button type="button" className="better-sidebar-backdrop" aria-label="Close navigation" onClick={onCloseMobile} />}
    <aside
      className={`better-sidebar ${expanded ? "is-expanded" : "is-collapsed"} ${collapsed && hoverExpanded ? "is-hover-expanded" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
      aria-label="Archive workspace navigation"
      onMouseEnter={() => setHoverExpanded(true)}
      onMouseLeave={() => setHoverExpanded(false)}
    >
      <div className="better-sidebar-brand">
        <button type="button" className="wordmark wordmark-button" onClick={() => { navigate("explore"); onCloseMobile(); }} aria-label="Veld Archive home"><span className="mark">V</span><span className="better-brand-name">veld<span className="muted">archive</span></span></button>
        <button type="button" className="better-collapse-button" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={onToggleCollapse}><Icon name="chevron" className={collapsed ? "is-rotated" : ""} /></button>
      </div>
      <button type="button" className="better-command-button" onClick={() => { navigate("search"); onCloseMobile(); }}><Icon name="search" /><span>Search archive</span><kbd><Icon name="command" size={12} /> K</kbd></button>
      <nav className="better-sidebar-nav">
        {sidebarSections.map((section) => { const items = section.items.filter((item) => canAccessView(item.view, role, authenticated)); if (!items.length) return null; return <div className="better-nav-section" key={section.label}>
          <span className="better-nav-label">{section.label}</span>
          {items.map((item) => <button type="button" key={item.view} className={`better-nav-item ${view === item.view ? "is-active" : ""} ${gatedViews.has(item.view) ? "is-gated" : ""}`} aria-current={view === item.view ? "page" : undefined} aria-label={item.label} title={!expanded ? item.label : undefined} onClick={() => { navigate(item.view); onCloseMobile(); }}><span className="better-nav-icon"><Icon name={item.icon} /></span><span className="better-nav-text">{item.label}</span>{item.badge && <span className="better-nav-badge">{item.badge}</span>}{gatedViews.has(item.view) && <span className="better-nav-lock">Workspace</span>}</button>)}
        </div>; })}
      </nav>
      <div className="better-sidebar-footer"><span className="better-status-dot" /><span className="better-sidebar-footer-copy"><strong>Archive service online</strong><small>Verified content pipeline</small></span></div>
    </aside>
  </>;
}

function ExploreView({ query, setQuery, runSearch, assets, filter, setFilter, sort, setSort, orientation, setOrientation, verifiedCount, notice, onOpen, authenticated, discovery, onUseQuery, onSaveSearch, onDeleteSearch }: { query: string; setQuery: (value: string) => void; runSearch: (event: React.FormEvent) => void; assets: Asset[]; filter: "all" | "image" | "video"; setFilter: (value: "all" | "image" | "video") => void; sort: "relevance" | "newest" | "popular" | "random"; setSort: (value: "relevance" | "newest" | "popular" | "random") => void; orientation: "all" | "landscape" | "portrait" | "square"; setOrientation: (value: "all" | "landscape" | "portrait" | "square") => void; verifiedCount: number; notice: string; onOpen: (asset: Asset) => void; authenticated: boolean; discovery: DiscoveryResponse; onUseQuery: (value: string) => void; onSaveSearch: (frequency: SavedSearch["alertFrequency"]) => Promise<void>; onDeleteSearch: (id: string) => Promise<void> }) {
  const suggestions = ["A real wood-fire braai in the Cape Flats", "A verified Table Mountain landscape at golden hour", "Right-hand-drive road footage in the Garden Route"];
  return <main id="top">
    <section className="hero"><div className="eyebrow"><span className="pulse" /> The trusted South African visual archive</div><h1>Find the image<br /><em>behind the story.</em></h1><p className="hero-copy">Authentic photography and film for brands that care where a story comes from. Veld Archive is deliberately focused on photo and video; audio and music are outside the product scope.</p><form className="search-box" onSubmit={runSearch}><span className="search-icon" aria-hidden="true"><Icon name="search" size={18} /></span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Describe the story you need to tell…" aria-label="Search photo and video" /><button type="submit">Search archive <span>↗</span></button></form><div className="suggestion-row">{suggestions.map((suggestion) => <button type="button" key={suggestion} className="suggestion" onClick={() => onUseQuery(suggestion)}>{suggestion} <span>→</span></button>)}</div></section>
    <section className="trust-strip"><div><strong>01</strong><span>Context-first metadata</span></div><div><strong>02</strong><span>Rights you can trust</span></div><div><strong>03</strong><span>Creators paid fairly</span></div><div className="trust-note">Built for the places we know.</div></section>
    <DiscoveryShelf discovery={discovery} authenticated={authenticated} activeQuery={query} onUseQuery={onUseQuery} onOpen={onOpen} onSaveSearch={onSaveSearch} onDeleteSearch={onDeleteSearch} />
     <section className="explore-section"><div className="section-heading"><div><span className="section-kicker">CURATED FROM THE GROUND UP</span><h2>The latest from <em>here.</em></h2></div><div className="result-note">{notice}</div></div><div className="toolbar"><div className="filter-tabs" role="tablist" aria-label="Media type">{(["all", "image", "video"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All media" : value === "image" ? "Photography" : "Film & video"}</button>)}</div><label className="toolbar-select">Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="relevance">Most relevant</option><option value="newest">Newest</option><option value="popular">Popular</option><option value="random">Surprise me</option></select></label><label className="toolbar-select">Orientation<select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)}><option value="all">Any orientation</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option><option value="square">Square</option></select></label><div className="verified-stat"><span className="verified-dot" />{verifiedCount} human-verified results</div></div><div className="explainability-note"><strong>Search evidence is visible.</strong><span>Open a result to inspect the fields used, match confidence, and verification status.</span><span className="ai-badge">AI + HUMAN REVIEW</span></div><div className="asset-grid">{assets.length ? assets.map((asset, index) => <AssetCard key={asset.id} asset={asset} index={index} onOpen={onOpen} />) : <div className="empty-state">No assets matched this brief yet. Try a location, landmark, or cultural context.</div>}</div></section>
    <ModerationQueue assets={assets} onReview={onOpen} />
    <section className="manifesto"><div className="manifesto-label">WHY VELD</div><div><h2>South Africa is not a<br /><em>stock category.</em></h2><p>Every place has a texture. Every community has a point of view. Veld gives the people who make the work more control over how it is found, licensed, and remembered.</p></div></section>
  </main>;
}

const searchSteps = [
  "Reading the story brief",
  "Searching verified archive records",
  "Checking place, rights, and context",
  "Ranking the closest visual matches",
];

function SearchResultsView({ query, setQuery, activeQuery, runSearch, assets, assetsLoading, filter, setFilter, sort, setSort, orientation, setOrientation, notice, onOpen }: { query: string; setQuery: (value: string) => void; activeQuery: string; runSearch: (event: React.FormEvent) => void; assets: Asset[]; assetsLoading: boolean; filter: "all" | "image" | "video"; setFilter: (value: "all" | "image" | "video") => void; sort: "relevance" | "newest" | "popular" | "random"; setSort: (value: "relevance" | "newest" | "popular" | "random") => void; orientation: "all" | "landscape" | "portrait" | "square"; setOrientation: (value: "all" | "landscape" | "portrait" | "square") => void; notice: string; onOpen: (asset: Asset) => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!assetsLoading) { setStep(searchSteps.length); return undefined; }
    setStep(0);
    const timer = setInterval(() => setStep((current) => Math.min(searchSteps.length - 1, current + 1)), 260);
    return () => clearInterval(timer);
  }, [activeQuery, assetsLoading]);

  const traceAssets = assets.filter((asset) => Boolean(asset.previewUrl)).slice(0, 4);
  const isComplete = !assetsLoading;
  const progress = isComplete ? 100 : Math.min(88, Math.round(((step + 1) / searchSteps.length) * 88));
  const resultMessage = !isComplete
    ? `Searching the archive for “${activeQuery || "the latest verified media"}”`
    : notice.startsWith("The verified content service is unavailable")
      ? notice
      : `${assets.length} verified result${assets.length === 1 ? "" : "s"} found.`;

  return <main className="search-results-page" id="search-results">
    <section className="search-results-intro">
      <div className="search-results-eyebrow"><span className="pulse" /> Archive search / live trace</div>
      <h1>Finding the visual story<br /><em>behind your brief.</em></h1>
      <form className="search-box" onSubmit={runSearch}><span className="search-icon" aria-hidden="true"><Icon name="search" size={18} /></span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Describe the story you need to tell…" aria-label="Search photo and video" /><button type="submit" disabled={assetsLoading}>{assetsLoading ? "Searching…" : "Search again"} <span>↗</span></button></form>
      <div className="search-status" role="status" aria-live="polite" aria-busy={assetsLoading}><span className={`search-status-dot${isComplete ? " complete" : ""}`} /><span>{resultMessage}</span></div>
    </section>

    <section className="search-workbench" aria-label="Search process">
      <aside className="search-progress-panel">
        <div className="search-progress-heading"><span className="section-kicker">SEARCH PROCESS</span><strong>{isComplete ? "Complete" : `${progress}%`}</strong></div>
        <div className="search-progress-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        <ol className="search-step-list">{searchSteps.map((label, index) => <li key={label} className={index < step || isComplete ? "done" : index === step ? "current" : ""}><span>{index < step || isComplete ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>{label}</strong>{index === step && !isComplete && <small>Working through indexed records</small>}</li>)}</ol>
        <p className="search-provenance"><strong>What is being checked?</strong> Published records, stored previews, human verification, location context, rights status, and the language of your brief.</p>
      </aside>
      <section className="search-trace-panel" aria-labelledby="trace-heading">
        <div className="search-trace-heading"><div><span className="section-kicker">CANDIDATE MEDIA</span><h2 id="trace-heading">{isComplete ? "Candidate records checked" : "Images being checked"} <em>{isComplete ? "first." : "now."}</em></h2></div><span className="trace-count">{traceAssets.length} candidate{traceAssets.length === 1 ? "" : "s"} in view</span></div>
        <div className="search-trace-grid">{traceAssets.map((asset, index) => <SearchTraceCard key={asset.id} asset={asset} index={index} onOpen={onOpen} loading={!isComplete} />)}</div>
      </section>
    </section>

    <section className="search-matches" aria-labelledby="matches-heading">
      <div className="section-heading"><div><span className="section-kicker">RANKED MATCHES</span><h2 id="matches-heading">The closest <em>stories.</em></h2></div><span className="result-note">Open a result to inspect the metadata, verification, and rights evidence behind its ranking.</span></div>
      <div className="toolbar"><div className="filter-tabs" role="tablist" aria-label="Media type">{(["all", "image", "video"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All media" : value === "image" ? "Photography" : "Film & video"}</button>)}</div><label className="toolbar-select">Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="relevance">Most relevant</option><option value="newest">Newest</option><option value="popular">Popular</option><option value="random">Surprise me</option></select></label><label className="toolbar-select">Orientation<select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)}><option value="all">Any orientation</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option><option value="square">Square</option></select></label><div className="verified-stat"><span className="verified-dot" />{assets.filter((asset) => asset.humanVerified).length} human-verified results</div></div>
      <div className="asset-grid" aria-busy={assetsLoading}>{assetsLoading ? <div className="empty-state" role="status">Ranking the checked candidates…</div> : assets.length ? assets.map((asset, index) => <AssetCard key={asset.id} asset={asset} index={index} onOpen={onOpen} />) : <div className="empty-state">No records matched this brief closely enough. Try a location, landmark, or cultural context.</div>}</div>
    </section>
  </main>;
}

function SearchTraceCard({ asset, index, onOpen, loading }: { asset: Asset; index: number; onOpen: (asset: Asset) => void; loading: boolean }) {
  const [failed, setFailed] = useState(false);
  const available = Boolean(asset.previewUrl) && !failed;
  return <button type="button" className={`search-trace-card${loading ? " is-loading" : ""}`} onClick={() => onOpen(asset)} aria-label={`Inspect ${asset.title} while searching`}><div className={`search-trace-visual visual-${(index % 3) + 1} ${asset.kind}`}>{available && asset.kind === "image" && <img src={asset.previewUrl!} alt="" loading="lazy" onError={() => setFailed(true)} />}{available && asset.kind === "video" && <video src={asset.previewUrl!} muted playsInline preload="metadata" onError={() => setFailed(true)} />}{!available && <span className="search-trace-placeholder">Preview queued</span>}<span className="search-trace-scan" aria-hidden="true" /><span className="search-trace-kind">{asset.kind === "video" ? "FILM" : "PHOTO"}</span><span className="search-trace-place">{asset.landmark ?? asset.locality ?? asset.city}</span></div><div className="search-trace-copy"><strong>{asset.title}</strong><small>{loading ? "Checking metadata…" : "Match candidate"}</small></div></button>;
}

function DiscoveryShelf({ discovery, authenticated, activeQuery, onUseQuery, onOpen, onSaveSearch, onDeleteSearch }: { discovery: DiscoveryResponse; authenticated: boolean; activeQuery: string; onUseQuery: (value: string) => void; onOpen: (asset: Asset) => void; onSaveSearch: (frequency: SavedSearch["alertFrequency"]) => Promise<void>; onDeleteSearch: (id: string) => Promise<void> }) {
  const [frequency, setFrequency] = useState<SavedSearch["alertFrequency"]>("weekly");
  if (!discovery.trending.length && !discovery.recommendations.length && !discovery.savedSearches.length && !authenticated) return null;
  return <section className="discovery-shelf" aria-labelledby="discovery-title"><div className="section-heading"><div><span className="section-kicker">DISCOVERY, WITH A MEMORY</span><h2 id="discovery-title">Find what is moving <em>now.</em></h2></div>{authenticated && <div className="save-search-control"><select aria-label="Saved search alert frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as SavedSearch["alertFrequency"])}><option value="none">No alerts</option><option value="daily">Daily in-app alert</option><option value="weekly">Weekly in-app alert</option></select><button type="button" className="outline-button" disabled={activeQuery.trim().length < 2} onClick={() => void onSaveSearch(frequency)}>Save this search</button></div>}</div>
    {discovery.trending.length > 0 && <div className="trending-searches" aria-label="Trending searches"><strong>Trending searches</strong>{discovery.trending.map((item) => <button type="button" key={item.query} onClick={() => onUseQuery(item.query)}><span>{item.query}</span><small>{item.searchCount} searches</small></button>)}</div>}
    {discovery.savedSearches.length > 0 && <div className="saved-search-list"><strong>Your saved searches</strong>{discovery.savedSearches.map((item) => <div key={item.id}><button type="button" onClick={() => onUseQuery(item.query)}><span>{item.name}</span><small>{item.mediaKind} · {item.alertFrequency === "none" ? "alerts off" : `${item.alertFrequency} alerts`}</small></button><button type="button" className="remove-saved-search" aria-label={`Remove ${item.name}`} onClick={() => void onDeleteSearch(item.id)}>×</button></div>)}</div>}
    {discovery.recommendations.length > 0 && <div className="recommendation-block"><div><strong>{discovery.personalized ? "Recommended from your saved interests" : "Recommended from the latest verified work"}</strong><small>Recommendations use saved searches and lightboxes—not hidden identity or device profiling.</small></div><div className="asset-grid">{discovery.recommendations.slice(0, 4).map((item, index) => <div className="recommendation-item" key={item.asset.id}><AssetCard asset={item.asset} index={index + 6} onOpen={onOpen} /><p>{item.reason}</p></div>)}</div></div>}
  </section>;
}

function ModerationQueue({ assets, onReview }: { assets: Asset[]; onReview: (asset: Asset) => void }) {
  const pending = assets.filter((asset) => asset.status === "needs_review").sort((a, b) => (b.aiConfidence ?? b.authenticityConfidence) - (a.aiConfidence ?? a.authenticityConfidence));
  if (!pending.length) return null;
  return <section className="moderation-inline"><div><span className="section-kicker">EDITORIAL SIGNAL</span><h2>{pending.length} record{pending.length === 1 ? "" : "s"} need context review.</h2></div><div>{pending.map((asset) => <button key={asset.id} className="moderation-row" onClick={() => onReview(asset)}><span>{asset.title}</span><small>{asset.city} · {asset.rightsStatus}</small><b>Review →</b></button>)}</div></section>;
}

function GovernanceWorkspaceLegacy({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [stage, setStage] = useState<"all" | WorkflowStage>("all");
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    api(`/api/governance/assets?stage=${stage}`)
      .then(async (response) => { if (!response.ok) throw new Error("Governance unavailable"); return response.json() as Promise<{ results: Asset[] }>; })
      .then((data) => setAssets(data.results))
      .catch(() => setAssets([]));
    return () => controller.abort();
  }, [api, stage]);

  async function act(asset: Asset, action: "run_ai_tagging" | "approve" | "reject") {
    try {
      const response = await api(`/api/governance/assets/${asset.id}/action`, { method: "POST", body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error();
      onNotice(`${asset.title} moved through the ${action.replaceAll("_", " ")} stage.`);
      setAssets((current) => current.filter((item) => item.id !== asset.id));
    } catch {
      onNotice("Governance actions require the latest D1 migration and an editor identity.");
    }
  }

  return <main className="workspace-page"><div className="workspace-intro"><span className="section-kicker">GOVERNANCE WORKSPACE</span><h1>Evidence before <em>approval.</em></h1><p>Track metadata, AI suggestions, curator corrections, and publication decisions in one queue.</p></div><div className="toolbar"><div className="filter-tabs">{(["all", "ingestion", "ai_tagging", "curator_correction", "approval"] as const).map((value) => <button key={value} className={stage === value ? "active" : ""} onClick={() => setStage(value)}>{value.replaceAll("_", " ")}</button>)}</div><span className="verified-stat">{assets.length} records</span></div><div className="review-queue">{assets.length ? assets.map((asset) => <article className="review-item" key={asset.id}><div className={`review-visual ${asset.kind}`}><span>{asset.kind === "video" ? "▶" : "V"}</span></div><div className="review-copy"><div className="card-heading"><span className="section-kicker">{asset.workflowStage.replaceAll("_", " ")}</span><span className={`status-pill ${asset.humanVerified ? "cool" : "warm"}`}>{asset.humanVerified ? "Verified" : "Needs context"}</span></div><h2>{asset.title}</h2><p>{asset.caption || asset.description}</p><div className="review-tags">{asset.culturalTags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="review-actions"><button className="dark-button" onClick={() => void act(asset, "run_ai_tagging")}>Run AI suggestions</button><button className="ghost-button" onClick={() => void act(asset, "approve")}>Approve</button><button className="ghost-button danger-button" onClick={() => void act(asset, "reject")}>Reject</button></div></div></article>) : <div className="empty-state">No governance records are available for this stage.</div>}</div></main>;
}

function formatZar(cents: number): string { return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(cents / 100); }

function monetizationLabel(model: MonetizationModel = "membership"): string {
  if (model === "individual_license") return "Individual licence";
  if (model === "custom_quote") return "Custom quote";
  return "Membership access";
}

function assetPricingLabel(asset: Asset): string {
  if (asset.freeDownloadEnabled) return "Free intro download";
  const model = asset.monetizationModel ?? "membership";
  return model === "individual_license" && asset.licensePriceCents ? `${formatZar(asset.licensePriceCents)} / year` : monetizationLabel(model);
}

function FlowSteps({ steps }: { steps: string[] }) {
  return <ol className={`flow-steps flow-steps-${steps.length}`}>{steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong>{index < steps.length - 1 && <b aria-hidden="true">→</b>}</li>)}</ol>;
}

function BuyerFlowHeader({ onSearch, onCampaigns, onAccount }: { onSearch: () => void; onCampaigns: () => void; onAccount: () => void }) {
  return <section className="flow-home" aria-labelledby="buyer-flow-title"><div className="flow-home-copy"><span className="section-kicker">BUYER WORKSPACE</span><h1 id="buyer-flow-title">From search intent to controlled delivery.</h1><p>Find a verified asset, inspect its evidence, accept the current terms, pay securely, and return here when the signed payment webhook unlocks delivery.</p><div className="flow-home-actions"><button type="button" className="dark-button" onClick={onSearch}>Find media <span>↗</span></button><button type="button" className="outline-button" onClick={onCampaigns}>Open campaigns</button><button type="button" className="ghost-button" onClick={onAccount}>Account & licences</button></div></div><FlowSteps steps={["Search", "Inspect", "Validate", "Request", "Pay", "Deliver"]} /></section>;
}

function ContributorFlowHeader({ onUpload }: { onUpload: () => void }) {
  return <section className="flow-home" aria-labelledby="contributor-flow-title"><div className="flow-home-copy"><span className="section-kicker">SELLER WORKSPACE</span><h1 id="contributor-flow-title">From your context to a searchable record.</h1><p>Complete the seller tender once, then use the upload action whenever you have a new image or video. Editors approve the current revision before buyers can find it.</p><div className="flow-home-actions"><button type="button" className="dark-button" onClick={onUpload}>+ Upload media <span>↗</span></button><a className="outline-button" href="#contributor-library">Open my library</a></div></div><FlowSteps steps={["Profile", "Verify", "Upload", "Review", "Approve + index"]} /></section>;
}

function MetricBars({ points, tone = "rust" }: { points: { label: string; value: number }[]; tone?: "rust" | "green" }) {
  const max = Math.max(...points.map((point) => point.value), 1);
  return <div className={`metric-bars ${tone}`}>{points.map((point) => <div className="metric-bar" key={point.label} title={`${point.label}: ${point.value}`}><span style={{ height: `${Math.max(8, (point.value / max) * 100)}%` }} /><small>{point.label}</small></div>)}</div>;
}

function AnalyticsDashboard({ role, onOpenAccount }: { role: "contributor" | "buyer"; onOpenAccount?: () => void }) {
  const [data, setData] = useState<ContributorAnalytics | BuyerAnalytics | null>(null);
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setSubscriptionRequired(false);
    fetch(`/api/analytics/${role}`, { signal: controller.signal, credentials: "include" })
      .then(async (response) => { if (response.status === 402) { setSubscriptionRequired(true); return null; } if (!response.ok) throw new Error("Analytics unavailable"); return response.json() as Promise<ContributorAnalytics | BuyerAnalytics>; })
      .then((nextData) => { if (nextData) setData(nextData); }).catch(() => setData(null));
    return () => controller.abort();
  }, [role]);

  if (subscriptionRequired) return <section className="analytics-page"><div className="empty-state"><span className="section-kicker">BUYER SUBSCRIPTION</span><h2>Subscribe to unlock Buyer ROI</h2><p>Your subscription is the access control for campaign performance and licence reporting.</p><button className="dark-button" onClick={onOpenAccount}>Open subscription</button></div></section>;
  if (!data) return <section className="analytics-page"><div className="empty-state">Analytics are unavailable. No cached or placeholder figures are shown.</div></section>;

  if (data.role === "contributor") return <section className="analytics-page"><div className="workspace-intro"><span className="section-kicker">CONTRIBUTOR SIGNALS · {data.range}</span><h1>Make what the<br /><em>brief is asking for.</em></h1><p>Demand is shown in aggregate so you can spot opportunity without tracking individual buyers.</p></div><div className="metric-grid"><MetricCard label="Archive searches" value={data.summary.searches.toLocaleString()} detail="for your context and tags" /><MetricCard label="Asset views" value={data.summary.views.toLocaleString()} detail="on your published work" /><MetricCard label="Demand change" value={`+${data.summary.demandChange}%`} detail="compared with prior period" tone="green" /><MetricCard label="Saved to briefs" value={data.summary.saves.toLocaleString()} detail="lightbox saves" /></div><div className="analytics-columns"><article className="analytics-card analytics-wide"><div className="card-heading"><div><span className="section-kicker">SEARCH TRENDS</span><h2>What buyers are looking for</h2></div><span className="status-pill cool">Aggregate only</span></div><MetricBars points={data.searchTrends} /></article><article className="analytics-card"><span className="section-kicker">POPULAR TAGS</span><h2>Context with pull</h2><div className="rank-list">{data.popularTags.map((tag, index) => <div className="rank-row" key={tag.label}><span className="rank-number">0{index + 1}</span><strong>{tag.label}</strong><span>{tag.value}</span></div>)}</div></article><article className="analytics-card"><span className="section-kicker">GEOGRAPHIC DEMAND</span><h2>Where the brief is</h2><div className="rank-list">{data.geographicDemand.map((place) => <div className="place-row" key={place.label}><div><strong>{place.label}</strong><small>{place.detail}</small></div><span className="demand-pill">{place.value}</span></div>)}</div></article></div><div className="opportunity-grid">{data.opportunities.map((item) => <article className={`opportunity-card ${item.tone}`} key={item.title}><span className="section-kicker">OPPORTUNITY</span><h3>{item.title}</h3><p>{item.detail}</p></article>)}</div><p className="privacy-note">Privacy note: Veld stores daily counters, coarse place labels, and approved asset context only. No IP address, device fingerprint, cookie, or raw search history is used for these signals.</p></section>;

  return <section className="analytics-page"><div className="workspace-intro"><span className="section-kicker">BUYER PERFORMANCE · {data.range}</span><h1>Know what your<br /><em>licence made possible.</em></h1><p>See campaign delivery and attributed results beside the exact assets your team licensed.</p></div><div className="metric-grid"><MetricCard label="Campaign spend" value={formatZar(data.summary.spendCents)} detail="licensed asset spend" /><MetricCard label="Licensed assets" value={data.summary.licensedAssets.toString()} detail="with campaign attribution" /><MetricCard label="Attributed ROI" value={`+${data.summary.roi}%`} detail="conversion value proxy" tone="green" /><MetricCard label="Conversions" value={data.summary.conversions.toLocaleString()} detail={`${data.summary.impressions.toLocaleString()} impressions`} /></div><div className="analytics-columns buyer-columns"><article className="analytics-card analytics-wide"><div className="card-heading"><div><span className="section-kicker">DELIVERY TREND</span><h2>Campaign impressions</h2></div><span className="status-pill cool">Licensed assets only</span></div><MetricBars points={data.performance} tone="green" /></article><article className="analytics-card"><span className="section-kicker">CAMPAIGNS</span><h2>Asset-level ROI</h2><div className="campaign-list">{data.campaigns.map((campaign) => <div className="campaign-row" key={campaign.id}><div><strong>{campaign.name}</strong><small>{campaign.assetTitle}</small></div><b>+{campaign.roi}%</b><span>{formatZar(campaign.spendCents)}</span></div>)}</div></article></div><div className="campaign-table">{data.campaigns.map((campaign) => <article className="campaign-detail" key={campaign.id}><div><span className="section-kicker">LICENSED ASSET</span><h3>{campaign.assetTitle}</h3><p>{campaign.name} · {campaign.status}</p></div><div><strong>{campaign.impressions.toLocaleString()}</strong><small>impressions</small></div><div><strong>{campaign.conversions.toLocaleString()}</strong><small>conversions</small></div><div><strong>+{campaign.roi}%</strong><small>attributed ROI</small></div></article>)}</div><p className="privacy-note">ROI is tied to licences in D1 and campaign events from your authenticated workspace. Conversion value is a configurable reporting assumption until your ad platform is connected.</p></section>;
}

function MetricCard({ label, value, detail, tone = "rust" }: { label: string; value: string; detail: string; tone?: "rust" | "green" }) { return <article className={`metric-card ${tone}`}><span className="section-kicker">{label}</span><strong>{value}</strong><small>{detail}</small></article>; }

type CampaignSummary = {
  id: string;
  name: string;
  brief: string;
  briefFields: CampaignBrief;
  brandKit: BrandKit;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  assetCounts: { shortlisted: number; approved: number; needsReview: number; rejected: number };
};

type CampaignRecommendationRow = CampaignRecommendation & { stage: CampaignStage | null; note: string };

type AssistantTool = "similar" | "story" | "crop" | "captions" | "headlines" | "readability" | "copy-space" | "pack" | "rights" | "variants";

const campaignPlatformOptions: CampaignPlatform[] = ["instagram", "linkedin", "web", "email"];
const assistantTools: Array<{ id: AssistantTool; label: string }> = [
  { id: "similar", label: "Find similar assets" },
  { id: "story", label: "Make this Instagram Story" },
  { id: "crop", label: "Suggest better crop" },
  { id: "captions", label: "Generate captions" },
  { id: "headlines", label: "Create 5 headlines" },
  { id: "readability", label: "Check readability" },
  { id: "copy-space", label: "Find left copy space" },
  { id: "pack", label: "Build campaign pack" },
  { id: "rights", label: "Check commercial use" },
  { id: "variants", label: "Create channel variants" },
];

function campaignPlatformLabel(platform: CampaignPlatform): string {
  return platform === "web" ? "Website" : platform === "linkedin" ? "LinkedIn" : platform[0].toUpperCase() + platform.slice(1);
}

function assetPlace(asset: Asset): string {
  return [asset.city, asset.province, asset.country].filter(Boolean).join(", ") || "South Africa";
}

function campaignCaptions(asset: Asset, brief: CampaignBrief): string[] {
  const place = assetPlace(asset);
  const subject = asset.title || asset.subjectTags.slice(0, 2).join(" and ") || "this story";
  const tone = brief.tone[0] || "authentic";
  return [
    `${subject}. ${place}, told with a ${tone} point of view.`,
    `A closer look at ${subject.toLowerCase()} — grounded in the people and places that make ${place} what it is.`,
    `Built for ${brief.audience === "Not specified" ? "your next campaign" : brief.audience.toLowerCase()}. Meet ${subject.toLowerCase()}.`,
  ];
}

function campaignHeadlines(asset: Asset, brief: CampaignBrief): string[] {
  const place = asset.city || asset.country || "here";
  const subject = asset.title || "A story worth seeing";
  const product = brief.productService === "Not specified" ? "your next launch" : brief.productService;
  return [
    `${subject}: made for ${place}`,
    `Put ${place} in the frame`,
    `The detail that makes ${product} feel real`,
    `Closer to the place, closer to the people`,
    `A more human way to launch`,
  ];
}

function cropAdvice(asset: Asset, platform: "instagram" | "web" | "email" | "linkedin"): string[] {
  const orientation = asset.mediaOrientation ?? "landscape";
  if (platform === "instagram") return orientation === "portrait"
    ? ["Keep the full-height frame; protect the top and bottom 12% for Story UI.", "Place copy in the cleanest third and keep the subject clear of the reply rail."]
    : ["Use a 9:16 crop centred on the strongest subject; keep the source untouched.", "Test a focal-point crop before publishing—this is layout guidance, not a generated replacement."];
  if (platform === "web") return orientation === "landscape"
    ? ["Use a wide hero crop with the focal point on the right so the left third can carry copy.", "Keep a safe 8% inset for responsive breakpoints."]
    : ["Use a shallow landscape crop only if the focal subject remains fully visible.", "Prefer a different wide licensed source if the crop removes important context."];
  if (platform === "email") return ["Use a landscape or square crop with a clear focal point at mobile width.", "Keep important detail inside the central 70% of the frame."];
  return ["Use a 1.91:1 landscape crop for the lead placement.", "Keep the face, product, or landmark away from the UI-safe edges."];
}

function sharedAssetSignals(left: Asset, right: Asset): number {
  const leftTags = new Set([...left.subjectTags, ...left.culturalTags].map((tag) => tag.toLowerCase()));
  return [...right.subjectTags, ...right.culturalTags].filter((tag) => leftTags.has(tag.toLowerCase())).length;
}

function CampaignWorkspace({ api, onNotice, onOpen, role }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; onOpen: (asset: Asset) => void; role?: string }) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [activeCampaign, setActiveCampaign] = useState<CampaignSummary | null>(null);
  const [campaignAssets, setCampaignAssets] = useState<CmsCampaignAsset[]>([]);
  const [recommendations, setRecommendations] = useState<CampaignRecommendationRow[]>([]);
  const [editVersions, setEditVersions] = useState<CmsDetail["editVersions"]>([]);
  const [derivatives, setDerivatives] = useState<CmsDerivative[]>([]);
  const [bundles, setBundles] = useState<CmsBundle[]>([]);
  const [licenceMetadata, setLicenceMetadata] = useState<CmsLicenceMetadata[]>([]);
  const [campaignBlockers, setCampaignBlockers] = useState<CmsBlocker[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [zohoSending, setZohoSending] = useState(false);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<CampaignPlatform[]>(["instagram", "linkedin", "web", "email"]);
  const [tone, setTone] = useState("warm, premium, authentic");
  const [industry, setIndustry] = useState("property");
  const [preferredVisuals, setPreferredVisuals] = useState("Natural light, real places, room for campaign copy");
  const [brandColours, setBrandColours] = useState("");
  const [logoNotes, setLogoNotes] = useState("");
  const [forbiddenStyles, setForbiddenStyles] = useState("");
  const [assistantTool, setAssistantTool] = useState<AssistantTool>("similar");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [copyDraft, setCopyDraft] = useState("A better way to come home");
  const isBuyer = role === "buyer";
  const [buyerTermsViewed, setBuyerTermsViewed] = useState(false);
  const [buyerTermsAccepted, setBuyerTermsAccepted] = useState(false);
  const [termsSaving, setTermsSaving] = useState(false);

  const loadCampaigns = useCallback(async () => {
    try {
      const response = await api("/api/campaigns");
      if (!response.ok) throw new Error();
      const data = await response.json() as { results: CampaignSummary[] };
      setCampaigns(data.results);
      setActiveId((current) => current || data.results[0]?.id || "");
    } catch {
      setCampaigns([]);
      onNotice("Campaigns need an authenticated workspace and the campaign migration.");
    } finally {
      setLoading(false);
    }
  }, [api, onNotice]);

  const loadCampaign = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const response = await api(`/api/campaigns/${id}`);
      if (!response.ok) throw new Error();
      const data = await response.json() as { campaign: CampaignSummary; assets?: CmsCampaignAsset[]; recommendations: CampaignRecommendationRow[]; editVersions?: CmsDetail["editVersions"]; derivatives?: CmsDerivative[]; bundles?: CmsBundle[]; licenceMetadata?: CmsLicenceMetadata[]; blockers?: CmsBlocker[] };
      setActiveCampaign(data.campaign);
      setCampaignAssets(data.assets ?? []);
      setRecommendations(data.recommendations);
      setEditVersions(data.editVersions ?? []);
      setDerivatives(data.derivatives ?? []);
      setBundles(data.bundles ?? []);
      setLicenceMetadata(data.licenceMetadata ?? []);
      setCampaignBlockers(data.blockers ?? []);
      const accepted = Boolean((data as { buyerTermsAccepted?: boolean }).buyerTermsAccepted);
      setBuyerTermsAccepted(accepted);
      setBuyerTermsViewed(accepted);
      setSelectedAssetId((current) => current && data.recommendations.some((item) => item.asset.id === current) ? current : data.recommendations[0]?.asset.id || "");
    } catch {
      onNotice("This campaign could not be loaded. No local recommendations were applied.");
    }
  }, [api, onNotice]);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);
  useEffect(() => { if (activeId) void loadCampaign(activeId); }, [activeId, loadCampaign]);

  async function acceptBuyerCampaignTerms(): Promise<void> {
    if (!activeCampaign || !buyerTermsViewed || termsSaving) return;
    setTermsSaving(true);
    try {
      const response = await api(`/api/campaigns/${activeCampaign.id}/terms/accept`, { method: "POST", body: JSON.stringify({
        viewed: true,
        accepted: true,
        buyerAgreementVersion: buyerAgreement.version,
        paymentAgreementVersion: paymentDisclosure.version,
      }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The campaign terms could not be accepted.");
      setBuyerTermsAccepted(true);
      onNotice("Campaign pack terms accepted. You can now approve licensed sources for this campaign.");
    } catch (error) {
      setBuyerTermsAccepted(false);
      onNotice(error instanceof Error ? error.message : "The campaign terms could not be accepted.");
    } finally {
      setTermsSaving(false);
    }
  }

  function applyPropertyPreset() {
    setName("New property launch");
    setBrief("Build a commercial property launch campaign for first-time buyers in Cape Town. Keep the work warm, premium, authentic, and grounded in real neighbourhood context. I need Instagram Story, LinkedIn, website, and email variants with room for copy.");
    setTone("warm, premium, authentic");
    setIndustry("property");
    setPreferredVisuals("Natural light, real neighbourhoods, architecture, room for campaign copy");
    setSelectedPlatforms(["instagram", "linkedin", "web", "email"]);
  }

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api("/api/campaigns", { method: "POST", body: JSON.stringify({
        name: name.trim(), brief: brief.trim(), platforms: selectedPlatforms,
        brandKit: { colours: brandColours.split(",").map((value) => value.trim()).filter(Boolean), logoNotes, tone, industry, forbiddenStyles: forbiddenStyles.split(",").map((value) => value.trim()).filter(Boolean), preferredVisuals },
      }) });
      if (!response.ok) throw new Error();
      const data = await response.json() as { id: string };
      await loadCampaigns();
      setActiveId(data.id);
      onNotice("Campaign brief saved. Recommendations are ranked from published, rights-aware archive assets.");
    } catch {
      onNotice("The campaign could not be saved. Add a name and a brief of at least 20 characters.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStage(item: CampaignRecommendationRow, stage: CampaignStage) {
    if (!activeCampaign) return;
    if (stage === "approved" && isBuyer && (!buyerTermsViewed || !buyerTermsAccepted)) {
      onNotice("View and accept the campaign pack terms above the photos before approving a source.");
      return;
    }
    try {
      const response = await api(`/api/campaigns/${activeCampaign.id}/assets`, { method: "POST", body: JSON.stringify({ assetId: item.asset.id, stage, note: stage === "approved" ? "Approved after rights and creative review." : "" }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "That campaign decision was not saved.");
      }
      setRecommendations((current) => current.map((recommendation) => recommendation.asset.id === item.asset.id ? { ...recommendation, stage } : recommendation));
      setCampaignAssets((current) => {
        const existing = current.find((asset) => asset.id === item.asset.id);
        const nextAsset = { ...item.asset, campaignStage: stage, campaignNote: stage === "approved" ? "Approved after rights and creative review." : existing?.campaignNote ?? "", activeLicenceId: existing?.activeLicenceId ?? null };
        return existing ? current.map((asset) => asset.id === item.asset.id ? nextAsset : asset) : [nextAsset, ...current];
      });
      onNotice(stage === "shortlisted" ? `${item.asset.title} added to this campaign.` : `${item.asset.title} moved to ${stage.replaceAll("_", " ")}.`);
    } catch (error) {
      onNotice(`${error instanceof Error ? error.message : "That campaign decision was not saved."} No local decision was applied.`);
    }
  }

  async function downloadManifest() {
    if (!activeCampaign) return;
    try {
      const response = await api(`/api/campaigns/${activeCampaign.id}/manifest`);
      if (!response.ok) throw new Error();
      const manifest = await response.json();
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${activeCampaign.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "campaign"}-manifest.json`;
      link.click();
      URL.revokeObjectURL(url);
      onNotice("Campaign pack manifest exported. It references approved licensed sources; no media was generated or substituted.");
    } catch {
      onNotice("Approve at least one asset before exporting the campaign pack manifest.");
    }
  }

  async function sendToZohoSocial() {
    if (!activeCampaign) return;
    setZohoSending(true);
    try {
      const response = await api(`/api/campaigns/${activeCampaign.id}/integrations/zoho/social`, { method: "POST", body: JSON.stringify({ copy: copyDraft, channels: activeCampaign.briefFields.platforms.filter((platform) => ["instagram", "facebook", "tiktok", "linkedin"].includes(platform)) }) });
      const data = await response.json().catch(() => ({})) as { error?: string; channels?: string[]; approvedAssetCount?: number };
      if (!response.ok) throw new Error(data.error ?? "Zoho Social export failed");
      onNotice(`Zoho Social handoff queued for ${data.channels?.join(", ") ?? "selected channels"} with ${data.approvedAssetCount ?? 0} approved asset(s).`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Zoho Social export failed. No handoff was queued.");
    } finally {
      setZohoSending(false);
    }
  }

  const selectedRecommendation = recommendations.find((item) => item.asset.id === selectedAssetId) ?? recommendations[0] ?? null;
  const selectedAsset = selectedRecommendation?.asset ?? null;
  const similar = selectedAsset ? recommendations.filter((item) => item.asset.id !== selectedAsset.id).sort((left, right) => sharedAssetSignals(selectedAsset, right.asset) - sharedAssetSignals(selectedAsset, left.asset) || right.score - left.score).slice(0, 4) : [];
  const captions = selectedAsset && activeCampaign ? campaignCaptions(selectedAsset, activeCampaign.briefFields) : [];
  const headlines = selectedAsset && activeCampaign ? campaignHeadlines(selectedAsset, activeCampaign.briefFields) : [];
  const readability = (() => {
    const words = copyDraft.trim().split(/\s+/).filter(Boolean);
    const long = words.filter((word) => word.length > 14).length;
    return { words: words.length, pass: words.length <= 12 && long === 0, note: words.length <= 12 ? "Short enough for a first mobile pass." : "Trim this for a faster mobile read." };
  })();

  if (loading) return <main className="campaign-page"><div className="empty-state">Loading campaign intelligence…</div></main>;

  const zohoSocialAction = activeCampaign ? <button type="button" className="outline-button" disabled={zohoSending} onClick={() => void sendToZohoSocial()}>{zohoSending ? "Queueing Zoho Social..." : "Send to Zoho Social"}</button> : null;
  return <main className="campaign-page">{zohoSocialAction}
    <section className="campaign-hero"><div><span className="section-kicker">PHASE 5 · AI CREATIVE ASSISTANT</span><h1>Make the brief<br /><em>work harder.</em></h1><p>Rank, reformat, caption, and check a campaign while every licensed source stays visible and under your control.</p></div><div className="assistant-boundary"><strong>Rights-aware by default</strong><span>AI suggestions are labelled. Licensed contributor media is never silently replaced with generated media.</span></div></section>

    <section className="campaign-setup">
      <aside className="campaign-sidebar"><div className="card-heading"><span className="section-kicker">YOUR CAMPAIGNS</span><span>{campaigns.length}</span></div>{campaigns.length ? <div className="campaign-list">{campaigns.map((campaign) => <button type="button" className={`campaign-select ${campaign.id === activeId ? "selected" : ""}`} key={campaign.id} onClick={() => setActiveId(campaign.id)}><span><strong>{campaign.name}</strong><small>{campaign.assetCounts.approved} approved · {campaign.assetCounts.shortlisted} shortlisted</small></span><b>↗</b></button>)}</div> : <p className="campaign-empty">No campaign workspace yet. Start with a reusable launch brief.</p>}<button type="button" className="outline-button campaign-preset" onClick={applyPropertyPreset}>Use property launch preset</button></aside>
      <form className="campaign-brief-card" onSubmit={createCampaign}><div className="card-heading"><span className="section-kicker">NEW CAMPAIGN / BRIEF</span><span className="status-pill cool">Human control</span></div><div className="two-fields"><label>Campaign name<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Cape Town property launch" /></label><label>Industry<input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="Property" /></label></div><label>What are you making?<textarea required minLength={20} maxLength={5000} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Describe the audience, offer, tone, formats, and usage rights…" /></label><div className="campaign-form-row"><div><span className="form-label">CHANNELS</span><div className="campaign-checks">{campaignPlatformOptions.map((platform) => <label className="checkbox-row" key={platform}><input type="checkbox" checked={selectedPlatforms.includes(platform)} onChange={(event) => setSelectedPlatforms((current) => event.target.checked ? [...new Set([...current, platform])] : current.filter((value) => value !== platform))} /> {campaignPlatformLabel(platform)}</label>)}</div></div><label className="campaign-tone">Tone<input value={tone} onChange={(event) => setTone(event.target.value)} placeholder="warm, premium, direct" /></label></div><div className="two-fields"><label>Brand colours<input value={brandColours} onChange={(event) => setBrandColours(event.target.value)} placeholder="terracotta, sage, cream" /></label><label>Logo / safe-area notes<input value={logoNotes} onChange={(event) => setLogoNotes(event.target.value)} placeholder="Keep logo clear of subject" /></label></div><div className="two-fields"><label>Forbidden styles<input value={forbiddenStyles} onChange={(event) => setForbiddenStyles(event.target.value)} placeholder="generic stock, heavy filters" /></label><label>Preferred visual direction<input value={preferredVisuals} onChange={(event) => setPreferredVisuals(event.target.value)} /></label></div><button className="dark-button" disabled={saving}>{saving ? "Saving brief…" : "Create campaign workspace"} <span>↗</span></button></form>
    </section>

    {activeCampaign && <section className="campaign-editor"><div className="campaign-editor-heading"><div><span className="section-kicker">ACTIVE WORKSPACE</span><h2>{activeCampaign.name}</h2><p>{activeCampaign.brief}</p></div><button className="outline-button" type="button" onClick={() => void downloadManifest()}>Export campaign pack ↗</button></div><div className="brief-pills"><span>{activeCampaign.briefFields.usageRights} use</span>{activeCampaign.briefFields.platforms.map((platform) => <span key={platform}>{campaignPlatformLabel(platform)}</span>)}{activeCampaign.briefFields.tone.map((value) => <span key={value}>{value}</span>)}</div>
      {isBuyer && <section className={`campaign-terms-gate ${buyerTermsAccepted ? "accepted" : ""}`} aria-labelledby="campaign-terms-heading"><div className="card-heading"><div><span className="section-kicker">BUYER APPROVAL GATE</span><h3 id="campaign-terms-heading">Read the terms before approving a pack source.</h3></div><span className={`status-pill ${buyerTermsAccepted ? "cool" : "warm"}`}>{buyerTermsAccepted ? "Accepted" : "Required"}</span></div><p>Approval confirms that your campaign will use the contributor's media only within the displayed licence, territory, duration, attribution, and restrictions. It does not transfer copyright.</p><details onToggle={(event) => { if (event.currentTarget.open) setBuyerTermsViewed(true); }}><summary>View buyer licence and payment terms · {buyerAgreement.version} / {paymentDisclosure.version}</summary><div className="campaign-terms-copy"><h4>{buyerAgreement.title}</h4>{buyerAgreement.sections.map((section) => <section key={section.heading}><strong>{section.heading}</strong><p>{section.body}</p></section>)}<h4>{paymentDisclosure.title}</h4>{paymentDisclosure.sections.map((section) => <section key={section.heading}><strong>{section.heading}</strong><p>{section.body}</p></section>)}</div></details><label className="checkbox-row campaign-terms-check"><input type="checkbox" checked={buyerTermsAccepted} disabled={!buyerTermsViewed || termsSaving} onChange={() => void acceptBuyerCampaignTerms()} /> I have read and accept these current terms for this campaign pack.</label>{!buyerTermsViewed && <small className="field-help">Open “View buyer licence and payment terms” first. The approval buttons stay locked until the terms are viewed and accepted.</small>}</section>}
       <div className="campaign-results"><section><div className="card-heading campaign-section-heading"><div><span className="section-kicker">MARKETING ASSET INTELLIGENCE</span><h3>Ranked for this brief</h3></div><span>{recommendations.length} published sources</span></div>{recommendations.length ? <div className="campaign-recommendations">{recommendations.slice(0, 12).map((item) => <article className={`campaign-recommendation ${item.asset.id === selectedAsset?.id ? "selected" : ""}`} key={item.asset.id}><button type="button" className="recommendation-select" onClick={() => setSelectedAssetId(item.asset.id)}><AssetPreview asset={item.asset} className={`recommendation-preview ${item.asset.kind}`} /><div className="recommendation-copy"><div className="card-heading"><span className="section-kicker">{item.asset.kind} · {item.asset.city ?? item.asset.country}</span><strong>{item.score}% fit</strong></div><h4>{item.asset.title}</h4><p>{item.reasons[0]}</p><div className="recommendation-meta"><span>Rights {item.asset.rightsStatus}</span><span>{item.warnings.length ? `${item.warnings.length} review note${item.warnings.length === 1 ? "" : "s"}` : "No stored blockers"}</span></div></div></button><div className="recommendation-actions"><button type="button" className="text-button" onClick={() => onOpen(item.asset)}>Inspect source</button>{item.stage === "approved" ? <button type="button" className="approve-button" onClick={() => void changeStage(item, "shortlisted")}>Approved ✓</button> : <button type="button" className="outline-button" onClick={() => void changeStage(item, "approved")} disabled={!item.usable || (isBuyer && (!buyerTermsViewed || !buyerTermsAccepted))}>{!item.usable ? "Rights blocked" : isBuyer && (!buyerTermsViewed || !buyerTermsAccepted) ? "Read terms to approve" : "Approve for pack"}</button>}</div>{item.warnings.length > 0 && <div className="recommendation-warnings">{item.warnings.slice(0, 2).map((warning) => <p className={`warning-${warning.severity}`} key={warning.code}><strong>{warning.label}</strong> {warning.detail}</p>)}</div>}</article>)}</div> : <div className="empty-state">No published assets are available for this organization yet.</div>}</section>

        <aside className="creative-assistant"><div className="assistant-heading"><div><span className="section-kicker">INSIDE THE EDITOR</span><h3>Creative assistant</h3></div><span className="ai-badge">AI SUGGESTION</span></div><p className="assistant-intro">Choose an action. Each result explains what it used, and the source asset remains the licensed contributor media.</p>{recommendations.length > 0 && <label className="assistant-source">Working source<select value={selectedAsset?.id ?? ""} onChange={(event) => setSelectedAssetId(event.target.value)}>{recommendations.slice(0, 12).map((item) => <option key={item.asset.id} value={item.asset.id}>{item.asset.title}</option>)}</select></label>}<div className="assistant-tools">{assistantTools.map((tool) => <button type="button" key={tool.id} className={assistantTool === tool.id ? "active" : ""} onClick={() => setAssistantTool(tool.id)}>{tool.label}<span>→</span></button>)}</div>{selectedAsset ? <div className="assistant-output">
          {assistantTool === "similar" && <><AssistantOutputHeading title="Similar, ranked candidates" detail="Based on the active brief, stored tags, place, and rights metadata." />{similar.map((item) => <button className="assistant-result" type="button" key={item.asset.id} onClick={() => setSelectedAssetId(item.asset.id)}><span><strong>{item.asset.title}</strong><small>{item.asset.city ?? item.asset.country} · {sharedAssetSignals(selectedAsset, item.asset)} shared signals</small></span><b>{item.score}%</b></button>)}</>}
          {assistantTool === "story" && <><AssistantOutputHeading title="Instagram Story direction" detail="A 9:16 art direction plan using the selected licensed source." /><div className="format-preview story"><span>9:16</span><strong>{selectedAsset.title}</strong><small>Keep source media · reserve UI-safe edges</small></div>{cropAdvice(selectedAsset, "instagram").map((line) => <p className="assistant-line" key={line}>{line}</p>)}</>}
          {assistantTool === "crop" && <><AssistantOutputHeading title="Suggested crop" detail="Layout guidance only; the original file stays unchanged." /><div className="crop-options">{(["instagram", "web", "email"] as const).map((platform) => <article key={platform}><span>{platform === "web" ? "WEBSITE" : platform.toUpperCase()}</span><strong>{platform === "instagram" ? "9:16" : platform === "web" ? "16:9" : "1:1 / 4:3"}</strong><p>{cropAdvice(selectedAsset, platform)[0]}</p></article>)}</div></>}
          {assistantTool === "captions" && <><AssistantOutputHeading title="Caption options" detail="AI-written copy suggestion · edit before publishing." />{captions.map((caption, index) => <div className="copy-option" key={caption}><span>0{index + 1}</span><p>{caption}</p><button type="button" onClick={() => setCopyDraft(caption)}>Use for readability check</button></div>)}</>}
          {assistantTool === "headlines" && <><AssistantOutputHeading title="Five headline options" detail="AI-written copy suggestion · no media was generated." />{headlines.map((headline, index) => <div className="copy-option" key={headline}><span>0{index + 1}</span><p>{headline}</p><button type="button" onClick={() => setCopyDraft(headline)}>Check readability</button></div>)}</>}
          {assistantTool === "readability" && <><AssistantOutputHeading title="Readability check" detail="Copy-length heuristic; verify contrast on the final crop." /><label className="copy-editor">Test copy<textarea value={copyDraft} onChange={(event) => setCopyDraft(event.target.value)} /></label><div className={`readability-result ${readability.pass ? "pass" : "review"}`}><strong>{readability.pass ? "Good first pass" : "Needs a shorter pass"}</strong><span>{readability.words} words · {readability.note}</span></div><p className="assistant-line">Contrast and safe-area placement still need a final human check on the chosen crop.</p></>}
          {assistantTool === "copy-space" && <><AssistantOutputHeading title="Left copy-space candidates" detail="Heuristic ranking from wide, flexible licensed sources—not a visual guarantee." />{recommendations.filter((item) => item.asset.kind === "image" && (item.asset.mediaOrientation === "landscape" || !item.asset.mediaOrientation)).slice(0, 4).map((item) => <button className="assistant-result" type="button" key={item.asset.id} onClick={() => setSelectedAssetId(item.asset.id)}><span><strong>{item.asset.title}</strong><small>Wide canvas candidate · verify the left third visually</small></span><b>{item.readiness.web}%</b></button>)}<p className="assistant-disclaimer">No pixel-level copy-space claim is made from metadata alone.</p></>}
          {assistantTool === "pack" && <><AssistantOutputHeading title="Property launch pack" detail="A structured pack of approved source references, rights warnings, and channel readiness." /><div className="pack-checklist"><span>01 · Shortlist and approve licensed sources</span><span>02 · Review commercial warnings and releases</span><span>03 · Export source manifest for production</span><span>04 · Art-direct channel variants</span></div><button type="button" className="dark-button" onClick={() => void downloadManifest()}>Export approved source manifest ↗</button></>}
          {assistantTool === "rights" && <><AssistantOutputHeading title="Commercial-use warning" detail="Stored rights evidence is shown before creative approval." />{selectedRecommendation.warnings.length ? selectedRecommendation.warnings.map((warning) => <div className={`rights-warning ${warning.severity}`} key={warning.code}><strong>{warning.label}</strong><p>{warning.detail}</p></div>) : <div className="readability-result pass"><strong>No stored blocker</strong><span>Rights are marked usable for this brief. Confirm the final licence scope and territory before release.</span></div>}<div className="rights-summary"><span>Source: <b>Licensed contributor media</b></span><span>Rights: <b>{selectedAsset.rightsStatus}</b></span><span>Generated media: <b>None</b></span></div></>}
          {assistantTool === "variants" && <><AssistantOutputHeading title="Channel variant plan" detail="Reformatting instructions keep one traceable licensed source across every output." /><div className="variant-grid">{(["linkedin", "instagram", "web", "email"] as const).map((platform) => <article key={platform}><span>{campaignPlatformLabel(platform)}</span><strong>{platform === "instagram" ? "9:16 Story" : platform === "linkedin" ? "1.91:1" : platform === "web" ? "16:9 Hero" : "4:3 / 1:1"}</strong><small>{cropAdvice(selectedAsset, platform === "linkedin" ? "linkedin" : platform)[0]}</small><em>Source: {selectedAsset.id.slice(0, 12)}…</em></article>)}</div><p className="assistant-disclaimer">These are production-ready directions, not silently generated replacements.</p></>}
        </div> : <div className="assistant-empty">Select a ranked source to start. The assistant will keep the asset ID and rights status attached to every suggestion.</div>}</aside>
       </div>
      {activeCampaign && <CampaignDeliveryPanel campaign={activeCampaign} selectedAssetId={selectedAssetId} assets={campaignAssets} editVersions={editVersions} derivatives={derivatives} bundles={bundles} licenceMetadata={licenceMetadata} blockers={campaignBlockers} role={role} api={api} onNotice={onNotice} onRefresh={() => void loadCampaign(activeCampaign.id)} />}
    </section>}
  </main>;
}

function AssistantOutputHeading({ title, detail }: { title: string; detail: string }) {
  return <div className="assistant-output-heading"><h4>{title}</h4><p>{detail}</p></div>;
}

type CmsCampaign = { id: string; name: string; briefText: string; brief: Record<string, unknown>; brandKit: BrandKit; status: string; assetCount?: number };
type CmsCampaignAsset = Asset & { campaignStage: "shortlisted" | "rejected" | "approved" | "needs_review"; campaignNote: string; activeLicenceId: string | null };
type CmsDerivative = { id: string; assetId: string; editVersionId: string; campaignId?: string | null; licenceId: string; variant: string; status: string; contentType?: string; contentUrl?: string; sizeBytes: number; width?: number | null; height?: number | null; createdAt: string };
type CmsBundle = { id: string; campaignId?: string; bundleType: string; status: string; buildStatus?: string | null; error?: string | null; expiresAt?: string | null; download?: string | null; createdAt: string; manifest?: Record<string, unknown> };
type CmsLicenceMetadata = { assetId: string; licenceId: string | null; licenceType?: string | null; territory?: string | null; expiresAt?: string | null };
type CmsBlocker = { assetId: string; blockers: Array<{ code: string; message: string }> };
type CmsDetail = { campaign: CmsCampaign; assets: CmsCampaignAsset[]; editVersions: Array<{ id: string; assetId: string; versionNumber: number; recipe: EditRecipe; note: string; createdAt: string }>; derivatives: CmsDerivative[]; bundles: CmsBundle[]; licenceMetadata?: CmsLicenceMetadata[]; blockers?: CmsBlocker[]; buyerTermsAccepted?: boolean };

function LegacyImageEditor({ asset, versions, licenceId, campaignId, api, onNotice, onSaved }: { asset: CmsCampaignAsset; versions: CmsDetail["editVersions"]; licenceId: string | null; campaignId: string; api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; onSaved: () => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null); const [recipe, setRecipe] = useState<EditRecipe>(() => defaultEditRecipe()); const [image, setImage] = useState<HTMLImageElement | null>(null); const [guides, setGuides] = useState(true); const [beforeAfter, setBeforeAfter] = useState(false); const [saving, setSaving] = useState(false);
  useEffect(() => { setRecipe(defaultEditRecipe()); setBeforeAfter(false); if (!asset.previewUrl) { setImage(null); return; } const next = new Image(); next.onload = () => setImage(next); next.onerror = () => setImage(null); next.src = asset.previewUrl; }, [asset.id, asset.previewUrl]);
  const render = useCallback((exporting = false) => { const canvas = canvasRef.current; if (!canvas || !image) return; const preset = cropPresets[recipe.preset]; canvas.width = preset.width; canvas.height = preset.height; const ctx = canvas.getContext("2d"); if (!ctx) return; const crop = fitCrop(image.naturalWidth, image.naturalHeight, preset.ratio); ctx.save(); ctx.fillStyle = "#1d211d"; ctx.fillRect(0, 0, canvas.width, canvas.height); if (recipe.background !== "none") { ctx.filter = "blur(28px) saturate(115%)"; ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height); ctx.filter = "none"; } ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(((recipe.rotation + recipe.straighten) * Math.PI) / 180); ctx.scale(recipe.flipX ? -1 : 1, recipe.flipY ? -1 : 1); ctx.filter = exporting || !beforeAfter ? `brightness(${recipe.brightness}%) contrast(${recipe.contrast}%) saturate(${recipe.saturation}%)` : "none"; ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height); ctx.restore(); if (recipe.warmth !== 0 && (exporting || !beforeAfter)) { ctx.save(); ctx.globalAlpha = Math.abs(recipe.warmth) / 180; ctx.fillStyle = recipe.warmth > 0 ? "#f3a45e" : "#77a9d6"; ctx.globalCompositeOperation = "soft-light"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); } if (!exporting && guides && !beforeAfter) { ctx.save(); ctx.strokeStyle = "rgba(255,250,240,.7)"; ctx.setLineDash([8, 8]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(canvas.width / 3, 0); ctx.lineTo(canvas.width / 3, canvas.height); ctx.moveTo((canvas.width / 3) * 2, 0); ctx.lineTo((canvas.width / 3) * 2, canvas.height); ctx.moveTo(0, canvas.height / 3); ctx.lineTo(canvas.width, canvas.height / 3); ctx.moveTo(0, (canvas.height / 3) * 2); ctx.lineTo(canvas.width, (canvas.height / 3) * 2); ctx.stroke(); const margin = canvas.width * (safeZonePercent(recipe.logo.safeMargin) / 100); ctx.strokeStyle = "rgba(227,167,92,.85)"; ctx.strokeRect(margin, margin, canvas.width - margin * 2, canvas.height - margin * 2); ctx.restore(); } if (!exporting && !beforeAfter) { ctx.save(); const margin = canvas.width * (safeZonePercent(recipe.logo.safeMargin) / 100); if (recipe.text.value) { ctx.fillStyle = recipe.text.colour; ctx.font = `600 ${Math.max(28, Math.round(canvas.width / 18))}px ${recipe.text.font}`; ctx.textAlign = recipe.text.align; ctx.fillText(recipe.text.value, recipe.text.align === "left" ? margin : recipe.text.align === "right" ? canvas.width - margin : canvas.width / 2, canvas.height - margin * 2.2); } if (recipe.logo.value) { ctx.font = `700 ${Math.max(18, Math.round(canvas.width / 38))}px Arial`; ctx.fillStyle = recipe.text.colour; ctx.textAlign = recipe.logo.position.includes("right") ? "right" : "left"; ctx.fillText(recipe.logo.value, recipe.logo.position.includes("right") ? canvas.width - margin : margin, recipe.logo.position.includes("bottom") ? canvas.height - margin : margin * 1.8); } ctx.restore(); } }, [beforeAfter, guides, image, recipe]);
  useEffect(() => { render(); }, [render]);
  async function saveVersionAndExport() { if (!image) { onNotice("This image has no usable preview yet; finish media processing before editing."); return; } setSaving(true); try { const versionResponse = await api(`/api/assets/${asset.id}/edit-versions`, { method: "POST", body: JSON.stringify({ recipe, note: `${cropPresets[recipe.preset].label} campaign derivative` }) }); if (!versionResponse.ok) throw new Error("version"); const version = await versionResponse.json() as { id: string; versionNumber: number }; if (!licenceId) { onNotice(`Version ${version.versionNumber} saved. Export is locked until an active paid licence is attached.`); onSaved(); return; } const exportCanvas = document.createElement("canvas"); exportCanvas.width = cropPresets[recipe.preset].width; exportCanvas.height = cropPresets[recipe.preset].height; const originalCanvas = canvasRef.current; if (!originalCanvas) throw new Error("canvas"); const exportContext = exportCanvas.getContext("2d"); if (!exportContext) throw new Error("canvas"); render(true); exportContext.drawImage(originalCanvas, 0, 0, exportCanvas.width, exportCanvas.height); const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, "image/webp", .9)); if (!blob) throw new Error("render"); const derivativeResponse = await api(`/api/assets/${asset.id}/derivatives`, { method: "POST", body: JSON.stringify({ editVersionId: version.id, campaignId, licenceId, variant: derivativeForPreset[recipe.preset], contentType: "image/webp", sizeBytes: blob.size, width: exportCanvas.width, height: exportCanvas.height }) }); if (!derivativeResponse.ok) { const detail = await derivativeResponse.json().catch(() => ({})) as { error?: string }; throw new Error(detail.error ?? "derivative"); } const derivative = await derivativeResponse.json() as { uploadUrl: string }; const upload = await api(derivative.uploadUrl, { method: "PUT", body: blob, headers: { "Content-Type": "image/webp" } }); if (!upload.ok) throw new Error("upload"); onNotice(`Version ${version.versionNumber} exported as ${cropPresets[recipe.preset].label}. The original remains unchanged.`); onSaved(); } catch (error) { onNotice(error instanceof Error && error.message.includes("licence") ? error.message : "The edit could not be saved or exported. No source asset was changed."); } finally { setSaving(false); } }
  const setNumber = (key: "brightness" | "contrast" | "saturation" | "warmth" | "sharpen", value: number) => setRecipe((current) => ({ ...current, [key]: value }));
  return <section className="cms-editor"><div className="cms-editor-toolbar"><div><span className="section-kicker">IMAGE EDITOR · SOURCE {asset.id.slice(0, 10)}</span><h3>{asset.title}</h3><small>Original is immutable · {asset.activeLicenceId ? "Active licence attached" : "Licence required for export"}</small></div><div className="editor-toolbar-actions"><button type="button" className="ghost-button" onClick={() => setBeforeAfter((value) => !value)}>{beforeAfter ? "Show edited" : "Before / after"}</button><button type="button" className="dark-button" disabled={saving} onClick={() => void saveVersionAndExport()}>{saving ? "Saving…" : "Save version & export"}</button></div></div>{!image ? <div className="editor-unavailable">Preview unavailable. The editor keeps the source safe until a processed image preview is available.</div> : <div className="cms-editor-grid"><div className="editor-canvas-wrap"><canvas ref={canvasRef} aria-label="Campaign image preview" /><div className="editor-caption"><span>Rule of thirds</span><span>Copy-safe zone</span><span>{cropPresets[recipe.preset].width} × {cropPresets[recipe.preset].height}</span></div></div><div className="editor-controls"><label>Crop preset<select value={recipe.preset} onChange={(event) => setRecipe((current) => ({ ...current, preset: event.target.value as CropPreset }))}>{Object.entries(cropPresets).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><div className="editor-button-row"><button type="button" onClick={() => setRecipe((current) => ({ ...current, rotation: current.rotation - 90 }))}>Rotate left</button><button type="button" onClick={() => setRecipe((current) => ({ ...current, rotation: current.rotation + 90 }))}>Rotate right</button><button type="button" onClick={() => setRecipe((current) => ({ ...current, flipX: !current.flipX }))}>Flip</button></div><label>Guides<select value={guides ? "on" : "off"} onChange={(event) => setGuides(event.target.value === "on")}><option value="on">Rule of thirds + safe zone</option><option value="off">Hidden</option></select></label>{(["brightness", "contrast", "saturation", "warmth", "sharpen"] as const).map((key) => <label key={key} className="range-row"><span>{key[0].toUpperCase() + key.slice(1)} <b>{recipe[key]}</b></span><input type="range" min={key === "warmth" ? -50 : 0} max={key === "warmth" ? 50 : 200} value={recipe[key]} onChange={(event) => setNumber(key, Number(event.target.value))} /></label>)}<label>Background treatment<select value={recipe.background} onChange={(event) => setRecipe((current) => ({ ...current, background: event.target.value as EditRecipe["background"] }))}><option value="none">None</option><option value="blur">Blur behind crop</option><option value="extend">Soft extension</option></select></label><label>Text overlay<input value={recipe.text.value} onChange={(event) => setRecipe((current) => ({ ...current, text: { ...current.text, value: event.target.value } }))} placeholder="Campaign headline" /></label><div className="two-fields"><label>Brand font<input value={recipe.text.font} onChange={(event) => setRecipe((current) => ({ ...current, text: { ...current.text, font: event.target.value } }))} /></label><label>Colour<input type="color" value={recipe.text.colour} onChange={(event) => setRecipe((current) => ({ ...current, text: { ...current.text, colour: event.target.value } }))} /></label></div><label>Logo / wordmark<input value={recipe.logo.value} onChange={(event) => setRecipe((current) => ({ ...current, logo: { ...current.logo, value: event.target.value } }))} placeholder="Brand mark text" /></label><label>Logo placement<select value={recipe.logo.position} onChange={(event) => setRecipe((current) => ({ ...current, logo: { ...current.logo, position: event.target.value as EditRecipe["logo"]["position"] } }))}><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select></label>{versions.length > 0 && <div className="version-history"><span className="section-kicker">VERSION HISTORY</span>{versions.slice(0, 5).map((version) => <button type="button" key={version.id} onClick={() => setRecipe(version.recipe)}><span>v{version.versionNumber}</span><small>{new Date(version.createdAt).toLocaleString("en-ZA")}</small></button>)}</div>}</div></div>}</section>;
}

function AuthenticatedDerivativeEditor({ asset, versions, licenceId, campaignId, api, onNotice, onSaved }: { asset: CmsCampaignAsset; versions: CmsDetail["editVersions"]; licenceId: string | null; campaignId: string; api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; onSaved: () => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [recipe, setRecipe] = useState<EditRecipe>(() => defaultEditRecipe());
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<"idle" | "unavailable" | "licence_required" | "failed">("idle");
  const [error, setError] = useState("");
  useEffect(() => {
    setRecipe(defaultEditRecipe());
    setState("idle");
    setError("");
    if (!asset.previewUrl) { setImage(null); setState("unavailable"); return; }
    const next = new Image();
    next.onload = () => { setImage(next); setState("idle"); };
    next.onerror = () => { setImage(null); setState("unavailable"); };
    next.src = asset.previewUrl;
  }, [asset.id, asset.previewUrl]);
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const preset = cropPresets[recipe.preset];
    canvas.width = preset.width;
    canvas.height = preset.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const crop = fitCrop(image.naturalWidth, image.naturalHeight, preset.ratio);
    context.fillStyle = "#1d211d";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.filter = `brightness(${recipe.brightness}%) contrast(${recipe.contrast}%) saturate(${recipe.saturation}%)`;
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    context.filter = "none";
  }, [image, recipe]);
  useEffect(() => { render(); }, [render]);
  async function saveVersionAndExport(): Promise<void> {
    if (!image) { setState("unavailable"); setError("Preview unavailable. Finish media processing before editing."); return; }
    if (!licenceId) { setState("licence_required"); setError("An active paid licence is required before an authenticated derivative can be exported."); return; }
    setSaving(true); setState("idle"); setError("");
    try {
      const versionResponse = await api(`/api/assets/${encodeURIComponent(asset.id)}/edit-versions`, { method: "POST", body: JSON.stringify({ recipe, note: `${cropPresets[recipe.preset].label} campaign derivative`, campaignId, licenceId }) });
      const versionBody = await versionResponse.json().catch(() => ({})) as { id?: string; versionNumber?: number; error?: string };
      if (!versionResponse.ok || !versionBody.id) throw new Error(versionBody.error ?? "The edit version could not be saved.");
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = cropPresets[recipe.preset].width;
      exportCanvas.height = cropPresets[recipe.preset].height;
      const exportContext = exportCanvas.getContext("2d");
      if (!exportContext) throw new Error("The browser could not prepare the derivative.");
      render();
      if (!canvasRef.current) throw new Error("The browser preview is unavailable.");
      exportContext.drawImage(canvasRef.current, 0, 0, exportCanvas.width, exportCanvas.height);
      const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, "image/webp", .9));
      if (!blob) throw new Error("The browser could not encode the derivative.");
      const derivativeResponse = await api(`/api/assets/${encodeURIComponent(asset.id)}/derivatives`, { method: "POST", body: JSON.stringify({ editVersionId: versionBody.id, campaignId, licenceId, variant: derivativeForPreset[recipe.preset], contentType: "image/webp", sizeBytes: blob.size, width: exportCanvas.width, height: exportCanvas.height }) });
      const derivativeBody = await derivativeResponse.json().catch(() => ({})) as { contentUrl?: string; error?: string };
      if (!derivativeResponse.ok || !derivativeBody.contentUrl) throw new Error(derivativeBody.error ?? "The derivative could not be created.");
      const uploadResponse = await api(derivativeBody.contentUrl, { method: "PUT", body: blob, headers: { "Content-Type": "image/webp" } });
      if (!uploadResponse.ok) { const uploadBody = await uploadResponse.json().catch(() => ({})) as { error?: string }; throw new Error(uploadBody.error ?? "The derivative upload failed."); }
      onNotice(`Version ${versionBody.versionNumber ?? ""} exported. The original remains unchanged.`);
      onSaved();
    } catch (failure) {
      setState("failed");
      setError(failure instanceof Error ? failure.message : "The edit could not be saved or exported.");
      onNotice("The edit could not be saved or exported. The source asset was not changed.");
    } finally { setSaving(false); }
  }
  const setNumber = (key: "brightness" | "contrast" | "saturation", value: number) => setRecipe((current) => ({ ...current, [key]: value }));
  return <section className="cms-editor" aria-labelledby="authenticated-editor-heading"><div className="cms-editor-toolbar"><div><span className="section-kicker">AUTHENTICATED DERIVATIVE EDITOR</span><h3 id="authenticated-editor-heading">{asset.title}</h3><small>Original is immutable Â· {licenceId ? "Active licence attached" : "Licence required for export"}</small></div><button type="button" className="dark-button" disabled={saving} onClick={() => void saveVersionAndExport()}>{saving ? "Saving and uploadingâ€¦" : "Save version & export"}</button></div>{state === "unavailable" && <div className="editor-unavailable" role="status">Preview unavailable. Retry after the source preview has finished processing.</div>}{state === "licence_required" && <div className="editor-unavailable" role="alert">Licence required. A valid, paid, non-expired licence owned by this organization must be attached before export.</div>}{state === "failed" && <div className="editor-unavailable" role="alert">{error || "The export failed."} <button type="button" className="text-button" onClick={() => void saveVersionAndExport()}>Retry export</button></div>}{image && <div className="cms-editor-grid"><div className="editor-canvas-wrap"><canvas ref={canvasRef} aria-label="Authenticated derivative preview" /><div className="editor-caption"><span>Source remains unchanged</span><span>{cropPresets[recipe.preset].width} Ã— {cropPresets[recipe.preset].height}</span></div></div><div className="editor-controls"><label>Crop preset<select value={recipe.preset} onChange={(event) => setRecipe((current) => ({ ...current, preset: event.target.value as CropPreset }))}>{Object.entries(cropPresets).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>{(["brightness", "contrast", "saturation"] as const).map((key) => <label key={key} className="range-row"><span>{key[0].toUpperCase() + key.slice(1)} <b>{recipe[key]}</b></span><input type="range" min="0" max="200" value={recipe[key]} onChange={(event) => setNumber(key, Number(event.target.value))} /></label>)}{versions.length > 0 && <div className="version-history"><span className="section-kicker">VERSION HISTORY</span>{versions.slice(0, 5).map((version) => <button type="button" key={version.id} onClick={() => setRecipe(version.recipe)}><span>v{version.versionNumber}</span><small>{new Date(version.createdAt).toLocaleString("en-ZA")}</small></button>)}</div>}</div></div>}</section>;
}

function ImageEditor(props: { asset: CmsCampaignAsset; versions: CmsDetail["editVersions"]; licenceId: string | null; campaignId: string; api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; onSaved: () => void }) {
  return <AuthenticatedDerivativeEditor {...props} />;
}

function CampaignDeliveryPanel({ campaign, selectedAssetId, assets, editVersions, derivatives, bundles, licenceMetadata, blockers, role, api, onNotice, onRefresh }: { campaign: CampaignSummary; selectedAssetId: string; assets: CmsCampaignAsset[]; editVersions: CmsDetail["editVersions"]; derivatives: CmsDerivative[]; bundles: CmsBundle[]; licenceMetadata: CmsLicenceMetadata[]; blockers: CmsBlocker[]; role?: string; api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; onRefresh: () => void }) {
  const [bundleType, setBundleType] = useState("social_media");
  const [bundleBusy, setBundleBusy] = useState("");
  const selected = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0] ?? null;
  const licence = selected ? licenceMetadata.find((item) => item.assetId === selected.id) : undefined;
  const selectedBlockers = selected ? blockers.find((item) => item.assetId === selected.id)?.blockers ?? [] : [];
  const selectedDerivatives = selected ? derivatives.filter((item) => item.assetId === selected.id) : [];
  async function requestBundle(): Promise<void> {
    setBundleBusy("request");
    try {
      const response = await api(`/api/campaigns/${encodeURIComponent(campaign.id)}/bundles`, { method: "POST", body: JSON.stringify({ bundleType }) });
      const body = await response.json().catch(() => ({})) as { error?: string; blockers?: Array<{ message?: string }> };
      if (!response.ok) throw new Error(body.blockers?.[0]?.message ?? body.error ?? "The bundle is not ready.");
      onNotice("Bundle requested. A reviewer must approve the auditable ZIP before download."); onRefresh();
    } catch (failure) { onNotice(failure instanceof Error ? failure.message : "The bundle request failed."); }
    finally { setBundleBusy(""); }
  }
  async function approveBundle(bundle: CmsBundle): Promise<void> {
    setBundleBusy(bundle.id);
    try {
      const response = await api(`/api/campaigns/${encodeURIComponent(campaign.id)}/bundles/${encodeURIComponent(bundle.id)}/approve`, { method: "POST", body: "{}" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Bundle approval failed.");
      onNotice("Bundle approved and built as an auditable streamed ZIP."); onRefresh();
    } catch (failure) { onNotice(failure instanceof Error ? failure.message : "Bundle approval failed."); }
    finally { setBundleBusy(""); }
  }
  return <section className="cms-delivery-panel" aria-labelledby="campaign-delivery-heading"><div className="card-heading"><div><span className="section-kicker">CAMPAIGN DELIVERY</span><h3 id="campaign-delivery-heading">Versions, derivatives, and auditable bundles</h3></div><span className="status-pill cool">Server-authoritative</span></div>{selected ? <><div className="delivery-evidence"><div><strong>{selected.title}</strong><small>{selected.campaignStage.replaceAll("_", " ")} Â· {selected.rightsStatus}</small></div><div><strong>{licence?.licenceId ? "Licence active" : "Licence required"}</strong><small>{licence?.territory ?? "No territory"}{licence?.expiresAt ? ` Â· expires ${new Date(licence.expiresAt).toLocaleDateString("en-ZA")}` : ""}</small></div></div>{selectedBlockers.length > 0 && <div className="recommendation-warnings" role="status">{selectedBlockers.map((blocker) => <p className="warning-warning" key={blocker.code}><strong>{blocker.code.replaceAll("_", " ")}</strong> {blocker.message}</p>)}</div>}{selected.kind === "image" ? <AuthenticatedDerivativeEditor asset={selected} versions={editVersions.filter((version) => version.assetId === selected.id)} licenceId={selected.activeLicenceId ?? licence?.licenceId ?? null} campaignId={campaign.id} api={api} onNotice={onNotice} onSaved={onRefresh} /> : <div className="editor-unavailable" role="status">Video campaign sources expose Stream processing status here. Image derivatives are edited from the desktop editor after a preview is ready.</div>}<div className="delivery-status-list"><div className="card-heading"><span className="section-kicker">DERIVATIVE STATUS</span><span>{selectedDerivatives.length}</span></div>{selectedDerivatives.length ? selectedDerivatives.map((derivative) => <div className="delivery-status-row" key={derivative.id}><span>{derivative.variant.replaceAll("_", " ")}</span><strong>{derivative.status}</strong><small>{derivative.sizeBytes.toLocaleString()} bytes</small></div>) : <p>No derivative has been created for this campaign asset yet.</p>}</div></> : <div className="empty-state">Select a campaign asset that has been added to the board before opening the authenticated editor.</div>}<div className="bundle-history"><div className="card-heading"><div><span className="section-kicker">BUNDLE HISTORY</span><h4>Approval and download status</h4></div><div className="bundle-request-controls"><label>Bundle type<select value={bundleType} onChange={(event) => setBundleType(event.target.value)}><option value="social_media">Social media</option><option value="website">Website</option><option value="paid_ads">Paid ads</option><option value="print_handoff">Print handoff</option><option value="full_archive">Full archive</option></select></label><button type="button" className="outline-button" disabled={bundleBusy === "request"} onClick={() => void requestBundle()}>{bundleBusy === "request" ? "Requestingâ€¦" : "Request bundle"}</button></div></div>{bundles.length ? bundles.map((bundle) => <div className="delivery-status-row" key={bundle.id}><span>{bundle.bundleType.replaceAll("_", " ")}</span><strong>{bundle.status === "building" || bundle.buildStatus === "building" ? "building" : bundle.status}</strong>{bundle.error && <small>{bundle.error}</small>}{bundle.status === "approved" && bundle.download ? <a className="outline-button" href={bundle.download}>Authenticated download</a> : null}{["pending", "failed"].includes(bundle.status) && ["editor", "admin"].includes(role ?? "") ? <button type="button" className="dark-button" disabled={Boolean(bundleBusy)} onClick={() => void approveBundle(bundle)}>{bundleBusy === bundle.id ? "Buildingâ€¦" : bundle.status === "failed" ? "Retry and approve" : "Approve and build"}</button> : null}</div>) : <p>No bundle requests yet. A ready derivative and valid licence are required before requesting delivery.</p>}</div></section>;
}

function CmsCampaignWorkspace({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [campaigns, setCampaigns] = useState<CmsCampaign[]>([]); const [detail, setDetail] = useState<CmsDetail | null>(null); const [assets, setAssets] = useState<Asset[]>([]); const [selectedId, setSelectedId] = useState(""); const [name, setName] = useState(""); const [briefText, setBriefText] = useState(""); const [bundleType, setBundleType] = useState("social_media"); const selected = detail?.assets.find((asset) => asset.id === selectedId) ?? detail?.assets[0] ?? null;
  const reloadCampaigns = useCallback(async () => { const response = await api("/api/campaigns"); if (response.ok) setCampaigns((await response.json() as { results: CmsCampaign[] }).results); }, [api]);
  const openCampaign = useCallback(async (id: string) => { const response = await api(`/api/campaigns/${id}`); if (!response.ok) { onNotice("Campaign details could not be loaded."); return; } const next = await response.json() as CmsDetail; setDetail(next); setSelectedId(next.assets[0]?.id ?? ""); }, [api, onNotice]);
  useEffect(() => { void reloadCampaigns(); void api("/api/assets?kind=image&status=published&sort=newest").then(async (response) => { if (response.ok) setAssets((await response.json() as SearchResponse).results); }); }, [api, reloadCampaigns]);
  async function createCampaign(event: React.FormEvent) { event.preventDefault(); const response = await api("/api/campaigns", { method: "POST", body: JSON.stringify({ name, briefText, brief: {}, brandKit: { colours: ["#1d211d", "#e3a75c"], logoNotes: "", tone: "", industry: "", forbiddenStyles: [], preferredVisuals: "" } }) }); if (!response.ok) { onNotice("Campaign could not be created."); return; } const created = await response.json() as { id: string }; setName(""); setBriefText(""); await reloadCampaigns(); await openCampaign(created.id); onNotice("Campaign board created."); }
  async function addAsset(assetId: string) { if (!detail) return; const response = await api(`/api/campaigns/${detail.campaign.id}/assets`, { method: "POST", body: JSON.stringify({ assetId, stage: "shortlisted", note: "Added from the asset library" }) }); if (!response.ok) { onNotice("That asset could not be added to the campaign."); return; } await openCampaign(detail.campaign.id); }
  async function moveAsset(asset: CmsCampaignAsset, stage: CmsCampaignAsset["campaignStage"]) { if (!detail) return; const response = await api(`/api/campaigns/${detail.campaign.id}/assets`, { method: "POST", body: JSON.stringify({ assetId: asset.id, stage }) }); if (response.ok) await openCampaign(detail.campaign.id); }
  async function requestBundle() { if (!detail) return; const response = await api(`/api/campaigns/${detail.campaign.id}/bundles`, { method: "POST", body: JSON.stringify({ bundleType }) }); const body = await response.json().catch(() => ({})) as { error?: string; blocked?: string[] }; onNotice(response.ok ? "Bundle requested. An approver must release it before download." : body.blocked?.[0] ?? body.error ?? "Bundle is not ready."); if (response.ok) await openCampaign(detail.campaign.id); }
  async function approveBundle(bundle: CmsBundle) { if (!detail) return; const response = await api(`/api/campaigns/${detail.campaign.id}/bundles/${bundle.id}/approve`, { method: "POST", body: JSON.stringify({}) }); onNotice(response.ok ? "Bundle approved and built as an auditable ZIP." : "Bundle approval was blocked by rights or missing derivatives."); if (response.ok) await openCampaign(detail.campaign.id); }
  return <main className="cms-campaign-page"><section className="workspace-intro"><span className="section-kicker">PHASE 3B + 3C · CMS CAMPAIGN DELIVERY</span><h1>Edit once.<br /><em>Deliver with proof.</em></h1><p>Prepare platform-ready images in minutes, keep the original untouched, and release professional bundles only after rights and approval checks pass.</p></section><div className="cms-campaign-layout"><aside className="cms-campaign-sidebar"><div className="card-heading"><span className="section-kicker">CAMPAIGN BOARD</span><span>{campaigns.length}</span></div>{campaigns.map((campaign) => <button type="button" className={`campaign-picker ${detail?.campaign.id === campaign.id ? "active" : ""}`} key={campaign.id} onClick={() => void openCampaign(campaign.id)}><strong>{campaign.name}</strong><small>{campaign.assetCount ?? 0} assets · {campaign.status}</small></button>)}<form className="cms-new-campaign" onSubmit={createCampaign}><span className="section-kicker">NEW CAMPAIGN</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Campaign name" /><textarea required minLength={10} value={briefText} onChange={(event) => setBriefText(event.target.value)} placeholder="Brief, audience, channels, usage rights…" /><button className="dark-button">Create board</button></form></aside>{detail ? <section className="cms-campaign-main"><div className="cms-board-heading"><div><span className="section-kicker">ACTIVE BOARD</span><h2>{detail.campaign.name}</h2><p>{detail.campaign.briefText}</p></div><div className="bundle-controls"><select value={bundleType} onChange={(event) => setBundleType(event.target.value)}><option value="social_media">Social media pack</option><option value="website">Website pack</option><option value="paid_ads">Paid ads pack</option><option value="print_handoff">Print handoff pack</option><option value="full_archive">Full campaign archive</option></select><button className="outline-button" onClick={() => void requestBundle()}>Request bundle</button></div></div><div className="cms-stage-grid">{(["shortlisted", "needs_review", "approved", "rejected"] as const).map((stage) => <section className="cms-stage" key={stage}><div className="card-heading"><span className="section-kicker">{stage.replaceAll("_", " ")}</span><b>{detail.assets.filter((asset) => asset.campaignStage === stage).length}</b></div>{detail.assets.filter((asset) => asset.campaignStage === stage).map((asset) => <button type="button" className={`cms-asset-card ${asset.id === selected?.id ? "selected" : ""}`} key={asset.id} onClick={() => setSelectedId(asset.id)}><AssetPreview asset={asset} className={`asset-visual ${asset.kind}`} /><strong>{asset.title}</strong><small>{asset.rightsStatus} · {asset.activeLicenceId ? "licence ready" : "licence needed"}</small><span>{stage === "shortlisted" ? "Review →" : stage === "needs_review" ? "Approve →" : stage === "approved" ? "Keep approved" : "Rejected"}</span></button>)}</section>)}</div>{selected && <><div className="cms-asset-actions"><span>Selected: <b>{selected.title}</b></span><div><button className="outline-button" onClick={() => void moveAsset(selected, "needs_review")}>Needs review</button><button className="approve-button" onClick={() => void moveAsset(selected, "approved")}>Approve for bundle</button></div></div><ImageEditor asset={selected} versions={detail.editVersions.filter((version) => version.assetId === selected.id)} licenceId={selected.activeLicenceId} campaignId={detail.campaign.id} api={api} onNotice={onNotice} onSaved={() => void openCampaign(detail.campaign.id)} /></>}{assets.filter((asset) => !detail.assets.some((item) => item.id === asset.id)).slice(0, 8).length > 0 && <section className="cms-add-assets"><div className="card-heading"><span className="section-kicker">ADD FROM ASSET LIBRARY</span><span>Rights status is shown before editing</span></div>{assets.filter((asset) => !detail.assets.some((item) => item.id === asset.id)).slice(0, 8).map((asset) => <button type="button" key={asset.id} onClick={() => void addAsset(asset.id)}><strong>{asset.title}</strong><small>{asset.city ?? asset.country} · {asset.rightsStatus}</small></button>)}</section>}<section className="cms-bundle-history"><div className="card-heading"><div><span className="section-kicker">BUNDLE HISTORY</span><h3>Professional handoff, under approval</h3></div><span>Originals never overwritten</span></div>{detail.bundles.length ? detail.bundles.map((bundle) => <article key={bundle.id}><div><strong>{bundle.bundleType.replaceAll("_", " ")}</strong><small>{bundle.status} · {new Date(bundle.createdAt).toLocaleString("en-ZA")}</small></div>{bundle.status === "pending" && <button className="dark-button" onClick={() => void approveBundle(bundle)}>Approve & build ZIP</button>}{bundle.status === "approved" && <a className="outline-button" href={`/api/campaign-bundles/${bundle.id}/download`}>Download bundle</a>}</article>) : <p>No bundle requests yet. Approve derivatives before requesting a pack.</p>}</section></section> : <section className="cms-empty"><h2>Start a campaign board</h2><p>Use the board to shortlist assets, open the editor from a selected image, and keep every export connected to its licensed source.</p></section>}</div></main>;
}

function CreatorMarketplace({ onOpen }: { onOpen: (asset: Asset) => void }) {
  const [query, setQuery] = useState(""); const [results, setResults] = useState<CreatorProfile[]>([]); const [selected, setSelected] = useState<{ profile: CreatorProfile; assets: Asset[]; collections: PortfolioCollection[] } | null>(null);
  useEffect(() => { const controller = new AbortController(); const params = new URLSearchParams(query ? { q: query } : {}); void fetch(`/api/creators?${params}`, { signal: controller.signal }).then(async (response) => response.ok ? response.json() as Promise<{ results: CreatorProfile[] }> : { results: [] }).then((data) => setResults(data.results)).catch(() => setResults([])); return () => controller.abort(); }, [query]);
  useEffect(() => { const slug = window.location.pathname.match(/^\/creators\/([a-z0-9-]+)$/)?.[1]; if (slug) void openCreator(slug); }, []);
  useEffect(() => { document.title = selected ? `${selected.profile.name} | Veld Archive` : "Creators | Veld Archive"; if (selected) { const meta = document.querySelector('meta[name="description"]') ?? document.head.appendChild(Object.assign(document.createElement("meta"), { name: "description" })); meta.setAttribute("content", selected.profile.headline || selected.profile.bio); } }, [selected]);
  async function openCreator(slug: string) { const response = await fetch(`/api/creators/${slug}`); if (!response.ok) return; setSelected(await response.json() as { profile: CreatorProfile; assets: Asset[]; collections: PortfolioCollection[] }); window.history.replaceState(null, "", `/creators/${slug}`); }
  return <main className="marketplace-page"><section className="marketplace-hero"><span className="section-kicker">CONTRIBUTOR MARKETPLACE</span><h1>Find the people<br /><em>behind the work.</em></h1><p>Search public contributor portfolios by place, practice, and subject.</p><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search creators, places, specialties" aria-label="Search creators" /></section>{selected ? <section className="creator-profile"><button className="text-button" onClick={() => { setSelected(null); window.history.replaceState(null, "", "/creators"); }}>← All creators</button><span className="section-kicker">{selected.profile.location}</span><h2>{selected.profile.name}</h2><h3>{selected.profile.headline}</h3><p>{selected.profile.bio}</p><div className="tag-list">{selected.profile.specialties.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="creator-stats"><span>{selected.profile.assetCount} published records</span><span>{selected.profile.publishedImageCount} published photos</span><span>{selected.profile.collectionCount} public collections</span>{selected.profile.reviewCount > 0 && <span className="review-stat">{selected.profile.reviewCount} held for review</span>}</div><div className="creator-flow" aria-label="Creator publication flow"><strong>PHOTO FLOW</strong><span>Owned upload</span><b>→</b><span>Metadata + rights review</span><b>→</b><span>Published only after approval</span></div>{selected.profile.reviewCount > 0 && <p className="creator-review-note"><strong>{selected.profile.reviewCount} record{selected.profile.reviewCount === 1 ? " is" : "s are"} not public yet.</strong> They remain private to the contributor and editorial team until the required context and rights review is complete.</p>}<h3>Portfolio collections</h3><div className="collection-grid">{selected.collections.map((collection) => <article key={collection.id}><span className="section-kicker">COLLECTION</span><h4>{collection.title}</h4><p>{collection.description}</p><small>{collection.assetCount} assets</small></article>)}</div><h3>More from this artist</h3><p className="creator-grid-note">Published records below are sourced from {selected.profile.name}; each card carries its attributed owner and verification state.</p><div className="asset-grid">{selected.assets.map((asset, index) => <AssetCard key={asset.id} asset={asset} index={index} onOpen={onOpen} />)}</div></section> : <section className="creator-grid">{results.map((creator) => <button className="creator-card" key={creator.id} onClick={() => void openCreator(creator.slug)}><span className="creator-avatar">{creator.name.slice(0, 1)}</span><span className="section-kicker">{creator.location || "South Africa"}</span><h2>{creator.name}</h2><p>{creator.headline}</p><div>{creator.specialties.map((tag) => <small key={tag}>{tag}</small>)}</div><b>{creator.assetCount} assets · {creator.collectionCount} collections →</b></button>)}{results.length === 0 && <div className="empty-state">No public contributors matched that search.</div>}</section>}</main>;
}

function BuyerSubscriptionPanel({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [data, setData] = useState<{ configured: boolean; hasAccess: boolean; sourceOfTruth: string; plans: Array<{ id: "monthly" | "annual"; amountCents: number; currency: string; interval: string }>; plan: { amountCents: number; currency: string; interval: string } | null; subscription: Record<string, unknown> | null; payments: Array<Record<string, unknown>>; free?: { limit: number; used: number; remaining: number } } | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "annual">("monthly");
  const load = useCallback(async () => {
    const [subscriptionResponse, freeResponse] = await Promise.all([api("/api/subscription"), api("/api/my/free-downloads")]);
    if (subscriptionResponse.ok) {
      const subscription = await subscriptionResponse.json() as Omit<NonNullable<typeof data>, "free">;
      const free = freeResponse.ok ? await freeResponse.json() as { limit: number; used: number; remaining: number } : undefined;
      setData({ ...subscription, free });
      if (subscription.plans.length && !subscription.plans.some((plan) => plan.id === selectedPlan)) setSelectedPlan(subscription.plans[0].id);
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  async function startSubscription(): Promise<void> {
    const response = await api("/api/subscription/session", {
      method: "POST",
      body: JSON.stringify({ plan: selectedPlan, successUrl: `${window.location.origin}/account?subscription=complete`, cancelUrl: `${window.location.origin}/account?subscription=cancelled` }),
    });
    const body = await response.json().catch(() => ({})) as { checkoutUrl?: string; error?: string };
    if (!response.ok || !body.checkoutUrl) { onNotice(body.error ?? "Paystack could not start the subscription checkout."); return; }
    window.location.assign(body.checkoutUrl);
  }

  async function buyBundle(credits: number): Promise<void> {
    const response = await api("/api/buyer/credits/checkout", { method: "POST", body: JSON.stringify({ credits, successUrl: `${window.location.origin}/account?bundle=complete`, cancelUrl: `${window.location.origin}/account?bundle=cancelled` }) });
    const body = await response.json().catch(() => ({})) as { checkoutUrl?: string; error?: string };
    if (!response.ok || !body.checkoutUrl) { onNotice(body.error ?? "The download bundle checkout could not be opened."); return; }
    window.location.assign(body.checkoutUrl);
  }
  async function manageSubscription(): Promise<void> {
    const response = await api("/api/subscription/manage-link", { method: "POST" });
    const body = await response.json().catch(() => ({})) as { manageUrl?: string; error?: string };
    if (!response.ok || !body.manageUrl) { onNotice(body.error ?? "Paystack could not open subscription management."); return; }
    window.location.assign(body.manageUrl);
  }
  if (!data) return <article className="buyer-subscription-card"><span className="section-kicker">BUYER SUBSCRIPTION</span><h2>Loading billing status…</h2></article>;
  const subscription = data.subscription;
  const status = String(subscription?.status ?? "not_started");
  const canStart = data.configured && (!subscription || ["cancelled", "completed"].includes(status));
  return <article className="buyer-subscription-card"><div className="card-heading"><div><span className="section-kicker">BUYER ACCESS</span><h2>Try the archive before you subscribe</h2></div><span className={`status-pill ${status === "active" ? "cool" : ""}`}>{status.replaceAll("-", " ")}</span></div>{data.free && <div className="free-download-offer"><strong>{data.free.remaining} free photo download{data.free.remaining === 1 ? "" : "s"} remaining</strong><span>Registered buyers get {data.free.limit} artist-approved photos once, before any payment. No card is needed to claim the allowance.</span></div>}<div className="subscription-plan-choices"><div><span className="section-kicker">UNLIMITED ACCESS</span><h3>Choose monthly or annual</h3><small>Unlimited downloads from artists who participate in membership access.</small></div>{data.plans.map((plan) => <label key={plan.id} className={`subscription-plan-option ${selectedPlan === plan.id ? "selected" : ""}`}><input type="radio" name="buyer-plan" value={plan.id} checked={selectedPlan === plan.id} onChange={() => setSelectedPlan(plan.id)} /><span><strong>{plan.id === "annual" ? "Annual" : "Monthly"}</strong><b>{formatZar(plan.amountCents)}</b><small>{plan.id === "annual" ? "per year" : "per month"}</small></span></label>)}</div>{data.plans.length === 0 && <p>The recurring Paystack plans are not configured for this deployment.</p>}{canStart && data.plans.length > 0 && <button className="dark-button" onClick={() => void startSubscription()}>Start {selectedPlan} unlimited access ↗</button>}{Boolean(subscription?.provider_subscription_code) && ["active", "non-renewing", "attention"].includes(status) && <button className="ghost-button" onClick={() => void manageSubscription()}>Manage billing with Paystack</button>}{status === "pending" && <small>Checkout was started. This account becomes active only after Paystack confirms payment by webhook.</small>}{status === "attention" && <small>Paystack reported a billing issue. Update the card through Paystack before access is changed.</small>}<div className="download-bundle-offer"><div><span className="section-kicker">ON-DEMAND BUNDLES</span><h3>Buy downloads once-off</h3><small>Use credits when you do not need a recurring plan. One credit unlocks one original photo or video licence.</small></div><div className="bundle-options">{[1, 5, 10].map((credits) => <button key={credits} className="outline-button" onClick={() => void buyBundle(credits)}>{credits} download{credits === 1 ? "" : "s"} · {formatZar(credits * 10000)}</button>)}</div></div>{Boolean(data.free && data.free.remaining === 0) && <small>Your introductory allowance is used. A bundle or unlimited plan is the next access step.</small>}{Boolean(subscription?.next_payment_date) && <small>Next payment: {new Date(String(subscription?.next_payment_date)).toLocaleDateString("en-ZA")}</small>}{data.payments.length > 0 && <div className="subscription-payment-list"><strong>Paystack transaction history</strong>{data.payments.slice(0, 5).map((payment) => <div key={String(payment.provider_event_id)}><span>{String(payment.event_type)}</span><small>{String(payment.status)} · {String(payment.provider_reference ?? payment.invoice_code ?? "Paystack event")}</small><b>{payment.amount_cents ? formatZar(Number(payment.amount_cents)) : "—"}</b></div>)}</div>}<small className="privacy-note">Source of truth: {data.sourceOfTruth}. We only mirror signed Paystack webhook events and references.</small></article>;
}

function AccountWorkspace({ api, auth0, onNotice, buyer }: { api: (path: string, init?: RequestInit) => Promise<Response>; auth0?: Auth0Bridge; onNotice: (notice: string) => void; buyer: boolean }) {
  const [account, setAccount] = useState<(AccountLifecycle & { accountPortalUrl?: string | null }) | null>(null);
  const [purchases, setPurchases] = useState<Array<Record<string, unknown>>>([]);
  const [paymentBusyId, setPaymentBusyId] = useState("");

  const reload = useCallback(() => {
    const purchaseRequest = buyer
      ? api("/api/my/purchases").then(async (response) => response.ok ? response.json() as Promise<{ results: Array<Record<string, unknown>> }> : { results: [] })
      : Promise.resolve({ results: [] as Array<Record<string, unknown>> });
    void Promise.all([
      api("/api/account/lifecycle").then(async (response) => response.ok ? response.json() as Promise<AccountLifecycle & { accountPortalUrl?: string | null }> : null),
      purchaseRequest,
    ]).then(([lifecycle, history]) => {
      setAccount(lifecycle);
      setPurchases(history.results);
    });
  }, [api, buyer]);

  useEffect(() => { reload(); }, [reload]);

  async function continueToPayment(licenceId: string): Promise<void> {
    setPaymentBusyId(licenceId);
    try {
      const response = await api(`/api/payments/${encodeURIComponent(licenceId)}/session`, {
        method: "POST",
        body: JSON.stringify({
          successUrl: `${window.location.origin}/account?licence=${encodeURIComponent(licenceId)}&payment=complete`,
          cancelUrl: `${window.location.origin}/account?licence=${encodeURIComponent(licenceId)}&payment=cancelled`,
        }),
      });
      const body = await response.json().catch(() => ({})) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !body.checkoutUrl) {
        onNotice(body.error ?? "Secure payment checkout could not be opened. Try again.");
        return;
      }
      window.location.assign(body.checkoutUrl);
    } catch {
      onNotice("Secure payment checkout is unavailable. Your pending licence remains unchanged; try again.");
    } finally {
      setPaymentBusyId("");
    }
  }

  async function downloadLicence(assetId: string): Promise<void> {
    const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}/original`, { credentials: "include", redirect: "manual" });
    if (response.status === 302) {
      window.location.assign(response.headers.get("Location") ?? `/api/assets/${encodeURIComponent(assetId)}/original`);
      return;
    }
    const body = await response.json().catch(() => ({})) as { error?: string };
    onNotice(body.error ?? "Licensed delivery could not be opened. Try again.");
  }

  if (!account) return <main className="account-page"><div className="empty-state">Loading your account controls…</div></main>;
  const openIdentity = () => {
    if (account.accountPortalUrl) { window.location.assign(account.accountPortalUrl); return; }
    if (auth0) { void auth0.loginWithRedirect({ authorizationParams: { prompt: "login" } }); return; }
    onNotice("Configure AUTH_ACCOUNT_PORTAL_URL for production identity management.");
  };

  return <main className="account-page">
    <div className="workspace-intro"><span className="section-kicker">ACCOUNT & ORGANIZATION</span><h1>Control your <em>account.</em></h1><p>Identity security stays with the configured authentication provider; data rights, preferences, receipts, and deletion requests remain visible here.</p></div>
    <section className="account-grid">
      <article><span className="section-kicker">IDENTITY SECURITY</span><h2>Email, password & MFA</h2><p>{account.emailVerified ? "Email is verified." : "Email verification is still required."} {account.mfaEnrolled ? "MFA is enrolled." : "Set up MFA before granting team administration."}</p><button className="dark-button" onClick={openIdentity}>Manage verification, password & MFA →</button></article>
      <article><span className="section-kicker">NOTIFICATIONS</span><h2>Keep only useful alerts</h2><label className="checkbox-row"><input type="checkbox" checked={account.emailNotifications} onChange={(event) => void api("/api/account/preferences", { method: "PUT", body: JSON.stringify({ emailNotifications: event.target.checked, productNotifications: account.productNotifications }) }).then(reload)} /> Essential email notifications</label><label className="checkbox-row"><input type="checkbox" checked={account.productNotifications} onChange={(event) => void api("/api/account/preferences", { method: "PUT", body: JSON.stringify({ emailNotifications: account.emailNotifications, productNotifications: event.target.checked }) }).then(reload)} /> Product and marketplace updates</label></article>
      <article><span className="section-kicker">YOUR DATA</span><h2>Export or delete</h2><p>Exports are signed, time-limited deliveries. Deletion requests have a 30-day recovery window.</p><button className="outline-button" onClick={() => void api("/api/account/exports", { method: "POST", body: "{}" }).then(reload)}>Request account export</button><button className="ghost-button danger-button" onClick={() => { if (window.confirm("Schedule this account for deletion in 30 days?")) void api("/api/account/deletion", { method: "POST", body: "{}" }).then(reload); }}>Schedule deletion</button><small>Export: {account.exportStatus} · deletion: {account.deletionStatus}</small></article>
    </section>
    <section className="licence-history">
      <span className="section-kicker">PURCHASE HISTORY & RECEIPTS</span>
      <h2>Proof of what your team can use</h2>
      {purchases.length ? purchases.map((purchase) => {
        const kind = String(purchase.kind);
        const status = String(purchase.status);
        const licenceId = String(purchase.referenceId ?? purchase.id);
        const assetId = typeof purchase.assetId === "string" ? purchase.assetId : "";
        return <article key={String(purchase.id)}><div><strong>{String(purchase.title)}</strong><small>{String(purchase.details)} · {status.replaceAll("_", " ")}</small></div><span>{formatZar(Number(purchase.amountCents))}</span>{kind === "licence" && status === "paid" && assetId ? <button type="button" className="outline-button" onClick={() => void downloadLicence(assetId)}>Download</button> : kind === "licence" && status === "pending" ? <button type="button" className="dark-button" disabled={paymentBusyId === licenceId} onClick={() => void continueToPayment(licenceId)}>{paymentBusyId === licenceId ? "Opening checkout…" : "Continue to payment"}</button> : <small className="purchase-state">{status.replaceAll("_", " ")}</small>}</article>;
      }) : <p>{buyer ? "No purchases yet. Open an approved archive asset to start an automatic licence purchase." : "No licence receipts are recorded for this workspace yet."}</p>}
    </section>
  </main>;
}

/* Duplicate lightweight campaign prototype retained in the worktree before Phase 3A's richer editor. */
/* type CampaignSummary = { id: string; name: string; brief: string; briefFields: Record<string, unknown>; brandKit: BrandKit; status: string; assetCounts: { shortlisted: number; approved: number; needsReview: number; rejected: number }; createdAt: string; updatedAt: string };

function CampaignWorkspace({ api, onNotice, onOpen }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; onOpen: (asset: Asset) => void }) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selected, setSelected] = useState<{ campaign: CampaignSummary; recommendations: Array<CampaignRecommendation & { stage: string | null; note: string }> } | null>(null);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [brand, setBrand] = useState<BrandKit>({ colours: [], logoNotes: "", tone: "", industry: "", forbiddenStyles: [], preferredVisuals: "" });
  const [saving, setSaving] = useState(false);

  const loadCampaigns = useCallback(async () => {
    const response = await api("/api/campaigns");
    if (response.ok) setCampaigns((await response.json() as { results: CampaignSummary[] }).results);
  }, [api]);
  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);

  async function openCampaign(id: string) {
    const response = await api(`/api/campaigns/${id}`);
    if (!response.ok) { onNotice("That campaign could not be loaded."); return; }
    setSelected(await response.json() as { campaign: CampaignSummary; recommendations: Array<CampaignRecommendation & { stage: string | null; note: string }> });
  }

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const response = await api("/api/campaigns", { method: "POST", body: JSON.stringify({ name, brief, brandKit: brand }) });
      if (!response.ok) throw new Error();
      const created = await response.json() as { id: string };
      setName(""); setBrief(""); await loadCampaigns(); await openCampaign(created.id); onNotice("Campaign brief parsed. Rights-aware recommendations are ready.");
    } catch { onNotice("Campaign creation failed. Add a fuller brief and try again."); }
    finally { setSaving(false); }
  }

  async function setStage(assetId: string, stage: "shortlisted" | "rejected" | "approved" | "needs_review") {
    if (!selected) return;
    const response = await api(`/api/campaigns/${selected.campaign.id}/assets`, { method: "POST", body: JSON.stringify({ assetId, stage }) });
    if (!response.ok) { onNotice("The campaign decision was not saved."); return; }
    setSelected((current) => current ? { ...current, recommendations: current.recommendations.map((item) => item.asset.id === assetId ? { ...item, stage } : item) } : current);
    onNotice(`Asset marked ${stage.replace("_", " ")}.`);
    void loadCampaigns();
  }

  async function exportManifest() {
    if (!selected) return;
    const response = await api(`/api/campaigns/${selected.campaign.id}/manifest`);
    if (!response.ok) { onNotice("The manifest could not be generated."); return; }
    const data = await response.blob(); const url = URL.createObjectURL(data); const link = document.createElement("a"); link.href = url; link.download = `${selected.campaign.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-manifest.json`; link.click(); URL.revokeObjectURL(url); onNotice("Campaign manifest exported with licence notes and audit trail.");
  }

  return <main className="campaign-page"><section className="workspace-intro"><span className="section-kicker">PHASE 3A · MARKETING ASSET INTELLIGENCE</span><h1>Brief the story.<br /><em>Find the proof.</em></h1><p>Turn a campaign idea into structured search fields, explainable rankings, rights warnings, and an approval-ready media board.</p></section><div className="campaign-layout"><aside className="campaign-sidebar"><div className="card-heading"><span className="section-kicker">CAMPAIGN WORKSPACES</span><span>{campaigns.length}</span></div><button className="campaign-new-button" type="button" onClick={() => setSelected(null)}>+ New campaign</button>{campaigns.map((item) => <button type="button" className={`campaign-picker ${selected?.campaign.id === item.id ? "active" : ""}`} key={item.id} onClick={() => void openCampaign(item.id)}><strong>{item.name}</strong><small>{item.assetCounts.approved} approved · {item.assetCounts.shortlisted} shortlisted</small></button>)}</aside><section className="campaign-main">{!selected ? <form className="campaign-brief-card" onSubmit={createCampaign}><span className="section-kicker">01 · AI CAMPAIGN BRIEF INTAKE</span><h2>What are you trying to make?</h2><p>Describe the audience, platform, place, tone, product, and usage rights in plain language. The parser turns it into searchable fields.</p><label>Campaign name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Cape Town summer launch" /></label><label>Campaign brief<textarea required minLength={20} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="A warm, premium campaign for young South African travellers. Use Cape Town locations, Instagram Stories and a web hero for a new boutique hotel. Commercial and paid advertising use; people are welcome." /></label><div className="campaign-form-grid"><label>Brand tone<input value={brand.tone} onChange={(event) => setBrand({ ...brand, tone: event.target.value })} placeholder="warm, premium, grounded" /></label><label>Industry<input value={brand.industry} onChange={(event) => setBrand({ ...brand, industry: event.target.value })} placeholder="hospitality" /></label><label>Forbidden styles<input value={brand.forbiddenStyles.join(", ")} onChange={(event) => setBrand({ ...brand, forbiddenStyles: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="generic stock, heavy filters" /></label><label>Preferred visual examples<input value={brand.preferredVisuals} onChange={(event) => setBrand({ ...brand, preferredVisuals: event.target.value })} placeholder="Natural light, lived-in spaces" /></label></div><button className="dark-button" disabled={saving || brief.trim().length < 20}>{saving ? "Parsing brief…" : "Parse brief & find assets →"}</button></form> : <><div className="campaign-heading"><div><button type="button" className="text-button" onClick={() => setSelected(null)}>← New brief</button><span className="section-kicker">02 · {selected.campaign.name}</span><h2>Shortlist with <em>evidence.</em></h2><p>{selected.campaign.brief}</p></div><button type="button" className="outline-button" onClick={() => void exportManifest()}>Export manifest ↓</button></div><div className="brief-fields"><div><small>Audience</small><strong>{String(selected.campaign.briefFields.audience ?? "Not specified")}</strong></div><div><small>Platforms</small><strong>{(selected.campaign.briefFields.platforms as string[] ?? []).join(" · ")}</strong></div><div><small>Location</small><strong>{(selected.campaign.briefFields.locations as string[] ?? []).join(" · ") || "Any place"}</strong></div><div><small>Usage rights</small><strong>{String(selected.campaign.briefFields.usageRights ?? "commercial")}</strong></div><div><small>Tone</small><strong>{(selected.campaign.briefFields.tone as string[] ?? []).join(" · ")}</strong></div><div><small>Formats</small><strong>{(selected.campaign.briefFields.formatNeeded as string[] ?? []).join(" · ")}</strong></div></div><div className="campaign-results-heading"><div><span className="section-kicker">03 · AI-ASSISTED RANKING</span><h3>{selected.recommendations.length} assets ranked for this brief</h3></div><small>Relevance · rights safety · brand fit · quality · commercial suitability · crop flexibility</small></div><div className="campaign-results">{selected.recommendations.map((item, index) => <article className={`campaign-result ${item.stage ?? ""}`} key={item.asset.id}><div className="campaign-result-top"><button type="button" className="campaign-result-media" onClick={() => onOpen(item.asset)}><AssetPreview asset={item.asset} className={`asset-visual visual-${(index % 4) + 1} ${item.asset.kind}`} /></button><div className="campaign-result-copy"><div className="card-heading"><span className="section-kicker">#{String(index + 1).padStart(2, "0")} · {item.asset.kind}</span><strong className={`campaign-score ${item.usable ? "safe" : "risk"}`}>{item.score}<small>/100</small></strong></div><h3>{item.asset.title}</h3><p>{item.asset.city ?? item.asset.country} · {item.asset.rightsStatus}</p><div className="campaign-reasons">{item.reasons.slice(0, 3).map((reason) => <span key={reason}>✓ {reason}</span>)}</div><div className="campaign-actions"><button type="button" className="outline-button" onClick={() => void setStage(item.asset.id, "shortlisted")}>Shortlist</button><button type="button" className="dark-button" disabled={!item.usable} onClick={() => void setStage(item.asset.id, "approved")}>Approve</button><button type="button" className="ghost-button danger-button" onClick={() => void setStage(item.asset.id, "rejected")}>Reject</button></div></div></div><div className="campaign-result-detail"><div><small>Why it matches</small>{item.reasons.map((reason) => <p key={reason}>{reason}</p>)}</div><div><small>Compliance</small>{item.warnings.length ? item.warnings.map((warning) => <p className={`warning-${warning.severity}`} key={warning.code}>⚠ {warning.label}</p>) : <p className="warning-info">✓ Rights and releases look clear for this brief.</p>}</div><div><small>Readiness</small><div className="readiness-row">{(["instagram", "web", "print", "billboard"] as const).map((channel) => <span key={channel} title={`${channel}: ${item.readiness[channel]}/100`}><b>{item.readiness[channel]}</b>{channel}</span>)}</div>{item.suggestions.map((suggestion) => <p className="campaign-suggestion" key={suggestion}>↳ {suggestion}</p>)}</div></div></article>)}{selected.recommendations.length === 0 && <div className="empty-state">No published assets are available for this organisation yet.</div>}</div></>}</section></div></main>;
}

*/
function GovernanceWorkspace({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [items, setItems] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [stage, setStage] = useState<WorkflowStage | "all">("all");
  const [licenceType, setLicenceType] = useState<LicenceType>("commercial");
  const [buyerTermsAccepted, setBuyerTermsAccepted] = useState(false);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const visible = stage === "all" ? items : items.filter((item) => item.workflowStage === stage);
  const validation = selected ? archiveDomain.evaluateLicenceRequest(selected, { assetId: selected.id, licenceType, territory: "Worldwide", durationDays: 365 }) : null;

  useEffect(() => {
    let active = true;
    api("/api/governance/assets?stage=all").then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as { results: Asset[] };
      if (active) { setItems(data.results); setSelectedId(data.results[0]?.id ?? ""); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [api]);

  async function action(name: "run_ai_tagging" | "save_correction" | "approve", updates: Partial<Asset> = {}) {
    if (!selected) return;
    const nextStage: WorkflowStage = name === "run_ai_tagging" ? "ai_tagging" : name === "approve" ? "approval" : "curator_correction";
    const next = { ...selected, ...updates, workflowStage: nextStage, status: name === "approve" ? "published" : "needs_review", humanVerified: name === "approve" } as Asset;
    try {
      const response = await api(`/api/governance/assets/${selected.id}/action`, { method: "POST", body: JSON.stringify({ action: name, ...updates }) });
      if (!response.ok) throw new Error();
      setItems((current) => current.map((item) => item.id === selected.id ? next : item));
    } catch { onNotice("The governance action was not saved. No local decision was applied."); return; }
    onNotice(name === "run_ai_tagging" ? "AI suggestions generated; curator review is required." : name === "save_correction" ? "Curator correction saved to the audit trail." : "Asset approved and ready for rights validation.");
  }

  async function checkout() {
    if (!selected || !validation) return;
    if (selected.monetizationModel === "custom_quote") { onNotice("Custom quote selected. No payment was created; contact the contributor for pricing."); return; }
    const accepted = buyerTermsAccepted || window.confirm("Please read the Buyer Licence and Payment Terms shown on this page. Continue only if you accept the selected licence, Paystack payment split disclosure, and limited rights-enforcement disclosure.");
    if (!accepted) return;
    setBuyerTermsAccepted(true);
    try {
      const response = await api("/api/checkout", { method: "POST", body: JSON.stringify({ assetId: selected.id, licenceType, territory: "Worldwide", durationDays: 365, buyerAgreementVersion: "buyer-marketplace-v1", paymentAgreementVersion: "payment-split-v1", acceptBuyerTerms: accepted }) });
      const created = await response.json().catch(() => ({})) as { licenceId?: string; error?: string };
      if (!response.ok || !created.licenceId) throw new Error(created.error ?? "Licence could not be created");
      const payment = await api(`/api/payments/${encodeURIComponent(created.licenceId)}/session`, { method: "POST", body: JSON.stringify({ successUrl: `${window.location.origin}/account?licence=${encodeURIComponent(created.licenceId)}&payment=complete`, cancelUrl: `${window.location.origin}/account?licence=${encodeURIComponent(created.licenceId)}&payment=cancelled` }) });
      const session = await payment.json().catch(() => ({})) as { checkoutUrl?: string; error?: string };
      if (!payment.ok || !session.checkoutUrl) throw new Error(session.error ?? "Paystack checkout could not be created");
      window.location.assign(session.checkoutUrl);
    }
    catch { onNotice(validation.allowed ? "Checkout could not be opened. Payment was not created." : `Checkout blocked: ${validation.blockingReasons[0]}`); }
  }

  return <main className="governance-page"><div className="governance-intro"><div><span className="section-kicker">CURATOR OPERATIONS / METADATA GOVERNANCE</span><h1>Review what the model <em>cannot know.</em></h1><p>Assets move from source file to licensable record through an explicit, auditable chain.</p></div><div className="governance-summary"><strong>{items.filter((item) => item.workflowStage !== "approval").length}</strong><span>assets need human attention</span></div></div><div className="governance-pipeline"><button className={stage === "all" ? "active" : ""} onClick={() => setStage("all")}><b>00</b><span>All assets<small>Full pipeline</small></span><strong>{items.length}</strong></button>{(["ingestion", "ai_tagging", "curator_correction", "approval"] as WorkflowStage[]).map((value, index) => <React.Fragment key={value}><i>→</i><button className={stage === value ? "active" : ""} onClick={() => setStage(value)}><b>0{index + 1}</b><span>{value === "ai_tagging" ? "AI tagging" : value === "curator_correction" ? "Curator correction" : value[0].toUpperCase() + value.slice(1)}<small>{items.filter((item) => item.workflowStage === value).length} records</small></span><strong>{items.filter((item) => item.workflowStage === value).length}</strong></button></React.Fragment>)}</div><div className="governance-grid"><div className="governance-queue"><div className="governance-queue-heading"><span className="section-kicker">REVIEW QUEUE</span><span>{visible.length} records</span></div>{visible.map((item) => <button key={item.id} className={`governance-item ${item.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}><div className={`governance-thumb ${item.kind}`}><span>{item.kind === "video" ? "▶" : "V"}</span></div><div><small>{item.workflowStage === "curator_correction" ? "Needs correction" : item.workflowStage === "ai_tagging" ? "AI tagging" : item.workflowStage === "approval" ? "Approved" : "Ingestion"}</small><strong>{item.title}</strong><span>{item.contributor} · {item.city ?? item.country}</span></div><i className={item.humanVerified ? "verified" : ""}></i></button>)}</div>{selected && <GovernanceDetail asset={selected} licenceType={licenceType} setLicenceType={setLicenceType} validation={validation!} onAction={action} onCheckout={checkout} buyerTermsAccepted={buyerTermsAccepted} setBuyerTermsAccepted={setBuyerTermsAccepted} />}</div></main>;
}

function GovernanceDetail({ asset, licenceType, setLicenceType, validation, onAction, onCheckout, buyerTermsAccepted, setBuyerTermsAccepted }: { asset: Asset; licenceType: LicenceType; setLicenceType: (value: LicenceType) => void; validation: ReturnType<typeof archiveDomain.evaluateLicenceRequest>; onAction: (name: "run_ai_tagging" | "save_correction" | "approve", updates?: Partial<Asset>) => void; onCheckout: () => void; buyerTermsAccepted: boolean; setBuyerTermsAccepted: (value: boolean) => void }) {
  const [title, setTitle] = useState(asset.title);
  const [caption, setCaption] = useState(asset.caption);
  const [notes, setNotes] = useState(asset.curatorNotes);
  useEffect(() => {
    setTitle(asset.title);
    setCaption(asset.caption);
    setNotes(asset.curatorNotes);
  }, [asset.id, asset.title, asset.caption, asset.curatorNotes]);
  const approved = asset.workflowStage === "approval" && asset.status === "published";
  const licences: LicenceType[] = ["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"];
  const dirty = title !== asset.title || caption !== asset.caption || notes !== asset.curatorNotes;
  const corrections = { title: title.trim(), caption: caption.trim(), curatorNotes: notes.trim() };
  return <article className="governance-detail">
    <div className="detail-heading"><div><span className="section-kicker">ASSET / {asset.id}</span><h2>{asset.title}</h2><p>{asset.city}, {asset.province} · {asset.contributor}</p></div><span className={`governance-status ${approved ? "approved" : "pending"}`}>{approved ? "Approved" : "Needs review"}</span></div>
    <div className={`governance-preview ${asset.kind}`}><span>{asset.kind === "video" ? "▶" : "V"}</span><small>SOURCE · {asset.sourceFileName ?? "source file pending"}</small><b>{asset.authenticityConfidence ? `${Math.round(asset.authenticityConfidence * 100)}%` : "—"}<em>AI confidence</em></b></div>
    <div className="governance-fields">
      <label>Working title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} aria-label="Working title" /></label>
      <label>Caption / context<textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={1000} rows={3} aria-label="Caption or context" /></label>
      <label>AI suggestions<div className="governance-tags">{asset.aiTags.length ? asset.aiTags.map((tag) => <span key={tag}>{tag}</span>) : <small>Pending AI pass</small>}</div></label>
      <label>Curator note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={3} aria-label="Curator note" /></label>
    </div>
    <div className="draft-status" role="status" aria-live="polite">{dirty ? "Unsaved metadata changes" : "All metadata changes saved"}</div>
    <div className="release-evidence"><div><span className="section-kicker">CONTRIBUTOR RELEASES</span><h3>Evidence cross-check</h3></div><div className="evidence-grid"><Evidence label="Model release" status={asset.modelReleaseStatus} /><Evidence label="Property release" status={asset.propertyReleaseStatus} /></div></div>
    <div className="governance-actions">{!approved && <><button className="outline-button" onClick={() => onAction("run_ai_tagging", { aiTags: ["South Africa", asset.city ?? "location", asset.kind, "context pending"] })}>Run AI tagging ↗</button><button className="dark-button" disabled={!dirty || !corrections.title} onClick={() => onAction("save_correction", corrections)}>Save correction ↗</button><button className="approve-button" disabled={!corrections.title} onClick={() => onAction("approve", corrections)}>Approve asset ✓</button></>}{approved && <span className="approved-copy"><span className="verified-dot"></span> Approval recorded; checkout gate is active.</span>}</div>
    <div className={`checkout-guard ${validation.allowed ? "clear" : "blocked"}`}><div><span className="section-kicker">PRE-CHECKOUT GATE</span><h3>Licence rules <em>before</em> payment.</h3><p>Requested licence is checked against approval, rights scope, and contributor releases.</p><p className="pricing-note">Seller access: <strong>{assetPricingLabel(asset)}</strong></p></div><div className="checkout-controls"><label>Requested licence<select value={licenceType} onChange={(event) => setLicenceType(event.target.value as LicenceType)}>{licences.map((licence) => <option key={licence} value={licence}>{licence[0].toUpperCase() + licence.slice(1)}</option>)}</select></label><button className={validation.allowed && asset.monetizationModel !== "custom_quote" ? "approve-button" : "blocked-button"} onClick={onCheckout}>{validation.allowed && asset.monetizationModel !== "custom_quote" ? "Continue to checkout ↗" : asset.monetizationModel === "custom_quote" ? "Request custom quote" : "Checkout blocked"}</button></div><div className="checkout-checks">{validation.checks.map((check) => <div key={check.label}><span className={check.passed ? "check-pass" : "check-fail"}>{check.passed ? "✓" : "×"}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div></div>
  </article>;
}

function Evidence({ label, status }: { label: string; status: Asset["modelReleaseStatus"] }) { return <div className="evidence-row"><span className={`evidence-icon ${status}`}>{status === "verified" ? "✓" : status === "pending" ? "!" : "—"}</span><span><strong>{label}</strong><small>{status === "verified" ? "Document verified" : status === "not_required" ? "Not required" : status === "pending" ? "Evidence needs review" : "No document attached"}</small></span><b>{status.replace("_", " ")}</b></div>; }

function AssetPricingFields({ asset, setAsset }: { asset: { monetizationModel: MonetizationModel; licensePriceZar: string; artistLicenseKey: string; artistLicenseUrl: string; artistLicenseTerms: string; freeDownloadEnabled: boolean; kind?: string }; setAsset: (asset: any) => void }) {
  return <div className="asset-pricing-fields"><label>How should this asset be sold?<select value={asset.monetizationModel} onChange={(event) => setAsset({ ...asset, monetizationModel: event.target.value as MonetizationModel })}><option value="membership">Membership access</option><option value="individual_license">Sell an individual licence</option><option value="custom_quote">Custom quote for premium work</option></select></label>{asset.kind !== "video" && <label className="checkbox-row"><input type="checkbox" checked={asset.freeDownloadEnabled} onChange={(event) => setAsset({ ...asset, freeDownloadEnabled: event.target.checked })} /> Include this photo in the introductory free-download offer<small className="field-help">You choose the images. Only published, rights-approved photos are eligible; each buyer can download up to 3 once.</small></label>}{asset.monetizationModel === "individual_license" && <label>Annual licence price (ZAR)<input required min="1" step="0.01" type="number" value={asset.licensePriceZar} onChange={(event) => setAsset({ ...asset, licensePriceZar: event.target.value })} placeholder="e.g. 2500" /><small className="field-help">Your price is used for a standard one-year licence. Rights and releases still need editorial approval.</small></label>}<label>Artist licence<select value={asset.artistLicenseKey} onChange={(event) => setAsset({ ...asset, artistLicenseKey: event.target.value })}><option value="custom">Custom image licence</option><option value="cc_by_4_0">Creative Commons BY 4.0</option><option value="cc_by_sa_4_0">Creative Commons BY-SA 4.0</option><option value="mit">MIT (only if intentionally chosen)</option><option value="other">Other established licence</option></select></label>{asset.artistLicenseKey !== "custom" && <label>Licence proof URL<input required type="url" value={asset.artistLicenseUrl} onChange={(event) => setAsset({ ...asset, artistLicenseUrl: event.target.value })} placeholder="https://..." /></label>}<label>Licence version / terms<textarea required={asset.artistLicenseKey === "custom" || asset.artistLicenseKey === "other"} value={asset.artistLicenseTerms} onChange={(event) => setAsset({ ...asset, artistLicenseTerms: event.target.value })} placeholder="State the exact permission, restrictions, attribution and enforcement terms." /></label>{asset.monetizationModel === "custom_quote" && <small className="field-help">Buyers will be asked to contact you for a bespoke price instead of checking out immediately.</small>}</div>;
}

function MarketplaceLegalDocuments({ api }: { api: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [documents, setDocuments] = useState<Array<{ type: string; version: string; title: string; sections: Array<{ heading: string; body: string }> }>>([]);
  useEffect(() => { void api("/api/legal/agreements").then(async (response) => { if (response.ok) setDocuments((await response.json() as { documents: typeof documents }).documents); }).catch(() => undefined); }, [api]);
  return <section className="workspace-card legal-documents" aria-label="Marketplace legal documents"><div className="card-heading"><span className="section-kicker">LEGAL TERMS</span><span className="status-pill">Versioned</span></div><h2>Read before listing or buying</h2><p className="dialog-intro">The artist keeps copyright. Paystack processes buyer payments and, for approved sellers, splits the agreed percentage directly to the seller subaccount. Your acceptance is recorded with the version and hash.</p>{documents.map((document) => <details key={document.type}><summary>{document.title} · {document.version}</summary>{document.sections.map((section) => <section key={section.heading}><h4>{section.heading}</h4><p>{section.body}</p></section>)}</details>)}</section>;
}

function SellerVerificationPanel({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [seller, setSeller] = useState({ sellerType: "individual", legalName: "", phone: "", ageConfirmed: false, identityDocumentType: "sa_id", bankAccountName: "", registeredName: "", cipcRegistrationNumber: "", representativeName: "", representativeAuthority: false, beneficialOwnerRequired: false, copyrightDeclaration: false, taxResponsibilityDeclaration: false, contributorAgreement: false, signerName: "", signatureReference: "", provider: "paystack", providerAccountId: "", accountHolderName: "", accountLast4: "", branchLast4: "" });
  const [diditUrl, setDiditUrl] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (key: string, value: string | boolean) => setSeller((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const phone = archiveDomain.normalizeSouthAfricanPhone(seller.phone);
      const sellerResponse = await api("/api/onboarding/seller", { method: "PUT", body: JSON.stringify({ ...seller, phone, sellerType: seller.sellerType === "company" ? "company" : "individual", registeredName: seller.sellerType === "company" ? seller.registeredName : undefined, cipcRegistrationNumber: seller.sellerType === "company" ? seller.cipcRegistrationNumber : undefined, representativeName: seller.sellerType === "company" ? seller.representativeName : undefined, representativeAuthority: seller.sellerType === "company" ? seller.representativeAuthority : false, beneficialOwnerRequired: seller.sellerType === "company" && seller.beneficialOwnerRequired }) });
      if (!sellerResponse.ok) throw new Error("seller");
      if (seller.sellerType === "company") {
        const cipc = await api("/api/onboarding/cipc/lookup", { method: "POST", body: JSON.stringify({ registrationNumber: seller.cipcRegistrationNumber }) });
        if (!cipc.ok) throw new Error("cipc");
      }
      const diditResponse = await api("/api/onboarding/didit/session", { method: "POST", body: "{}" });
      if (!diditResponse.ok) throw new Error("didit");
      const didit = await diditResponse.json() as { url: string }; setDiditUrl(didit.url);
      const walletResponse = await api("/api/onboarding/wallet", { method: "POST", body: JSON.stringify({ provider: seller.provider, providerAccountId: seller.providerAccountId || undefined, accountHolderName: seller.accountHolderName, accountLast4: seller.accountLast4 || undefined, branchLast4: seller.branchLast4 || undefined, currency: "ZAR" }) });
      if (!walletResponse.ok) throw new Error("wallet");
      const contractResponse = await api("/api/onboarding/contract", { method: "POST", body: JSON.stringify({ signerName: seller.signerName, signatureMethod: "firma", signatureReference: seller.signatureReference, turnstileToken: turnstileToken || undefined }) });
      if (!contractResponse.ok) throw new Error("contract");
      onNotice("Seller details saved. Open Didit to finish identity verification; approval remains blocked until its signed result returns.");
  } catch (error) { onNotice(error instanceof Error && error.message === "didit" ? "Didit is not ready yet. Check the API key and KYC/KYB workflow ID." : error instanceof Error && error.message.includes("South African mobile") ? error.message : "Seller onboarding could not be submitted. Complete every field and configure the required provider."); } finally { setSaving(false); }
  }
  return <form className="workspace-card seller-verification-panel" onSubmit={submit}><div className="card-heading"><span className="section-kicker">02 · SELLER SETUP</span><span className="status-pill warm">Pending verification</span></div><h2>Verify your seller identity</h2><p className="dialog-intro">Individuals and sole proprietors can onboard without a company. Didit verifies the ID/passport, liveness, and phone in a hosted flow; WeDoCMS stores only the decision and provider reference.</p><label>Seller type<select value={seller.sellerType} onChange={(event) => update("sellerType", event.target.value)}><option value="individual">Individual / sole proprietor</option><option value="company">Registered company</option></select></label><div className="two-fields"><label>Legal name<input required value={seller.legalName} onChange={(event) => update("legalName", event.target.value)} /></label><label>Verified phone<input required type="tel" placeholder="+27821234567" value={seller.phone} onChange={(event) => update("phone", event.target.value)} /></label></div><div className="two-fields"><label>ID or passport<select value={seller.identityDocumentType} onChange={(event) => update("identityDocumentType", event.target.value)}><option value="sa_id">South African ID</option><option value="passport">Passport</option></select></label><label className="checkbox-row"><input type="checkbox" checked={seller.ageConfirmed} onChange={(event) => update("ageConfirmed", event.target.checked)} /> I confirm I am at least 18</label></div>{seller.sellerType === "company" && <><label>Registered company name<input required value={seller.registeredName} onChange={(event) => update("registeredName", event.target.value)} /></label><div className="two-fields"><label>CIPC registration number<input required value={seller.cipcRegistrationNumber} onChange={(event) => update("cipcRegistrationNumber", event.target.value)} /></label><label>Director / authorised representative<input required value={seller.representativeName} onChange={(event) => update("representativeName", event.target.value)} /></label></div><label className="checkbox-row"><input type="checkbox" checked={seller.representativeAuthority} onChange={(event) => update("representativeAuthority", event.target.checked)} /> I confirm I am authorised to act for this company</label><label className="checkbox-row"><input type="checkbox" checked={seller.beneficialOwnerRequired} onChange={(event) => update("beneficialOwnerRequired", event.target.checked)} /> Beneficial-owner information is required by our payment provider / legal classification</label><small className="field-help">A configured CIPC lookup runs before the company Didit session.</small></>}<label>Bank account name<input required value={seller.bankAccountName} onChange={(event) => update("bankAccountName", event.target.value)} /><small className="field-help">Must match the legal name (or registered company name). Never enter the account number here.</small></label><label className="checkbox-row"><input type="checkbox" checked={seller.copyrightDeclaration} onChange={(event) => update("copyrightDeclaration", event.target.checked)} /> I own/control the copyright and required releases for my work.</label><label className="checkbox-row"><input type="checkbox" checked={seller.taxResponsibilityDeclaration} onChange={(event) => update("taxResponsibilityDeclaration", event.target.checked)} /> I accept responsibility for my tax affairs and declarations.</label><label className="checkbox-row"><input type="checkbox" checked={seller.contributorAgreement} onChange={(event) => update("contributorAgreement", event.target.checked)} /> I accept the current contributor agreement and licensing terms.</label>{diditUrl && <p className="dialog-intro"><strong>Didit is ready.</strong> <a href={diditUrl} target="_blank" rel="noreferrer">Open the secure verification flow ↗</a></p>}<label>Signer name<input required value={seller.signerName} onChange={(event) => update("signerName", event.target.value)} /></label><label>Firma signature reference<input required minLength={8} value={seller.signatureReference} onChange={(event) => update("signatureReference", event.target.value)} placeholder="Reference returned by Firma" /></label><div className="two-fields"><label>Payout rail<select value={seller.provider} onChange={(event) => update("provider", event.target.value)}><option value="paystack">Paystack marketplace split</option></select></label><label>Paystack subaccount code<input required value={seller.providerAccountId} onChange={(event) => update("providerAccountId", event.target.value)} placeholder="ACCT_... from Paystack" /></label></div><label>Account holder<input required value={seller.accountHolderName} onChange={(event) => update("accountHolderName", event.target.value)} /></label><div className="two-fields"><label>Account last 4<input inputMode="numeric" pattern="\d{4}" value={seller.accountLast4} onChange={(event) => update("accountLast4", event.target.value)} /></label><label>Branch last 4<input inputMode="numeric" pattern="\d{4}" value={seller.branchLast4} onChange={(event) => update("branchLast4", event.target.value)} /></label></div><TurnstileChallenge onToken={setTurnstileToken} /><label className="checkbox-row"><input type="checkbox" required /> I agree to the current Contributor Terms of Service and authorise this digital signature record.</label><button className="dark-button" disabled={saving}>{saving ? "Saving seller details…" : "Save & start Didit verification ↗"}</button></form>;
}

function ContributorWorkspace({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [form, setForm] = useState({ bio: "", organisationName: "", location: "", contributorType: "individual", equipment: "", portfolioUrl: "", acceptTerms: false });
  const [asset, setAsset] = useState({ kind: "image", title: "", description: "", caption: "", city: "", province: "", locality: "", landmark: "", subjectTags: "", culturalTags: "", rightsStatus: "pending", modelReleaseStatus: "unknown", propertyReleaseStatus: "unknown", monetizationModel: "membership" as MonetizationModel, licensePriceZar: "", artistLicenseKey: "custom", artistLicenseVersion: "", artistLicenseUrl: "", artistLicenseTerms: "", freeDownloadEnabled: false });
  const [file, setFile] = useState<File | null>(null);
  const [seller, setSeller] = useState({ sellerType: "individual", legalName: "", phone: "", ageConfirmed: false, identityDocumentType: "sa_id", bankAccountName: "", registeredName: "", cipcRegistrationNumber: "", representativeName: "", representativeAuthority: false, beneficialOwnerRequired: false, copyrightDeclaration: false, taxResponsibilityDeclaration: false, contributorAgreement: false, signerName: "", signatureReference: "", provider: "paystack", providerAccountId: "", accountHolderName: "", accountLast4: "", branchLast4: "" });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [diditUrl, setDiditUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveOnboarding(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try { const response = await api("/api/onboarding", { method: "PUT", body: JSON.stringify({ ...form, languages: ["English", "isiXhosa", "Afrikaans"], specialties: asset.subjectTags.split(",").map((tag) => tag.trim()).filter(Boolean) }) }); if (!response.ok) throw new Error(); onNotice("Contributor profile submitted for verification."); } catch { onNotice("Profile captured in the workspace. Apply migration 0002_phase1_core.sql and connect auth to persist it."); } finally { setSaving(false); }
  }

  async function createAsset(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const payload = { ...asset, subjectTags: asset.subjectTags.split(",").map((tag) => tag.trim()).filter(Boolean), culturalTags: asset.culturalTags.split(",").map((tag) => tag.trim()).filter(Boolean), licensePriceCents: asset.monetizationModel === "individual_license" && asset.licensePriceZar ? Math.round(Number(asset.licensePriceZar) * 100) : null };
      const createdResponse = await api("/api/assets", { method: "POST", body: JSON.stringify(payload) });
      if (!createdResponse.ok) throw new Error();
      const created = await createdResponse.json() as { id: string };
      if (file) {
        const sessionResponse = await api("/api/uploads", { method: "POST", body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size, assetId: created.id }) });
        const session = await sessionResponse.json() as { uploadUrl?: string; uploadId: string };
        if (!sessionResponse.ok || !session.uploadUrl) throw new Error("R2 is not configured");
        const uploadResponse = await fetch(session.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!uploadResponse.ok) throw new Error("R2 upload failed");
        await api(`/api/uploads/${session.uploadId}/complete`, { method: "POST", body: "{}" });
      }
      onNotice("Asset submitted to the editorial review queue."); setAsset({ ...asset, title: "", description: "", caption: "" }); setFile(null);
    } catch { onNotice("The metadata form is ready, but persistence needs a local D1 migration and R2 credentials."); } finally { setSaving(false); }
  }

  async function submitSellerWorkflow(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const sellerResponse = await api("/api/onboarding/seller", { method: "PUT", body: JSON.stringify({ sellerType: seller.sellerType, legalName: seller.legalName, phone: seller.phone, ageConfirmed: seller.ageConfirmed, identityDocumentType: seller.identityDocumentType, bankAccountName: seller.bankAccountName, registeredName: seller.sellerType === "company" ? seller.registeredName : undefined, cipcRegistrationNumber: seller.sellerType === "company" ? seller.cipcRegistrationNumber : undefined, representativeName: seller.sellerType === "company" ? seller.representativeName : undefined, representativeAuthority: seller.sellerType === "company" ? seller.representativeAuthority : false, beneficialOwnerRequired: seller.sellerType === "company" && seller.beneficialOwnerRequired, copyrightDeclaration: seller.copyrightDeclaration, taxResponsibilityDeclaration: seller.taxResponsibilityDeclaration, contributorAgreement: seller.contributorAgreement }) });
      if (!sellerResponse.ok) throw new Error("seller");
      const diditResponse = await api("/api/onboarding/didit/session", { method: "POST", body: "{}" });
      if (diditResponse.ok) { const didit = await diditResponse.json() as { url?: string }; if (didit.url) setDiditUrl(didit.url); }
      const walletResponse = await api("/api/onboarding/wallet", { method: "POST", body: JSON.stringify({ provider: seller.provider, providerAccountId: seller.providerAccountId || undefined, accountHolderName: seller.accountHolderName, accountLast4: seller.accountLast4 || undefined, branchLast4: seller.branchLast4 || undefined, currency: "ZAR" }) });
      if (!walletResponse.ok) throw new Error("wallet");
      const contractResponse = await api("/api/onboarding/contract", { method: "POST", body: JSON.stringify({ signerName: seller.signerName, signatureMethod: "firma", signatureReference: seller.signatureReference, turnstileToken: turnstileToken || undefined }) });
      if (!contractResponse.ok) throw new Error("contract");
      onNotice("Contract signed and tender submitted. Complete KYC documents before admin approval.");
    } catch { onNotice("Seller workflow needs the 0005 migration, a configured Turnstile secret, and provider wallet credentials."); } finally { setSaving(false); }
  }

  return <main className="workspace-page"><div className="workspace-intro"><span className="section-kicker">CONTRIBUTOR WORKSPACE</span><h1>Keep the <em>context.</em></h1><p>Submit a record with the location, rights, and cultural context an editor needs to trust it.</p></div><div className="workspace-grid"><form className="workspace-card" onSubmit={saveOnboarding}><div className="card-heading"><span className="section-kicker">01 · PROFILE</span><span className="status-pill">Draft</span></div><h2>Your contributor profile</h2><label>Organisation or public name<input value={form.organisationName} onChange={(event) => setForm({ ...form, organisationName: event.target.value })} /></label><label>Biography<textarea value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} /></label><div className="two-fields"><label>Contributor type<select value={form.contributorType} onChange={(event) => setForm({ ...form, contributorType: event.target.value })}><option value="individual">Individual</option><option value="agency">Agency</option><option value="archive">Archive</option><option value="institution">Institution</option></select></label><label>Base location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label></div><label>Portfolio URL<input value={form.portfolioUrl} onChange={(event) => setForm({ ...form, portfolioUrl: event.target.value })} placeholder="https://…" /></label><label className="checkbox-row"><input type="checkbox" checked={form.acceptTerms} onChange={(event) => setForm({ ...form, acceptTerms: event.target.checked })} /> I accept the contributor terms</label><button className="dark-button" disabled={saving}>Save profile <span>↗</span></button></form>
    <form className="workspace-card" onSubmit={submitSellerWorkflow}><div className="card-heading"><span className="section-kicker">02 · SELLER SETUP</span><span className="status-pill warm">Pending tender</span></div><h2>Sign terms & set payout</h2><p className="dialog-intro">Your signed terms hash, KYC case, and payout wallet are linked to one internal approval record. Raw bank credentials are never stored here.</p><label>Signer name<input required value={seller.signerName} onChange={(event) => setSeller({ ...seller, signerName: event.target.value })} /></label><label>Firma signature reference<input required minLength={8} value={seller.signatureReference} onChange={(event) => setSeller({ ...seller, signatureReference: event.target.value })} placeholder="Reference returned by Firma" /></label><div className="two-fields"><label>Payout rail<select value={seller.provider} onChange={(event) => setSeller({ ...seller, provider: event.target.value })}><option value="paystack">Paystack marketplace split</option></select></label><label>Paystack subaccount code<input required value={seller.providerAccountId} onChange={(event) => setSeller({ ...seller, providerAccountId: event.target.value })} placeholder="ACCT_..." /></label></div><label>Account holder<input required value={seller.accountHolderName} onChange={(event) => setSeller({ ...seller, accountHolderName: event.target.value })} /></label><div className="two-fields"><label>Account last 4<input inputMode="numeric" pattern="\d{4}" value={seller.accountLast4} onChange={(event) => setSeller({ ...seller, accountLast4: event.target.value })} /></label><label>Branch last 4<input inputMode="numeric" pattern="\d{4}" value={seller.branchLast4} onChange={(event) => setSeller({ ...seller, branchLast4: event.target.value })} /></label></div><TurnstileChallenge onToken={setTurnstileToken} /><label className="checkbox-row"><input type="checkbox" required /> I agree to the current Contributor Terms of Service and authorize this digital signature record.</label><button className="dark-button" disabled={saving}>Submit seller tender <span>↗</span></button></form>
    <form className="workspace-card" onSubmit={createAsset}><div className="card-heading"><span className="section-kicker">02 · INGESTION</span><span className="status-pill warm">Needs review</span></div><h2>Submit a record</h2><AssetPricingFields asset={asset} setAsset={setAsset} /><div className="two-fields"><label>Media type<select value={asset.kind} onChange={(event) => setAsset({ ...asset, kind: event.target.value })}><option value="image">Photography</option><option value="video">Film & video</option></select></label><label>File<input type="file" accept="image/*,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label></div><label>Title<input required value={asset.title} onChange={(event) => setAsset({ ...asset, title: event.target.value })} placeholder="A precise, human title" /></label><label>Caption<textarea value={asset.caption} onChange={(event) => setAsset({ ...asset, caption: event.target.value })} placeholder="What is actually happening in the frame?" /></label><div className="two-fields"><label>City<input value={asset.city} onChange={(event) => setAsset({ ...asset, city: event.target.value })} /></label><label>Locality<input value={asset.locality} onChange={(event) => setAsset({ ...asset, locality: event.target.value })} placeholder="Cape Flats, Bo-Kaap…" /></label></div><label>Subject tags<input value={asset.subjectTags} onChange={(event) => setAsset({ ...asset, subjectTags: event.target.value })} placeholder="people, food, community" /></label><label>Cultural context tags<input value={asset.culturalTags} onChange={(event) => setAsset({ ...asset, culturalTags: event.target.value })} placeholder="South African braai, wood-fire braai" /></label><div className="two-fields"><label>Rights<select value={asset.rightsStatus} onChange={(event) => setAsset({ ...asset, rightsStatus: event.target.value })}><option value="pending">Pending verification</option><option value="editorial_only">Editorial only</option><option value="verified">Verified</option></select></label><label>Model release<select value={asset.modelReleaseStatus} onChange={(event) => setAsset({ ...asset, modelReleaseStatus: event.target.value })}><option value="unknown">Unknown</option><option value="not_required">Not required</option><option value="pending">Pending</option><option value="verified">Verified</option></select></label></div><button className="dark-button" disabled={saving || !asset.title}>{saving ? "Submitting…" : "Submit for review"} <span>↗</span></button></form></div></main>;
}

type ContributorMetadataDraft = {
  id: string;
  kind: Asset["kind"];
  title: string;
  description: string;
  caption: string;
  province: string;
  city: string;
  locality: string;
  landmark: string;
  subjectTags: string;
  culturalTags: string;
  rightsStatus: Asset["rightsStatus"];
  modelReleaseStatus: Asset["modelReleaseStatus"];
  propertyReleaseStatus: Asset["propertyReleaseStatus"];
  monetizationModel: MonetizationModel;
  licensePriceZar: string;
  artistLicenseKey: NonNullable<Asset["artistLicenseKey"]>;
  artistLicenseVersion: string;
  artistLicenseUrl: string;
  artistLicenseTerms: string;
  freeDownloadEnabled: boolean;
};

function contributorMetadataDraft(asset: Asset): ContributorMetadataDraft {
  return {
    id: asset.id,
    kind: asset.kind,
    title: asset.title,
    description: asset.description,
    caption: asset.caption,
    province: asset.province ?? "",
    city: asset.city ?? "",
    locality: asset.locality ?? "",
    landmark: asset.landmark ?? "",
    subjectTags: asset.subjectTags.join(", "),
    culturalTags: asset.culturalTags.join(", "),
    rightsStatus: asset.rightsStatus,
    modelReleaseStatus: asset.modelReleaseStatus,
    propertyReleaseStatus: asset.propertyReleaseStatus,
    monetizationModel: asset.monetizationModel ?? "membership",
    licensePriceZar: asset.licensePriceCents == null ? "" : (asset.licensePriceCents / 100).toFixed(2),
    artistLicenseKey: asset.artistLicenseKey ?? "custom",
    artistLicenseVersion: asset.artistLicenseVersion ?? "",
    artistLicenseUrl: asset.artistLicenseUrl ?? "",
    artistLicenseTerms: asset.artistLicenseTerms ?? "",
    freeDownloadEnabled: Boolean(asset.freeDownloadEnabled),
  };
}

function ContributorAssetLibrary({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<ContributorMetadataDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reloadAssets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api("/api/my/assets");
      const body = await response.json().catch(() => ({})) as { results?: Asset[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Your seller assets could not be loaded.");
      const results = body.results ?? [];
      setAssets(results);
      setSelectedId((current) => current && results.some((asset) => asset.id === current) ? current : results[0]?.id ?? "");
      setDraft((current) => {
        const next = results.find((asset) => asset.id === (current?.id ?? selectedId)) ?? results[0];
        return next ? contributorMetadataDraft(next) : null;
      });
    } catch (caught) {
      setAssets([]);
      setDraft(null);
      setError(caught instanceof Error ? caught.message : "Your seller assets could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void reloadAssets(); }, [reloadAssets]);

  function selectAsset(asset: Asset) {
    setSelectedId(asset.id);
    setDraft(contributorMetadataDraft(asset));
  }

  function updateDraft<K extends keyof ContributorMetadataDraft>(key: K, value: ContributorMetadataDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function saveMetadata(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const original = assets.find((asset) => asset.id === draft.id);
      const originalLicensePrice = original?.licensePriceCents == null ? "" : (original.licensePriceCents / 100).toFixed(2);
      const licensingChanged = Boolean(original && (
        draft.monetizationModel !== (original.monetizationModel ?? "membership") ||
        draft.licensePriceZar !== originalLicensePrice ||
        draft.artistLicenseKey !== (original.artistLicenseKey ?? "custom") ||
        draft.artistLicenseVersion !== (original.artistLicenseVersion ?? "") ||
        draft.artistLicenseUrl !== (original.artistLicenseUrl ?? "") ||
        draft.artistLicenseTerms !== (original.artistLicenseTerms ?? "")
        || draft.freeDownloadEnabled !== Boolean(original.freeDownloadEnabled)
      ));
      const response = await api(`/api/assets/${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          kind: draft.kind,
          title: draft.title,
          description: draft.description,
          caption: draft.caption,
          province: draft.province || null,
          city: draft.city || null,
          locality: draft.locality || null,
          landmark: draft.landmark || null,
          subjectTags: draft.subjectTags.split(",").map((tag) => tag.trim()).filter(Boolean),
          culturalTags: draft.culturalTags.split(",").map((tag) => tag.trim()).filter(Boolean),
          rightsStatus: draft.rightsStatus,
          modelReleaseStatus: draft.modelReleaseStatus,
          propertyReleaseStatus: draft.propertyReleaseStatus,
          freeDownloadEnabled: draft.freeDownloadEnabled,
          ...(licensingChanged ? {
            monetizationModel: draft.monetizationModel,
            licensePriceCents: draft.monetizationModel === "individual_license" && draft.licensePriceZar.trim() ? Math.round(Number(draft.licensePriceZar) * 100) : null,
            artistLicenseKey: draft.artistLicenseKey,
            artistLicenseVersion: draft.artistLicenseVersion || null,
            artistLicenseUrl: draft.artistLicenseUrl || null,
            artistLicenseTerms: draft.artistLicenseTerms,
          } : {}),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Metadata could not be saved.");
      await reloadAssets();
      onNotice("Your photo metadata was saved and remains in the editorial review queue.");
    } catch (caught) {
      onNotice(caught instanceof Error ? caught.message : "Metadata could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const reviewCount = assets.filter((asset) => asset.status === "needs_review").length;
  const publishedCount = assets.filter((asset) => asset.status === "published").length;
  const imageCount = assets.filter((asset) => asset.kind === "image").length;

  return <section className="contributor-assets-section" aria-labelledby="contributor-assets-title">
    <div className="contributor-assets-heading"><div><span className="section-kicker">03 · YOUR PHOTO LIBRARY</span><h2 id="contributor-assets-title">Update your metadata.</h2><p>Edit descriptions, captions, places, tags, and rights context for assets you own. Changes are saved to the editorial record and never auto-publish.</p></div><button type="button" className="outline-button" onClick={() => void reloadAssets()} disabled={loading}><Icon name="workflow" /> {loading ? "Loading…" : "Refresh assets"}</button></div>
    {error && <div className="contributor-assets-error" role="alert"><Icon name="shield" /><span>{error} If you are testing locally, choose <strong>Contributor</strong> in Local role, sign in, then open Contributor insights.</span></div>}
    {!error && assets.length > 0 && <div className="contributor-pipeline" aria-label="Photo publication pipeline"><div><strong>{assets.length}</strong><span>owned records</span></div><div><strong>{imageCount}</strong><span>photos</span></div><div><strong>{publishedCount}</strong><span>published</span></div><div className={reviewCount ? "needs-review" : ""}><strong>{reviewCount}</strong><span>held for review</span></div></div>}
    {!error && reviewCount > 0 && <div className="contributor-review-banner" role="status"><Icon name="shield" /><div><strong>{reviewCount} record{reviewCount === 1 ? " needs" : "s need"} your review before publishing.</strong><span>Metadata can be edited now, but these records remain private until rights, context, and editorial checks are complete.</span></div></div>}
    {loading && !assets.length ? <div className="empty-state contributor-assets-empty">Loading your owned assets…</div> : !assets.length ? <div className="empty-state contributor-assets-empty"><Icon name="image" /><strong>No uploaded photos yet.</strong><span>Submit a record above and it will appear here for future metadata updates.</span></div> : <div className="contributor-assets-layout">
      <div className="contributor-asset-list" aria-label="Your uploaded assets">{assets.map((asset) => <button type="button" className={`contributor-asset-row ${selectedId === asset.id ? "active" : ""}`} key={asset.id} onClick={() => selectAsset(asset)}><span className="contributor-asset-thumb"><Icon name={asset.kind === "image" ? "image" : "workflow"} /></span><span className="contributor-asset-copy"><strong>{asset.title || "Untitled asset"}</strong><small>{asset.city || asset.country || "Location not set"} · {asset.status.replaceAll("_", " ")}</small></span><Icon name="chevron" size={15} /></button>)}</div>
      {draft && <form className="workspace-card contributor-metadata-editor" onSubmit={(event) => void saveMetadata(event)} aria-label={`Edit metadata for ${draft.title || "asset"}`}><div className="card-heading"><span className="section-kicker">SELLER-OWNED RECORD</span><span className={`status-pill ${assets.find((asset) => asset.id === draft.id)?.status === "published" ? "cool" : "warm"}`}>{assets.find((asset) => asset.id === draft.id)?.status.replaceAll("_", " ")}</span></div><h3>{draft.title || "Edit asset"}</h3><p className="metadata-editor-note">These fields are yours to maintain. Editorial review still controls publication and search visibility.</p><label>Title<input required maxLength={180} value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} /></label><label>Description<textarea required maxLength={4000} value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} placeholder="Describe what is actually visible and the story context you can verify." /></label><label>Caption<textarea maxLength={2000} value={draft.caption} onChange={(event) => updateDraft("caption", event.target.value)} placeholder="A concise caption for buyers and editors." /></label><div className="two-fields"><label>Province<input value={draft.province} onChange={(event) => updateDraft("province", event.target.value)} /></label><label>City<input value={draft.city} onChange={(event) => updateDraft("city", event.target.value)} /></label></div><div className="two-fields"><label>Locality<input value={draft.locality} onChange={(event) => updateDraft("locality", event.target.value)} /></label><label>Landmark<input value={draft.landmark} onChange={(event) => updateDraft("landmark", event.target.value)} /></label></div><label>Subject tags<input value={draft.subjectTags} onChange={(event) => updateDraft("subjectTags", event.target.value)} placeholder="people, food, community" /><small className="field-help">Separate tags with commas.</small></label><label>Cultural context tags<input value={draft.culturalTags} onChange={(event) => updateDraft("culturalTags", event.target.value)} placeholder="Only add context you can evidence" /><small className="field-help">Avoid identity or cultural claims that cannot be supported; these are checked before saving.</small></label><div className="two-fields"><label>Rights<select value={draft.rightsStatus} onChange={(event) => updateDraft("rightsStatus", event.target.value as Asset["rightsStatus"])}><option value="pending">Pending verification</option><option value="editorial_only">Editorial only</option><option value="verified">Verified</option><option value="restricted">Restricted</option></select></label><label>Model release<select value={draft.modelReleaseStatus} onChange={(event) => updateDraft("modelReleaseStatus", event.target.value as Asset["modelReleaseStatus"])}><option value="unknown">Unknown</option><option value="not_required">Not required</option><option value="pending">Pending</option><option value="verified">Verified</option></select></label></div><div className="two-fields"><label>Property release<select value={draft.propertyReleaseStatus} onChange={(event) => updateDraft("propertyReleaseStatus", event.target.value as Asset["propertyReleaseStatus"])}><option value="unknown">Unknown</option><option value="not_required">Not required</option><option value="pending">Pending</option><option value="verified">Verified</option></select></label><label>Listing access<select value={draft.monetizationModel} onChange={(event) => updateDraft("monetizationModel", event.target.value as MonetizationModel)}><option value="membership">Membership</option><option value="individual_license">Individual licence</option><option value="custom_quote">Custom quote</option></select></label></div>{draft.monetizationModel === "individual_license" && <label>Price in ZAR<input type="number" min="1" step="0.01" value={draft.licensePriceZar} onChange={(event) => updateDraft("licensePriceZar", event.target.value)} /></label>}<details className="metadata-license-details"><summary>Artist licence evidence</summary><div><label>Licence key<input value={draft.artistLicenseKey} onChange={(event) => updateDraft("artistLicenseKey", event.target.value as NonNullable<Asset["artistLicenseKey"]>)} /></label><label>Version<input value={draft.artistLicenseVersion} onChange={(event) => updateDraft("artistLicenseVersion", event.target.value)} /></label><label>Proof URL<input type="url" value={draft.artistLicenseUrl} onChange={(event) => updateDraft("artistLicenseUrl", event.target.value)} /></label><label>Licence terms<textarea value={draft.artistLicenseTerms} onChange={(event) => updateDraft("artistLicenseTerms", event.target.value)} placeholder="Required when changing to a custom or other licence." /></label></div></details><div className="metadata-editor-footer"><span>Last saved records remain auditable.</span><button type="submit" className="dark-button" disabled={saving || !draft.title.trim() || !draft.description.trim()}>{saving ? "Saving metadata…" : "Save metadata"} <Icon name="arrow" size={15} /></button></div></form>}
    </div>}
  </section>;
}

type TenderRecord = { [key: string]: string | null | undefined; wallet_id?: string | null };

function ReviewWorkspace({ items, api, onNotice, onReload }: { items: Asset[]; api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; onReload: () => Promise<void> }) {
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  useEffect(() => { void api("/api/admin/onboarding/tenders").then(async (response) => { if (response.ok) setTenders((await response.json() as { results: TenderRecord[] }).results); }).catch(() => undefined); }, [api]);
  async function decide(asset: Asset, decision: "approved" | "rejected" | "needs_changes") { try { const response = await api(`/api/admin/assets/${asset.id}/review`, { method: "POST", body: JSON.stringify({ decision, notes: decision === "approved" ? "Location and rights context reviewed." : "Please add evidence for location and release status." }) }); if (!response.ok) throw new Error(); onNotice(`${asset.title} marked ${decision}.`); await onReload(); } catch { onNotice("Review action is available once the D1 database is migrated and an editor identity is configured."); } }
  async function decideTender(tender: Record<string, unknown>, decision: "approved" | "rejected" | "corrections_requested") { try { const response = await api(`/api/admin/onboarding/tenders/${String(tender.id)}/decision`, { method: "POST", body: JSON.stringify({ decision, notes: decision === "approved" ? "Contract, KYC, and payout wallet verified." : "Please complete the missing seller verification requirement." }) }); if (!response.ok) throw new Error(); onNotice(`${String(tender.display_name)} tender marked ${decision}.`); setTenders((current) => current.filter((item) => item.id !== tender.id)); } catch { onNotice("Tender decision was blocked. Verify the contract, KYC status, wallet status, and 0005 migration."); } }
  async function verifyWallet(tender: Record<string, unknown>) { const providerVerificationReference = window.prompt("Enter the Paystack provider verification reference (not a bank account number):", ""); if (!providerVerificationReference) return; try { const response = await api(`/api/admin/onboarding/wallets/${String(tender.wallet_id)}/verify`, { method: "POST", body: JSON.stringify({ providerVerificationReference }) }); if (!response.ok) throw new Error(); setTenders((current) => current.map((item) => item.id === tender.id ? { ...item, wallet_status: "verified" } : item)); onNotice("Paystack wallet evidence recorded; tender can now be accepted after KYC clears."); } catch { onNotice("Wallet verification failed."); } }
  return <main className="workspace-page"><div className="workspace-intro"><span className="section-kicker">EDITORIAL GOVERNANCE</span><h1>Review what is <em>real.</em></h1><p>Publish only what has evidence for place, context, rights, consent, and seller identity.</p></div><section className="review-queue"><div className="card-heading"><span className="section-kicker">PENDING TENDERS</span><span>{tenders.length} seller submissions</span></div>{tenders.length ? tenders.map((tender) => <article className="review-item" key={String(tender.id)}><div className="review-copy"><div className="card-heading"><span className="section-kicker">{String(tender.id).slice(0, 8)} · {String(tender.created_at ?? "")}</span><span className="status-pill warm">{String(tender.status)}</span></div><h2>{String(tender.display_name)}</h2><p>{String(tender.email)} · contract {String(tender.contract_version)} · hash {String(tender.contract_hash).slice(0, 16)}…</p><div className="review-evidence"><span>KYC {String(tender.verification_status ?? "missing")}</span><span>Wallet {String(tender.wallet_provider ?? "missing")} / {String(tender.wallet_status ?? "missing")}</span><span>Risk {String(tender.risk_level ?? "unknown")}</span></div><div className="review-actions">{tender.wallet_id && tender.wallet_status !== "verified" && <button className="outline-button" onClick={() => verifyWallet(tender)}>Verify wallet</button>}<button className="dark-button" onClick={() => decideTender(tender, "approved")}>Accept tender</button><button className="ghost-button" onClick={() => decideTender(tender, "corrections_requested")}>Request corrections</button><button className="ghost-button danger-button" onClick={() => decideTender(tender, "rejected")}>Reject</button></div></div></article>) : <div className="empty-state">No seller tenders are waiting for review.</div>}</section><div className="review-queue">{items.length ? items.map((asset) => <article className="review-item" key={asset.id}><div className={`review-visual ${asset.kind}`}><span>{asset.kind === "video" ? "▶" : "V"}</span></div><div className="review-copy"><div className="card-heading"><span className="section-kicker">{asset.city}, {asset.province}</span><span className={`status-pill ${asset.humanVerified ? "cool" : "warm"}`}>{asset.humanVerified ? "Verified" : "Needs review"}</span></div><h2>{asset.title}</h2><p>{asset.caption || asset.description}</p><div className="review-tags">{asset.culturalTags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="review-evidence"><span>Authenticity {archiveDomain.percent(asset.authenticityConfidence)}%</span><span>Rights {asset.rightsStatus}</span><span>Model release {asset.modelReleaseStatus}</span></div><div className="review-actions"><button className="dark-button" onClick={() => decide(asset, "approved")}>Approve</button><button className="ghost-button" onClick={() => decide(asset, "needs_changes")}>Request changes</button><button className="ghost-button danger-button" onClick={() => decide(asset, "rejected")}>Reject</button></div></div></article>) : <div className="empty-state">No records are waiting for editorial review.</div>}</div></main>;
}

function AssetPreview({ asset, className }: { asset: Asset; className: string }) {
  const [failed, setFailed] = useState(false);
  const available = Boolean(asset.previewUrl) && !failed;
  return <div className={className}>{available && asset.kind === "image" && <img src={asset.previewUrl!} alt="" loading="lazy" onError={() => setFailed(true)} />}{available && asset.kind === "video" && <video src={asset.previewUrl!} muted playsInline preload="metadata" onError={() => setFailed(true)} />}{!available && <div className="media-unavailable" role="img" aria-label="Licensed preview unavailable"><span>Preview unavailable</span><small>No substitute image is shown.</small></div>}<div className="visual-overlay"><span>{asset.kind === "video" ? "▶" : "PHOTO"}</span><span>{asset.kind === "video" && asset.mediaDurationSeconds ? `${Math.ceil(asset.mediaDurationSeconds)}s` : asset.mediaWidth ? `${asset.mediaWidth}px` : "LICENSED"}</span></div><div className="visual-place">{asset.landmark ?? asset.locality ?? asset.city}</div></div>;
}

function AssetCard({ asset, index, onOpen }: { asset: Asset; index: number; onOpen: (asset: Asset) => void }) {
  const explanation = asset.matchExplanation ?? archiveDomain.buildMatchExplanation(asset);
  return <article className={`asset-card card-${index + 1}`} role="button" aria-label={`Open ${asset.title}`} onClick={() => onOpen(asset)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(asset); } }}><AssetPreview asset={asset} className={`asset-visual visual-${index + 1} ${asset.kind}`} /><div className="asset-info"><div><h3>{asset.title}</h3><p>{asset.city}, {asset.province}</p><small className="asset-contributor">By {asset.contributor}</small><span className={`confidence-chip ${archiveDomain.confidenceLabel(explanation.matchConfidence)}`}>{archiveDomain.percent(explanation.matchConfidence)}% match</span><small className="asset-pricing-label">{assetPricingLabel(asset)}</small></div><span className={`status-dot ${asset.humanVerified ? "verified" : "review"}`} title={asset.humanVerified ? "Human verified" : "Needs editor review"} /></div></article>;
}

function AssetModalLegacy({ asset, onClose, onNotice }: { asset: Asset; onClose: () => void; onNotice: (notice: string) => void }) { /*
  const explanation = asset.matchExplanation ?? archiveDomain.buildMatchExplanation(asset);
  const model = asset.monetizationModel ?? "membership";
  const requestLabel = asset.freeDownloadEnabled ? authenticated ? "Download free photo" : "Create an account for free downloads" : model === "custom_quote" ? "Request custom quote" : model === "individual_license" ? "Request individual licence" : "Request membership access";
  const notify = onNotice;
  onNotice = (notice: string) => { if (asset.freeDownloadEnabled && notice.startsWith("Sign in and open")) { void onDownload(asset); return; } notify(notice); };
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-title" onClick={(event) => event.stopPropagation()}><button className="close-button" onClick={onClose} aria-label="Close">×</button><div className={`modal-visual ${asset.kind}`}><span>{asset.kind === "video" ? "▶" : "V"}</span></div><div className="modal-copy"><span className="section-kicker">{asset.kind === "video" ? "FILM & VIDEO" : "PHOTOGRAPHY"} · {asset.city}</span><h2 id="asset-title">{asset.title}</h2><p>{asset.caption || asset.description}</p><div className="tag-list">{asset.culturalTags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="match-box"><div className="card-heading"><span className="section-kicker">WHY THIS MATCHED</span><strong>{archiveDomain.percent(explanation.matchConfidence)}% {archiveDomain.confidenceLabel(explanation.matchConfidence)}</strong></div>{explanation.signals.slice(0, 3).map((signal) => <p key={signal.label}><b>{signal.label}:</b> {signal.detail}</p>)}<small>{explanation.metadataReviewNote}</small></div><div className="rights-summary"><span>Rights: <b>{asset.rightsStatus}</b></span><span>Authenticity: <b>{archiveDomain.percent(asset.authenticityConfidence)}%</b></span><span>Access: <b>{assetPricingLabel(asset)}</b></span></div><div className="modal-actions"><button className="dark-button" onClick={() => onNotice("Sign in and open the governance workspace to request a licence.")}>{requestLabel} <span>↗</span></button><button className="ghost-button" onClick={() => onNotice("Lightbox saving is not available until an authenticated workspace is connected.")}>Save to lightbox</button></div></div></div></div>;
*/ }


type AssetCheckoutValidation = {
  allowed: boolean;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
  blockingReasons: string[];
  priceCents: number | null;
  currency: string;
  licence: { label: string; summary: string; usage: string; releaseNote: string };
  monetizationModel: MonetizationModel;
  purchase: { paymentRequired: boolean; paymentStatus: string; originalAccess: string };
};

function AssetModal({ asset, api, autoOpenPurchase = false, onClose, onNotice: notify, onRequireSignIn, authenticated, lightboxes, onCreateLightbox, onSaveToLightbox, onDownload }: {
  asset: Asset;
  api: (path: string, init?: RequestInit) => Promise<Response>;
  autoOpenPurchase?: boolean;
  onClose: () => void;
  onNotice: (notice: string) => void;
  onRequireSignIn: (assetId?: string) => void;
  authenticated: boolean;
  lightboxes: UserLightbox[];
  onCreateLightbox: (name: string) => Promise<UserLightbox | null>;
  onSaveToLightbox: (lightboxId: string, assetId: string) => Promise<boolean>;
  onDownload: (asset: Asset) => Promise<void>;
}) {
  const explanation = asset.matchExplanation ?? archiveDomain.buildMatchExplanation(asset);
  const model = asset.monetizationModel ?? "membership";
  const defaultLicenceType: LicenceType = asset.rightsStatus === "editorial_only" || asset.mediaUsageType === "editorial" ? "editorial" : "commercial";
  const [purchaseOpen, setPurchaseOpen] = useState(autoOpenPurchase && authenticated);
  const [licenceType, setLicenceType] = useState<LicenceType>(defaultLicenceType);
  const [territory, setTerritory] = useState("Worldwide");
  const [durationDays, setDurationDays] = useState(365);
  const [validation, setValidation] = useState<AssetCheckoutValidation | null>(null);
  const [validationState, setValidationState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [termsViewed, setTermsViewed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingId, setSavingId] = useState("");
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (autoOpenPurchase && authenticated) setPurchaseOpen(true);
  }, [autoOpenPurchase, authenticated]);

  const validateLicence = useCallback(async (): Promise<AssetCheckoutValidation | null> => {
    setValidationState("loading");
    setPurchaseError("");
    try {
      const response = await api("/api/checkout/validate", {
        method: "POST",
        body: JSON.stringify({ assetId: asset.id, licenceType, territory, durationDays }),
      });
      const body = await response.json().catch(() => ({})) as Partial<AssetCheckoutValidation> & { error?: string };
      if (!response.ok || !body.checks || !body.licence) throw new Error(body.error ?? "Licence validation is unavailable.");
      const checked = body as AssetCheckoutValidation;
      setValidation(checked);
      setValidationState("ready");
      return checked;
    } catch (error) {
      setValidation(null);
      setValidationState("error");
      setPurchaseError(error instanceof Error ? error.message : "Licence validation is unavailable.");
      return null;
    }
  }, [api, asset.id, durationDays, licenceType, territory]);

  useEffect(() => {
    if (!purchaseOpen || !authenticated || model === "custom_quote") return;
    void validateLicence();
  }, [authenticated, model, purchaseOpen, validateLicence]);

  async function createAndSave(event: React.FormEvent) {
    event.preventDefault();
    const created = await onCreateLightbox(newName);
    if (!created) return;
    setNewName("");
    await onSaveToLightbox(created.id, asset.id);
  }

  async function save(lightboxId: string) {
    setSavingId(lightboxId);
    await onSaveToLightbox(lightboxId, asset.id);
    setSavingId("");
  }

  function openPurchase(): void {
    if (asset.freeDownloadEnabled) { void onDownload(asset); return; }
    if (!authenticated) { onRequireSignIn(asset.id); return; }
    if (model === "custom_quote") { notify("This asset uses a custom quote and cannot be purchased automatically. Contact the contributor for pricing."); return; }
    setPurchaseOpen((open) => !open);
  }

  async function purchaseLicence(): Promise<void> {
    if (!authenticated) { onRequireSignIn(asset.id); return; }
    if (!termsViewed || !termsAccepted) {
      setPurchaseError("Open the terms and accept them before continuing to payment.");
      return;
    }
    setPurchaseBusy(true);
    setPurchaseError("");
    let licenceId = "";
    try {
      const checked = await validateLicence();
      if (!checked?.allowed) return;
      const response = await api("/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          assetId: asset.id,
          licenceType,
          territory,
          durationDays,
          buyerAgreementVersion: buyerAgreement.version,
          paymentAgreementVersion: paymentDisclosure.version,
          acceptBuyerTerms: true,
        }),
      });
      const created = await response.json().catch(() => ({})) as { licenceId?: string; error?: string; blockingReasons?: string[] };
      if (!response.ok || !created.licenceId) throw new Error(created.blockingReasons?.[0] ?? created.error ?? "The licence could not be created.");
      licenceId = created.licenceId;
      const payment = await api(`/api/payments/${encodeURIComponent(licenceId)}/session`, {
        method: "POST",
        body: JSON.stringify({
          successUrl: `${window.location.origin}/account?licence=${encodeURIComponent(licenceId)}&payment=complete`,
          cancelUrl: `${window.location.origin}/account?licence=${encodeURIComponent(licenceId)}&payment=cancelled`,
        }),
      });
      const session = await payment.json().catch(() => ({})) as { checkoutUrl?: string; provider?: string; error?: string };
      if (!payment.ok || !session.checkoutUrl) throw new Error(session.error ?? "Secure payment checkout could not be opened.");
      notify(session.provider === "demo" ? "Demo licence created. Opening the simulated checkout; no real transaction will be made." : "Licence created. Opening secure payment checkout.");
      window.location.assign(session.checkoutUrl);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Secure checkout could not be opened.";
      setPurchaseError(reason);
      notify(licenceId ? "The licence was created, but payment could not start. Open Account to continue payment; retrying will not create a duplicate." : reason);
    } finally {
      setPurchaseBusy(false);
    }
  }

  const purchaseLabel = asset.freeDownloadEnabled
    ? authenticated ? "Download free photo" : "Create an account for free downloads"
    : model === "custom_quote" ? "Request custom quote"
    : authenticated ? "Purchase licence"
    : "Sign in to purchase licence";
  const licenceOptions: LicenceType[] = ["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"];
  const statusLabel = validationState === "loading" ? "Checking…" : validationState === "error" ? "Unavailable" : validation?.allowed ? "Ready" : validation ? "Blocked" : "Not checked";

  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div className="asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-title" onClick={(event) => event.stopPropagation()}>
      <button ref={closeButtonRef} className="close-button" onClick={onClose} aria-label="Close">×</button>
      <div className={`modal-visual ${asset.kind}`}><span>{asset.kind === "video" ? "▶" : "V"}</span></div>
      <div className="modal-copy">
        <span className="section-kicker">{asset.kind === "video" ? "FILM & VIDEO" : "PHOTOGRAPHY"} · {asset.city}</span>
        <h2 id="asset-title">{asset.title}</h2>
        <p>{asset.caption || asset.description}</p>
        <div className="tag-list">{asset.culturalTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <div className="match-box"><div className="card-heading"><span className="section-kicker">WHY THIS MATCHED</span><strong>{archiveDomain.percent(explanation.matchConfidence)}% {archiveDomain.confidenceLabel(explanation.matchConfidence)}</strong></div>{explanation.signals.slice(0, 3).map((signal) => <p key={signal.label}><b>{signal.label}:</b> {signal.detail}</p>)}<small>{explanation.metadataReviewNote}</small></div>
        <div className="rights-summary"><span>Rights: <b>{asset.rightsStatus}</b></span><span>Authenticity: <b>{archiveDomain.percent(asset.authenticityConfidence)}%</b></span><span>Access: <b>{assetPricingLabel(asset)}</b></span></div>
        <div className="modal-actions"><button type="button" className="dark-button" onClick={openPurchase}>{purchaseLabel} <span>↗</span></button><button type="button" className="ghost-button" onClick={() => authenticated ? setSaveOpen((open) => !open) : notify("Sign in to save assets to a private lightbox.")}>{saveOpen ? "Close lightbox" : "Save to lightbox"}</button></div>

        {purchaseOpen && <section className="asset-purchase-panel" aria-labelledby="asset-purchase-title">
          <div className="card-heading"><div><span className="section-kicker">AUTOMATIC LICENCE PURCHASE</span><h3 id="asset-purchase-title">Buy this asset with a recorded contract.</h3></div><span className={`purchase-status ${validation?.allowed ? "ready" : ""}`}>{statusLabel}</span></div>
          <p className="purchase-intro">Choose the intended use below. Veld checks the published record and rights evidence before creating the licence; payment still opens through the configured provider.</p>
          <div className="asset-purchase-controls">
            <label>Licence type<select value={licenceType} onChange={(event) => { setLicenceType(event.target.value as LicenceType); setTermsAccepted(false); }}>{licenceOptions.map((option) => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}</select></label>
            <label>Territory<select value={territory} onChange={(event) => { setTerritory(event.target.value); setTermsAccepted(false); }}><option>Worldwide</option><option>South Africa</option><option>Southern Africa</option></select></label>
            <label>Duration<select value={durationDays} onChange={(event) => { setDurationDays(Number(event.target.value)); setTermsAccepted(false); }}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option><option value={730}>2 years</option></select></label>
          </div>
          {validation?.licence && <div className="purchase-description"><div><span className="section-kicker">SELECTED LICENCE</span><strong>{validation.licence.label}</strong><p>{validation.licence.summary}</p></div><div><span className="section-kicker">PRICE</span><strong>{validation.priceCents === null ? "Custom quote" : formatZar(validation.priceCents)}</strong><p>{validation.priceCents === null ? "The contributor must confirm pricing." : "No charge is made until secure checkout is opened."}</p></div></div>}
          {validationState === "loading" && <p className="purchase-feedback" role="status" aria-live="polite">Checking approval, rights scope, and release evidence…</p>}
          {validationState === "error" && <p className="purchase-feedback error" role="alert">{purchaseError || "Licence validation is unavailable."} <button type="button" className="text-button" onClick={() => void validateLicence()}>Try again</button></p>}
          {validation && <div className={`purchase-checks ${validation.allowed ? "clear" : "blocked"}`} aria-label="Licence validation checks">{validation.checks.map((check) => <div key={check.label}><span className={check.passed ? "check-pass" : "check-fail"}>{check.passed ? "✓" : "×"}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>}
          {validation?.licence && <p className="purchase-usage"><strong>Usage:</strong> {validation.licence.usage} <span>{validation.licence.releaseNote}</span></p>}
          <details className="purchase-terms" onToggle={(event) => { if (event.currentTarget.open) setTermsViewed(true); }}><summary>Read {buyerAgreement.title} and {paymentDisclosure.title}</summary><div><h4>{buyerAgreement.title} · {buyerAgreement.version}</h4>{buyerAgreement.sections.map((section) => <p key={section.heading}><strong>{section.heading}</strong> {section.body}</p>)}<h4>{paymentDisclosure.title} · {paymentDisclosure.version}</h4>{paymentDisclosure.sections.map((section) => <p key={section.heading}><strong>{section.heading}</strong> {section.body}</p>)}</div></details>
          <label className="purchase-terms-check"><input type="checkbox" checked={termsAccepted} disabled={!termsViewed || purchaseBusy} onChange={(event) => setTermsAccepted(event.target.checked)} /><span>I have read and accept the displayed buyer licence and payment terms for this selected use.</span></label>
          {purchaseError && validationState !== "error" && <p className="purchase-feedback error" role="alert">{purchaseError}</p>}
          <div className="purchase-actions"><button type="button" className="outline-button" onClick={() => void validateLicence()} disabled={validationState === "loading" || purchaseBusy}>Check licence again</button><button type="button" className="dark-button" onClick={() => void purchaseLicence()} disabled={purchaseBusy || validationState === "loading" || !validation?.allowed || !termsAccepted}>{purchaseBusy ? "Preparing secure checkout…" : demoMode ? "Simulate purchase (no charge)" : "Purchase licence"} ↗</button></div>
        </section>}

        {saveOpen && authenticated && <section className="lightbox-panel" aria-label="Save to lightbox"><div className="card-heading"><div><span className="section-kicker">YOUR LIGHTBOXES</span><h3>Keep this asset in reach.</h3></div><span>{lightboxes.reduce((total, box) => total + box.assetCount, 0)} saved</span></div>{lightboxes.length ? <div className="lightbox-list">{lightboxes.map((box) => <button type="button" key={box.id} disabled={savingId === box.id || box.assetIds.includes(asset.id)} onClick={() => void save(box.id)}><span><strong>{box.name}</strong><small>{box.assetCount} asset{box.assetCount === 1 ? "" : "s"} · {box.visibility}</small></span><b>{box.assetIds.includes(asset.id) ? "Saved" : savingId === box.id ? "Saving…" : "Add ↗"}</b></button>)}</div> : <p className="lightbox-empty">Create your first private collection for a brief, mood, or client.</p>}<form className="lightbox-create" onSubmit={createAndSave}><label>New lightbox name<input required maxLength={120} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Cape Town launch" /></label><button type="submit" className="outline-button">Create & save</button></form></section>}
      </div>
    </div>
  </div>;
}

function AuthenticatedApp() {
  return <App auth0={useAuth0()} supabase={supabaseClient} />;
}

function Root() {
  if (demoMode || !auth0Configured) return <App supabase={demoMode ? undefined : supabaseClient} />;
  return <Auth0Provider
    domain={auth0Domain!}
    clientId={auth0ClientId!}
    cacheLocation="memory"
    authorizationParams={{ redirect_uri: window.location.origin, scope: auth0Scopes, ...(auth0Audience ? { audience: auth0Audience } : {}), ...(auth0Organization ? { organization: auth0Organization } : {}) }}
    onRedirectCallback={(appState) => {
      const returnTo = typeof appState?.returnTo === "string" && appState.returnTo.startsWith("/") && !appState.returnTo.startsWith("//") ? appState.returnTo : "/";
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (returnTo !== current) window.location.assign(returnTo);
    }}
  >
    <AuthenticatedApp />
  </Auth0Provider>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Root /></React.StrictMode>);
