import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { archiveDomain, type Asset, type AssetVersionEvent, type BuyerAnalytics, type BuyerLightbox, type CommunityOverview, type ContributorAnalytics, type LicenceType, type MonetizationModel, type NotificationItem, type PayoutBatchItem, type PayoutBatchSummary, type PhotoJobSummary, type SavedSearch, type SearchResponse, type TakedownReason, type WebhookSubscription, type WorkflowStage } from "./shared";
import { testPhotoLibrary } from "./test-library";
import "./styles.css";
import { CommunityWorkspace } from "./community";

declare global {
  interface Window {
    turnstile?: { render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; "expired-callback"?: () => void }) => string; reset: (widgetId?: string) => void };
  }
}

function TurnstileChallenge({ onToken }: { onToken: (token: string) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sitekey = import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined;
    if (!sitekey || sitekey.startsWith("replace-") || !ref.current || !window.turnstile) return undefined;
    const widgetId = window.turnstile.render(ref.current, { sitekey, action: "contributor-contract", callback: onToken, "expired-callback": () => onToken("") });
    return () => { window.turnstile?.reset(widgetId); };
  }, [onToken]);
  return <div ref={ref} aria-label="Bot protection challenge" />;
}

type View = "explore" | "search" | "dashboard" | "contributor" | "buyer" | "review" | "governance" | "ledger" | "community";
type SessionUser = { id: string; email: string; displayName: string; role: string; organizationId: string; organizationName: string };
type ApprovalLedgerEntry = {
  id: string;
  category: "user_account" | "image";
  source: "signed_audit" | "workflow_event" | "r2_data_catalog";
  occurredAt: string;
  action: string;
  decision: string;
  actor: { id: string; name: string; role: string };
  subject: { id: string; name: string; type: string };
  resource: { type: string; id: string; title: string };
  streamId: string | null;
  sequence: number | null;
  notes: string | null;
  integrity: { status: "verified" | "failed" | "legacy" | "catalog"; hashValid: boolean | null; signatureValid: boolean | null; hash: string | null; r2Key: string | null };
};

type AuditAnalyticsConnectors = {
  pipeline: "configured" | "not_configured";
  r2DataCatalog: "configured" | "not_configured";
  r2Sql: "configured" | "not_configured";
  table: string;
  catalogSearch?: "ready" | "not_configured" | "unavailable";
};

function isJsonResponse(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;
}

async function readJson<T>(response: Response, message: string): Promise<T> {
  if (!response.ok || !isJsonResponse(response)) throw new Error(message);
  return response.json() as Promise<T>;
}

const demoAssets: Asset[] = [
  { id: "asset-braai-cape-flats", kind: "image", status: "published", title: "Saturday braai, Cape Flats", description: "A human-verified South African braai in an everyday Cape Flats setting.", caption: "Friends gather around a wood-fire braai in the Cape Flats.", country: "South Africa", province: "Western Cape", city: "Cape Town", locality: "Mitchells Plain", landmark: null, subjectTags: ["people", "food", "community", "outdoor"], culturalTags: ["South African braai", "wood-fire braai", "Cape Flats"], rightsStatus: "verified", modelReleaseStatus: "verified", propertyReleaseStatus: "not_required", authenticityConfidence: .92, humanVerified: true, contributor: "Veld demo archive", workflowStage: "approval", aiTags: ["braai", "community"], curatorNotes: "Demo fallback record." },
  { id: "asset-demo-table-mountain", kind: "image", status: "published", title: "Table Mountain above Cape Town", description: "A documented panorama of Table Mountain in Cape Town, Western Cape.", caption: "Table Mountain, Cape Town, Western Cape, South Africa.", country: "South Africa", province: "Western Cape", city: "Cape Town", locality: "City Bowl", landmark: "Table Mountain", subjectTags: ["landscape", "mountain", "city", "coast"], culturalTags: ["South African landscape", "Cape Town"], rightsStatus: "verified", modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", authenticityConfidence: .99, humanVerified: true, contributor: "Veld demo archive", workflowStage: "approval", aiTags: ["South Africa", "Cape Town", "Table Mountain"], curatorNotes: "Demo fallback record." },
  { id: "asset-demo-garden-route", kind: "image", status: "published", title: "Garden Route landscape", description: "A documented photograph of the Garden Route National Park in South Africa.", caption: "Garden Route National Park landscape, South Africa.", country: "South Africa", province: "Eastern Cape", city: "Knysna", locality: "Garden Route", landmark: "Garden Route National Park", subjectTags: ["landscape", "forest", "coast", "travel"], culturalTags: ["South African landscape", "Garden Route"], rightsStatus: "verified", modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", authenticityConfidence: .98, humanVerified: true, contributor: "Veld demo archive", workflowStage: "approval", aiTags: ["South Africa", "Garden Route"], curatorNotes: "Demo fallback record." },
  { id: "asset-demo-road", kind: "video", status: "published", title: "Left-side drive through the Garden Route", description: "A right-hand-drive vehicle travels on the left side of a Garden Route road.", caption: "Road footage through the Garden Route, South Africa.", country: "South Africa", province: "Western Cape", city: "George", locality: "Garden Route", landmark: "Outeniqua Mountains", subjectTags: ["road", "travel", "driving", "video"], culturalTags: ["Garden Route", "right-hand drive", "South African road life"], rightsStatus: "verified", modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", authenticityConfidence: .94, humanVerified: true, contributor: "Veld demo archive", workflowStage: "approval", aiTags: ["Garden Route", "road footage"], curatorNotes: "Demo fallback record." },
  ...testPhotoLibrary,
];

function filterDemoAssets(query: string, kind: "all" | "image" | "video"): Asset[] {
  const kindFiltered = kind === "all" ? demoAssets : demoAssets.filter((asset) => asset.kind === kind);
  return archiveDomain.rankSearchAssets(kindFiltered, query);
}

const WORKSPACE_NAV_ITEMS: { view: "dashboard" | "contributor" | "buyer" | "review" | "governance" | "ledger"; label: string; icon: string; roles: string[] }[] = [
  { view: "dashboard", label: "Dashboard", icon: "\u25a6", roles: ["contributor", "buyer", "editor", "admin"] },
  { view: "contributor", label: "Contributor", icon: "\u25c6", roles: ["contributor", "admin"] },
  { view: "buyer", label: "Buyer ROI", icon: "\u25c7", roles: ["buyer", "admin"] },
  { view: "review", label: "Editorial review", icon: "\u25a4", roles: ["editor", "admin"] },
  { view: "governance", label: "Governance", icon: "\u25a3", roles: ["editor", "admin"] },
  { view: "ledger", label: "Admin ledger", icon: "\u25a5", roles: ["admin"] },
];

function NotificationBell({ api }: { api: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  const load = useCallback(async () => {
    try {
      const response = await api("/api/notifications");
      const data = await readJson<{ results: NotificationItem[] }>(response, "Notifications unavailable");
      setItems(data.results);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  }, [api]);

  useEffect(() => { void load(); const timer = setInterval(() => void load(), 60_000); return () => clearInterval(timer); }, [load]);

  async function markRead(id: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
    try { await api(`/api/notifications/${id}/read`, { method: "POST", body: "{}" }); } catch { /* best effort */ }
  }

  const unreadCount = items.filter((item) => !item.readAt).length;

  return <div className="notification-bell">
    <button type="button" className="ghost-button notification-bell-toggle" aria-expanded={open} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} onClick={() => setOpen((value) => !value)}>
      🔔{unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
    </button>
    {open && <div className="notification-panel" role="dialog" aria-label="Notifications">
      <div className="notification-panel-heading"><span className="section-kicker">NOTIFICATIONS</span><button type="button" className="text-button" onClick={() => setOpen(false)}>Close</button></div>
      {state === "unavailable" && <div className="empty-state">Notifications are unavailable right now.</div>}
      {state === "ready" && !items.length && <div className="empty-state">You are all caught up.</div>}
      {state === "ready" && items.map((item) => <button type="button" key={item.id} className={`notification-row${item.readAt ? "" : " unread"}`} onClick={() => markRead(item.id)}>
        <strong>{item.title}</strong><small>{item.body}</small><span>{new Date(item.createdAt).toLocaleString("en-ZA")}</span>
      </button>)}
    </div>}
  </div>;
}

function WorkspaceShell({ view, sessionUser, navigate, authBusy, onSignOut, api, children }: { view: View; sessionUser: SessionUser; navigate: (view: View) => void; authBusy: boolean; onSignOut: () => void; api: (path: string, init?: RequestInit) => Promise<Response>; children: React.ReactNode }) {
  const roleItems = WORKSPACE_NAV_ITEMS.filter((item) => item.roles.includes(sessionUser.role));
  const navItems = roleItems.length ? roleItems : WORKSPACE_NAV_ITEMS;
  const current = WORKSPACE_NAV_ITEMS.find((item) => item.view === view);
  return <div className="workspace-shell">
    <header className="workspace-topbar topbar">
      <button className="wordmark wordmark-button" onClick={() => navigate("explore")} aria-label="Veld Archive home"><VeldWordmark /></button>
      <div className="sync-status"><span className="pulse" /> Connected to live archive service</div>
      <div className="top-actions"><button className="ghost-button" onClick={() => navigate("community")}>Community</button><NotificationBell api={api} /><span className="user-chip">{sessionUser.displayName}<span>{sessionUser.role}</span></span><button className="ghost-button" disabled={authBusy} onClick={onSignOut}>{authBusy ? "Signing out\u2026" : "Sign out"}</button></div>
    </header>
    <div className="workspace-main">
      <aside className="workspace-sidebar">
        <span className="sidebar-kicker">{sessionUser.organizationName}</span>
        <h1>Workspace<br /><em>{current?.label ?? "Overview"}.</em></h1>
        <p className="sidebar-copy">Move between the surfaces your role can act on.</p>
        <nav className="side-nav" aria-label="Workspace navigation">{navItems.map((item) => <button key={item.view} type="button" className={`side-nav-item${view === item.view ? " active" : ""}`} aria-current={view === item.view ? "page" : undefined} onClick={() => navigate(item.view)}><span className="side-icon" aria-hidden="true">{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-footer"><span className="section-kicker">SESSION</span><div className="side-metric"><strong>{sessionUser.role}</strong><span>signed in role</span></div><p className="sidebar-role-note">{sessionUser.role === "contributor" ? "Complete onboarding below, then submit records for editorial review." : sessionUser.role === "buyer" ? "Search, licence, and track campaigns from this workspace." : "Review queues and governance actions for this organisation."}</p></div>
      </aside>
      <div className="governance-content">{children}</div>
    </div>
  </div>;
}

function VeldWordmark() {
  return <>
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 42 42" focusable="false">
        <circle className="brand-mark-field" cx="21" cy="21" r="20" />
        <path className="brand-mark-horizon" d="M9.5 17.6h23" />
        <path className="brand-mark-track brand-mark-track-left" d="M12.5 10.5 20.8 31.8" />
        <path className="brand-mark-track brand-mark-track-right" d="M29.5 10.5 21.2 31.8" />
        <path className="brand-mark-veld" d="M9 27.2c5.1-2.7 9.2-2.7 12.2 0 3.1 2.7 7.1 2.7 11.8 0v6.9H9z" />
        <circle className="brand-mark-proof" cx="31.1" cy="12.2" r="2.1" />
      </svg>
    </span>
    <span className="wordmark-text"><span>veld</span><span className="muted">archive</span></span>
  </>;
}

function App() {
  const [view, setView] = useState<View>("explore");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [searchVersion, setSearchVersion] = useState(0);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [facets, setFacets] = useState<SearchResponse["facets"]>([]);
  const [activeFacet, setActiveFacet] = useState<string | null>(null);
  const [notice, setNotice] = useState("Live archive results are loaded from the verified content service.");
  const [reviewItems, setReviewItems] = useState<Asset[]>([]);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [devRole, setDevRole] = useState<"contributor" | "admin">("contributor");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  const api = useCallback((path: string, init: RequestInit = {}) => fetch(path, { ...init, credentials: "include", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}), ...(init.headers ?? {}) } }), [csrfToken]);
  const globalNotice = view !== "search" && notice && !notice.startsWith("Live archive results") ? notice : "";

  useEffect(() => {
    void fetch("/api/auth/session", { credentials: "include" }).then(async (response) => {
      if (!response.ok) return;
      const data = await readJson<{ authenticated: boolean; user?: SessionUser; csrfToken?: string }>(response, "Session API unavailable");
      if (data.authenticated && data.user) { setSessionUser(data.user); setCsrfToken(data.csrfToken ?? ""); }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const assetId = window.location.pathname.match(/^\/assets\/([^/]+)$/)?.[1];
    if (!assetId) return;
    fetch(`/api/assets/${encodeURIComponent(assetId)}`, { credentials: "include" })
      .then((response) => readJson<Asset>(response, "Asset unavailable"))
      .then(setSelectedAsset)
      .catch(() => setNotice("That asset is unavailable or no longer published."));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAssetsLoading(true);
    const params = new URLSearchParams({ q: activeQuery, kind: filter, status: "published" });
    const startedAt = Date.now();
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    fetch(`/api/assets?${params}`, { signal: controller.signal, credentials: "include" })
      .then((response) => readJson<SearchResponse>(response, "API unavailable"))
      .then((data) => {
        const kindFiltered = filter === "all" ? data.results : data.results.filter((asset) => asset.kind === filter);
        setAssets(archiveDomain.rankSearchAssets(kindFiltered, activeQuery).map((asset) => archiveDomain.withMatchExplanation(asset, activeQuery)));
        setFacets(data.facets);
      })
      .then(() => setNotice((current) => current.startsWith("Demo archive mode") ? "Live archive results are loaded from the verified content service." : current))
      .catch(() => {
        if (controller.signal.aborted) return;
        setAssets(filterDemoAssets(activeQuery, filter).map((asset) => archiveDomain.withMatchExplanation(asset, activeQuery)));
        setNotice("Demo archive mode is active while the live content service is unavailable.");
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        const remaining = Math.max(0, 700 - (Date.now() - startedAt));
        finishTimer = setTimeout(() => setAssetsLoading(false), remaining);
      });
    return () => { controller.abort(); if (finishTimer) clearTimeout(finishTimer); };
  }, [activeQuery, filter, searchVersion]);

  async function loadReviewQueue() {
    try {
      const response = await api("/api/admin/review");
      const data = await readJson<{ results: Asset[] }>(response, "Review API unavailable");
      setReviewItems(data.results);
    } catch {
      setReviewItems([]);
      setNotice("The editorial queue is unavailable. No local decisions were applied.");
    }
  }

  function navigate(nextView: View) {
    setMobileMenuOpen(false);
    if (!sessionUser && ["dashboard", "contributor", "buyer", "review", "governance", "ledger"].includes(nextView)) {
      setNotice("Sign in is required for this workspace.");
      return;
    }
    setView(nextView);
    if (nextView !== "explore") setNotice("");
    if (nextView === "review") void loadReviewQueue();
  }

  function trackEvent(payload: Record<string, unknown>) {
    if (!analyticsConsent) return;
    void fetch("/api/analytics/events", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, consent: true }) }).catch(() => undefined);
  }

  async function authenticate(role: "contributor" | "admin" | "buyer" = devRole): Promise<SessionUser | null> {
    setAuthBusy(true);
    try {
      const endpoint = import.meta.env.DEV ? "/api/auth/dev-login" : "/api/auth/demo-login";
      const response = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      if (!response.ok || !isJsonResponse(response)) {
        if (!import.meta.env.DEV && response.status === 404) setNotice("Sign-in is not connected for this deployment. Enable demo auth or connect the organisation identity provider.");
        throw new Error("Authentication unavailable");
      }
      const data = await response.json() as { user?: SessionUser; csrfToken?: string };
      if (!data.user?.id || !data.csrfToken) throw new Error("Incomplete authentication response");
      setSessionUser(data.user);
      setCsrfToken(data.csrfToken);
      setNotice(`Signed in to ${data.user.organizationName}.`);
      return data.user;
    } catch {
      setNotice((current) => current.startsWith("Sign-in is not connected") ? current : "Sign-in is unavailable. Check the Worker API, demo auth setting, or organisation identity provider, then try again.");
      return null;
    } finally {
      setAuthBusy(false);
    }
  }

  async function signIn() {
    const user = await authenticate();
    if (user) setView("dashboard");
  }

  async function signUp() {
    const user = await authenticate("contributor");
    if (!user) return;
    setView("contributor");
    setNotice("Seller workspace opened. Start with your profile, then submit the seller tender and media record.");
  }

  async function signOut() {
    setAuthBusy(true);
    try {
      const response = await api("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      setSessionUser(null);
      setCsrfToken("");
      setView("explore");
      setNotice("Signed out.");
    } catch {
      setNotice("We could not sign you out. Check the connection and try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    setAssets([]);
    setActiveFacet(null);
    setActiveQuery(value);
    setSearchVersion((current) => current + 1);
    trackEvent({ type: "search", query: value });
    setView("search");
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openAsset(asset: Asset) {
    if (window.location.pathname !== `/assets/${asset.id}`) window.history.pushState({ assetId: asset.id }, "", `/assets/${encodeURIComponent(asset.id)}`);
    setSelectedAsset(asset);
  }

  function closeAsset() {
    if (window.location.pathname.startsWith("/assets/")) window.history.pushState({}, "", "/");
    setSelectedAsset(null);
  }

  const verifiedCount = useMemo(() => assets.filter((asset) => asset.humanVerified).length, [assets]);
  const isWorkspaceRoute = view === "dashboard" || view === "contributor" || view === "buyer" || view === "review" || view === "governance" || view === "ledger";

  return <div className="app-shell">
    {!(sessionUser && isWorkspaceRoute) && <header className="topbar">
      <button className="wordmark wordmark-button" onClick={() => navigate("explore")} aria-label="Veld Archive home"><VeldWordmark /></button>
      <nav id="primary-navigation" className={`nav-links${mobileMenuOpen ? " mobile-open" : ""}`} aria-label="Primary navigation"><button onClick={() => navigate("explore")}>Explore</button><button onClick={() => navigate("community")}>Community & collections</button><button onClick={() => navigate("contributor")}>Contributor insights</button><button onClick={() => navigate("buyer")}>Buyer ROI</button><button onClick={() => navigate("review")}>Editorial review</button><button className="governance-link" onClick={() => navigate("governance")}>Governance <span>NEW</span></button></nav>
      <button type="button" className="mobile-menu-button" aria-controls="primary-navigation" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? "Close" : "Menu"}</button>
      <div className="top-actions">{import.meta.env.DEV && <label className="role-switcher">Local role <select value={devRole} onChange={(event) => setDevRole(event.target.value as "contributor" | "admin")}><option value="contributor">Contributor</option><option value="admin">Admin</option></select></label>}{!sessionUser && <><button className="ghost-button" disabled={authBusy} onClick={() => void signIn()}>{authBusy ? "Signing in…" : "Sign in"}</button><button className="dark-button" disabled={authBusy} onClick={() => void signUp()}>{authBusy ? "Opening…" : "Sign up"}</button></>}{sessionUser && <button className="ghost-button" disabled={authBusy} onClick={() => void signOut()}>{authBusy ? "Signing out…" : "Sign out"}</button>}</div>
    </header>}
    {!(sessionUser && isWorkspaceRoute) && !analyticsConsent && <button className="privacy-consent" onClick={() => setAnalyticsConsent(true)}>Allow anonymous demand insights</button>}
    {globalNotice && <div className="global-notice" role="status" aria-live="polite">{globalNotice}</div>}

    {view === "explore" && <ExploreView query={query} setQuery={setQuery} runSearch={runSearch} assets={assets} assetsLoading={assetsLoading} filter={filter} setFilter={setFilter} verifiedCount={verifiedCount} notice={notice} onOpen={openAsset} />}
    {view === "search" && <SearchResultsView query={query} setQuery={setQuery} activeQuery={activeQuery} runSearch={runSearch} assets={assets} assetsLoading={assetsLoading} filter={filter} setFilter={setFilter} notice={notice} onOpen={openAsset} facets={facets} activeFacet={activeFacet} setActiveFacet={setActiveFacet} sessionUser={sessionUser} api={api} onNotice={setNotice} />}
    {view === "community" && <CommunityWorkspace api={api} onNotice={setNotice} sessionUser={sessionUser} />}
    {sessionUser && isWorkspaceRoute && <WorkspaceShell view={view} sessionUser={sessionUser} navigate={navigate} authBusy={authBusy} onSignOut={signOut} api={api}>
      {view === "dashboard" && <DashboardHome sessionUser={sessionUser} api={api} navigate={navigate} />}
      {view === "contributor" && <><ContributorWorkspace api={api} onNotice={setNotice} /><ContributorRevenuePanel api={api} /><ContributorFinanceBreakdownPanel api={api} /><ContributorStatementTools api={api} /><AnalyticsDashboard role="contributor" /></>}
      {view === "buyer" && <><BuyerWorkspace assets={assets} api={api} navigate={navigate} onNotice={setNotice} /><AnalyticsDashboard role="buyer" /></>}
      {view === "review" && <ReviewWorkspace items={reviewItems} api={api} onNotice={setNotice} onReload={loadReviewQueue} />}
      {view === "governance" && <GovernanceWorkspace api={api} onNotice={setNotice} sessionUser={sessionUser} />}
      {view === "ledger" && <AdminLedgerWorkspace api={api} onNotice={setNotice} />}
    </WorkspaceShell>}

    {!(sessionUser && isWorkspaceRoute) && <footer><button className="wordmark wordmark-button" onClick={() => navigate("explore")}><VeldWordmark /></button><span>© 2026 Veld Archive · South Africa</span><span>Context before category.</span></footer>}
    {selectedAsset && <AssetModal asset={selectedAsset} onClose={closeAsset} onNotice={setNotice} sessionUser={sessionUser} api={api} trackEvent={trackEvent} />}
  </div>;
}

function ExploreView({ query, setQuery, runSearch, assets, assetsLoading, filter, setFilter, verifiedCount, notice, onOpen }: { query: string; setQuery: (value: string) => void; runSearch: (event: React.FormEvent) => void; assets: Asset[]; assetsLoading: boolean; filter: "all" | "image" | "video"; setFilter: (value: "all" | "image" | "video") => void; verifiedCount: number; notice: string; onOpen: (asset: Asset) => void }) {
  const suggestions = ["A real wood-fire braai in the Cape Flats", "A verified Table Mountain landscape at golden hour", "Right-hand-drive road footage in the Garden Route"];
  return <main id="top">
    <section className="hero"><div className="eyebrow"><span className="pulse" /> The trusted South African visual archive</div><h1>Find the image<br /><em>behind the story.</em></h1><p className="hero-copy">Authentic photography and film for brands that care where a story comes from.</p><ArchiveSearchForm query={query} setQuery={setQuery} runSearch={runSearch} /><div className="suggestion-row">{suggestions.map((suggestion) => <button type="button" key={suggestion} className="suggestion" onClick={() => { setQuery(suggestion); }}>{suggestion} <span>→</span></button>)}</div></section>
    <section className="trust-strip"><div><strong>01</strong><span>Context-first metadata</span></div><div><strong>02</strong><span>Rights you can trust</span></div><div><strong>03</strong><span>Creators paid fairly</span></div><div className="trust-note">Built for the places we know.</div></section>
    <section className="explore-section"><div className="section-heading"><div><span className="section-kicker">CURATED FROM THE GROUND UP</span><h2>The latest from <em>here.</em></h2></div><div className="result-note" role="status" aria-live="polite">{notice}</div></div><div className="toolbar"><div className="filter-tabs" role="tablist" aria-label="Media type">{(["all", "image", "video"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All media" : value === "image" ? "Photography" : "Film & video"}</button>)}</div><div className="verified-stat"><span className="verified-dot" />{verifiedCount} human-verified results</div></div><div className="explainability-note"><strong>Search evidence is visible.</strong><span>Open a result to inspect the fields used, match confidence, and verification status.</span><span className="ai-badge">AI + HUMAN REVIEW</span></div><div className="asset-grid" aria-busy={assetsLoading}>{assetsLoading ? <div className="empty-state" role="status">Loading verified archive results…</div> : assets.length ? assets.map((asset, index) => <AssetCard key={asset.id} asset={asset} index={index} onOpen={onOpen} />) : <div className="empty-state">No assets matched this brief yet. Try a location, landmark, or cultural context.</div>}</div></section>
    <ModerationQueue assets={assets} onReview={onOpen} />
    <section className="manifesto"><div className="manifesto-label">WHY VELD</div><div><h2>South Africa is not a<br /><em>stock category.</em></h2><p>Every place has a texture. Every community has a point of view. Veld gives the people who make the work more control over how it is found, licensed, and remembered.</p></div></section>
  </main>;
}

function ArchiveSearchForm({ query, setQuery, runSearch }: { query: string; setQuery: (value: string) => void; runSearch: (event: React.FormEvent) => void }) {
  return <form className="search-box" onSubmit={runSearch}><span className="search-icon" aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Describe the story you need to tell…" aria-label="Search media" /><button type="submit">Search archive <span>↗</span></button></form>;
}

const searchSteps = [
  "Reading the story brief",
  "Searching verified archive records",
  "Checking place, rights, and context",
  "Ranking the closest visual matches",
];

function SearchResultsView({ query, setQuery, activeQuery, runSearch, assets, assetsLoading, filter, setFilter, notice, onOpen, facets, activeFacet, setActiveFacet, sessionUser, api, onNotice }: { query: string; setQuery: (value: string) => void; activeQuery: string; runSearch: (event: React.FormEvent) => void; assets: Asset[]; assetsLoading: boolean; filter: "all" | "image" | "video"; setFilter: (value: "all" | "image" | "video") => void; notice: string; onOpen: (asset: Asset) => void; facets: SearchResponse["facets"]; activeFacet: string | null; setActiveFacet: (value: string | null) => void; sessionUser: SessionUser | null; api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [step, setStep] = useState(0);
  const [savingSearch, setSavingSearch] = useState(false);
  useEffect(() => {
    if (!assetsLoading) {
      setStep(searchSteps.length);
      return undefined;
    }
    setStep(0);
    const timer = setInterval(() => setStep((current) => Math.min(searchSteps.length - 1, current + 1)), 360);
    return () => clearInterval(timer);
  }, [activeQuery, assetsLoading]);

  const traceCandidates = archiveDomain.rankSearchAssets(filter === "all" ? demoAssets : demoAssets.filter((asset) => asset.kind === filter), activeQuery);
  const sourceAssets = (assets.length ? assets : traceCandidates).slice(0, 4);
  const isComplete = !assetsLoading;
  const displayedAssets = activeFacet
    ? assets.filter((asset) => asset.province === activeFacet || asset.kind === activeFacet || asset.primaryCategory?.replaceAll("_", " ") === activeFacet || (activeFacet === "verified" && asset.humanVerified))
    : assets;
  const resultMessage = isComplete
    ? notice.startsWith("Demo archive mode")
      ? `${assets.length} matching record${assets.length === 1 ? "" : "s"} found in the demo archive.`
      : `${assets.length} verified result${assets.length === 1 ? "" : "s"} found.`
    : `Searching the archive for “${activeQuery || "the latest verified media"}”`;
  const progress = isComplete ? 100 : Math.round(((step + 1) / searchSteps.length) * 86);

  async function saveSearch() {
    if (!sessionUser) { onNotice("Sign in as a buyer to save this search and get alerted on new matches."); return; }
    setSavingSearch(true);
    try {
      const response = await api("/api/saved-searches", { method: "POST", body: JSON.stringify({ label: activeQuery || "All media", query: activeQuery, kind: filter, notifyOnNew: true }) });
      if (!response.ok) throw new Error();
      onNotice("Search saved. You will be notified when new matches are published.");
    } catch {
      onNotice("Could not save this search right now.");
    } finally {
      setSavingSearch(false);
    }
  }

  return <main className="search-results-page" id="search-results">
    <section className="search-results-intro">
      <div className="search-results-eyebrow"><span className="pulse" /> Archive search / live trace</div>
      <h1>Finding the visual story<br /><em>behind your brief.</em></h1>
      <ArchiveSearchForm query={query} setQuery={setQuery} runSearch={runSearch} />
      <div className="search-status" role="status" aria-live="polite" aria-busy={assetsLoading}><span className={`search-status-dot${isComplete ? " complete" : ""}`} /> <span>{resultMessage}</span>{isComplete && <button type="button" className="text-button" disabled={savingSearch} onClick={() => void saveSearch()}>{savingSearch ? "Saving…" : "Save this search"}</button>}</div>
    </section>

    <section className="search-workbench" aria-label="Search process">
      <aside className="search-progress-panel">
        <div className="search-progress-heading"><span className="section-kicker">SEARCH PROCESS</span><strong>{isComplete ? "Complete" : `${progress}%`}</strong></div>
        <div className="search-progress-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        <ol className="search-step-list">{searchSteps.map((label, index) => <li key={label} className={index < step || isComplete ? "done" : index === step ? "current" : ""}><span>{index < step || isComplete ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>{label}</strong>{index === step && !isComplete && <small>Working through indexed records</small>}</li>)}</ol>
        <p className="search-provenance"><strong>What is being checked?</strong> Published records, human verification, location context, rights status, and the language of your brief.</p>
      </aside>
      <section className="search-trace-panel" aria-labelledby="trace-heading">
        <div className="search-trace-heading"><div><span className="section-kicker">CANDIDATE MEDIA</span><h2 id="trace-heading">{isComplete ? "Candidate records checked" : "Images being checked"} <em>{isComplete ? "first." : "now."}</em></h2></div><span className="trace-count">{sourceAssets.length} candidate{sourceAssets.length === 1 ? "" : "s"} in view</span></div>
        <div className="search-trace-grid">{sourceAssets.map((asset, index) => <SearchTraceCard key={asset.id} asset={asset} index={index} onOpen={onOpen} loading={!isComplete} />)}</div>
      </section>
    </section>

    <section className="search-matches" aria-labelledby="matches-heading">
      <div className="section-heading"><div><span className="section-kicker">RANKED MATCHES</span><h2 id="matches-heading">The closest <em>stories.</em></h2></div><span className="result-note">Matches use stored metadata and verification signals. Open a result for the evidence behind its ranking.</span></div>
      <div className="toolbar"><div className="filter-tabs" role="tablist" aria-label="Media type">{(["all", "image", "video"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All media" : value === "image" ? "Photography" : "Film & video"}</button>)}</div><span className="verified-stat"><span className="verified-dot" />{assets.filter((asset) => asset.humanVerified).length} human-verified results</span></div>
      {isComplete && facets.length > 0 && <div className="facet-chip-row" role="group" aria-label="Refine by facet">
        <button type="button" className={`facet-chip${activeFacet === null ? " active" : ""}`} onClick={() => setActiveFacet(null)}>All ({assets.length})</button>
        {facets.map((facet) => <button type="button" key={`${facet.label}-${facet.value}`} className={`facet-chip${activeFacet === facet.value ? " active" : ""}`} onClick={() => setActiveFacet(activeFacet === facet.value ? null : facet.value)}>{facet.label} ({facet.count})</button>)}
      </div>}
      <div className="asset-grid" aria-busy={assetsLoading}>{assetsLoading ? <div className="empty-state" role="status">Ranking the checked candidates...</div> : displayedAssets.length ? displayedAssets.map((asset, index) => <AssetCard key={asset.id} asset={asset} index={index} onOpen={onOpen} />) : <div className="empty-state">No records matched this brief closely enough. Try a location, landmark, or cultural context.</div>}</div>
    </section>
  </main>;
}

function SearchTraceCard({ asset, index, onOpen, loading }: { asset: Asset; index: number; onOpen: (asset: Asset) => void; loading: boolean }) {
  return <button type="button" className={`search-trace-card${loading ? " is-loading" : ""}`} onClick={() => onOpen(asset)} aria-label={`Inspect ${asset.title} while searching`}><div className={`search-trace-visual visual-${(index % 3) + 1} ${asset.kind}`}>{asset.previewUrl && <MediaAsset asset={asset} />}<span className="search-trace-scan" aria-hidden="true" /><span className="search-trace-kind">{asset.kind === "video" ? "FILM" : "PHOTO"}</span><span className="search-trace-place">{asset.landmark ?? asset.locality ?? asset.city}</span></div><div className="search-trace-copy"><strong>{asset.title}</strong><small>{loading ? "Checking metadata…" : "Match candidate"}</small></div></button>;
}

function SearchResultsViewFallback({ query, setQuery, activeQuery, runSearch, assets, assetsLoading, filter, setFilter, notice, onOpen }: { query: string; setQuery: (value: string) => void; activeQuery: string; runSearch: (event: React.FormEvent) => void; assets: Asset[]; assetsLoading: boolean; filter: "all" | "image" | "video"; setFilter: (value: "all" | "image" | "video") => void; notice: string; onOpen: (asset: Asset) => void }) {
  return <main className="search-results-fallback">
    <section className="search-results-intro">
      <span className="section-kicker">ARCHIVE SEARCH</span>
      <h1>Results for <em>{activeQuery || "the latest verified media"}</em></h1>
      <form className="search-box" onSubmit={runSearch}>
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Describe the story you need to tell…" aria-label="Search media" />
        <button type="submit">Search archive <span aria-hidden="true">↗</span></button>
      </form>
      <p className="result-note" role="status" aria-live="polite">{notice || "Open a result to inspect evidence, rights, provenance, and match signals."}</p>
    </section>
    <section className="explore-section search-results-section">
      <div className="toolbar">
        <div className="filter-tabs" role="tablist" aria-label="Media type">{(["all", "image", "video"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All media" : value === "image" ? "Photography" : "Film & video"}</button>)}</div>
        <span className="result-note">{assets.length} result{assets.length === 1 ? "" : "s"}</span>
      </div>
      <div className="explainability-note"><strong>Search evidence is visible.</strong><span>Open a result to inspect the fields used, match confidence, and verification status.</span><span className="ai-badge">AI + HUMAN REVIEW</span></div>
      <div className="asset-grid" aria-busy={assetsLoading}>{assetsLoading ? <div className="empty-state" role="status">Loading verified archive results…</div> : assets.length ? assets.map((asset, index) => <AssetCard key={asset.id} asset={asset} index={index} onOpen={onOpen} />) : <div className="empty-state">No assets matched this brief yet. Try a location, landmark, or cultural context.</div>}</div>
    </section>
  </main>;
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

  async function act(asset: Asset, action: "approve" | "reject") {
    try {
      const response = await api(`/api/governance/assets/${asset.id}/action`, { method: "POST", body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error();
      onNotice(`${asset.title} moved through the ${action.replaceAll("_", " ")} stage.`);
      setAssets((current) => current.filter((item) => item.id !== asset.id));
    } catch {
      onNotice("Governance actions require the latest D1 migration and an editor identity.");
    }
  }

  return <main className="workspace-page"><div className="workspace-intro"><span className="section-kicker">GOVERNANCE WORKSPACE</span><h1>Evidence before <em>approval.</em></h1><p>AI suggestions are created once at upload; later metadata changes are manual and auditable.</p></div><div className="toolbar"><div className="filter-tabs">{(["all", "ingestion", "ai_tagging", "curator_correction", "approval"] as const).map((value) => <button key={value} className={stage === value ? "active" : ""} onClick={() => setStage(value)}>{value.replaceAll("_", " ")}</button>)}</div><span className="verified-stat">{assets.length} records</span></div><div className="review-queue">{assets.length ? assets.map((asset) => <article className="review-item" key={asset.id}><div className={`review-visual ${asset.kind}`}><span>{asset.kind === "video" ? "▶" : "V"}</span></div><div className="review-copy"><div className="card-heading"><span className="section-kicker">{asset.workflowStage.replaceAll("_", " ")}</span><span className={`status-pill ${asset.humanVerified ? "cool" : "warm"}`}>{asset.humanVerified ? "Verified" : "Needs context"}</span></div><h2>{asset.title}</h2><p>{asset.caption || asset.description}</p><div className="review-tags">{asset.culturalTags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="review-actions"><button className="ghost-button" onClick={() => void act(asset, "approve")}>Approve</button><button className="ghost-button danger-button" onClick={() => void act(asset, "reject")}>Reject</button></div></div></article>) : <div className="empty-state">No governance records are available for this stage.</div>}</div></main>;
}

function formatZar(cents: number): string { return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(cents / 100); }

function monetizationLabel(model: MonetizationModel = "membership"): string {
  if (model === "individual_license") return "Individual licence";
  if (model === "custom_quote") return "Custom quote";
  return "Membership access";
}

function assetPricingLabel(asset: Asset): string {
  const model = asset.monetizationModel ?? "membership";
  return model === "individual_license" && asset.licensePriceCents ? `${formatZar(asset.licensePriceCents)} / year` : monetizationLabel(model);
}

function MetricBars({ points, tone = "rust" }: { points: { label: string; value: number }[]; tone?: "rust" | "green" }) {
  const max = Math.max(...points.map((point) => point.value), 1);
  return <div className={`metric-bars ${tone}`}>{points.map((point) => <div className="metric-bar" key={point.label} title={`${point.label}: ${point.value}`}><span style={{ height: `${Math.max(8, (point.value / max) * 100)}%` }} /><small>{point.label}</small></div>)}</div>;
}

function AnalyticsDashboard({ role }: { role: "contributor" | "buyer" }) {
  const [data, setData] = useState<ContributorAnalytics | BuyerAnalytics | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/analytics/${role}`, { signal: controller.signal, credentials: "include" })
      .then((response) => readJson<ContributorAnalytics | BuyerAnalytics>(response, "Analytics unavailable"))
      .then(setData).catch(() => setData(null));
    return () => controller.abort();
  }, [role]);

  if (!data) return <section className="analytics-page"><div className="empty-state">Analytics are unavailable. No cached or placeholder figures are shown.</div></section>;

  if (data.role === "contributor") return <section className="analytics-page"><div className="workspace-intro"><span className="section-kicker">CONTRIBUTOR SIGNALS · {data.range}</span><h1>Make what the<br /><em>brief is asking for.</em></h1><p>Demand is shown in aggregate so you can spot opportunity without tracking individual buyers.</p></div><div className="metric-grid"><MetricCard label="Archive searches" value={data.summary.searches.toLocaleString()} detail="for your context and tags" /><MetricCard label="Asset views" value={data.summary.views.toLocaleString()} detail="on your published work" /><MetricCard label="Demand change" value={`+${data.summary.demandChange}%`} detail="compared with prior period" tone="green" /><MetricCard label="Saved to briefs" value={data.summary.saves.toLocaleString()} detail="lightbox saves" /></div><div className="analytics-columns"><article className="analytics-card analytics-wide"><div className="card-heading"><div><span className="section-kicker">SEARCH TRENDS</span><h2>What buyers are looking for</h2></div><span className="status-pill cool">Aggregate only</span></div><MetricBars points={data.searchTrends} /></article><article className="analytics-card"><span className="section-kicker">POPULAR TAGS</span><h2>Context with pull</h2><div className="rank-list">{data.popularTags.map((tag, index) => <div className="rank-row" key={tag.label}><span className="rank-number">0{index + 1}</span><strong>{tag.label}</strong><span>{tag.value}</span></div>)}</div></article><article className="analytics-card"><span className="section-kicker">GEOGRAPHIC DEMAND</span><h2>Where the brief is</h2><div className="rank-list">{data.geographicDemand.map((place) => <div className="place-row" key={place.label}><div><strong>{place.label}</strong><small>{place.detail}</small></div><span className="demand-pill">{place.value}</span></div>)}</div></article></div><div className="opportunity-grid">{data.opportunities.map((item) => <article className={`opportunity-card ${item.tone}`} key={item.title}><span className="section-kicker">OPPORTUNITY</span><h3>{item.title}</h3><p>{item.detail}</p></article>)}</div><p className="privacy-note">Privacy note: Veld stores daily counters, coarse place labels, and approved asset context only. No IP address, device fingerprint, cookie, or raw search history is used for these signals.</p></section>;

  return <section className="analytics-page"><div className="workspace-intro"><span className="section-kicker">BUYER PERFORMANCE · {data.range}</span><h1>Know what your<br /><em>licence made possible.</em></h1><p>See campaign delivery and attributed results beside the exact assets your team licensed.</p></div><div className="metric-grid"><MetricCard label="Campaign spend" value={formatZar(data.summary.spendCents)} detail="licensed asset spend" /><MetricCard label="Licensed assets" value={data.summary.licensedAssets.toString()} detail="with campaign attribution" /><MetricCard label="Attributed ROI" value={`+${data.summary.roi}%`} detail="conversion value proxy" tone="green" /><MetricCard label="Conversions" value={data.summary.conversions.toLocaleString()} detail={`${data.summary.impressions.toLocaleString()} impressions`} /></div><div className="analytics-columns buyer-columns"><article className="analytics-card analytics-wide"><div className="card-heading"><div><span className="section-kicker">DELIVERY TREND</span><h2>Campaign impressions</h2></div><span className="status-pill cool">Licensed assets only</span></div><MetricBars points={data.performance} tone="green" /></article><article className="analytics-card"><span className="section-kicker">CAMPAIGNS</span><h2>Asset-level ROI</h2><div className="campaign-list">{data.campaigns.map((campaign) => <div className="campaign-row" key={campaign.id}><div><strong>{campaign.name}</strong><small>{campaign.assetTitle}</small></div><b>+{campaign.roi}%</b><span>{formatZar(campaign.spendCents)}</span></div>)}</div></article></div><div className="campaign-table">{data.campaigns.map((campaign) => <article className="campaign-detail" key={campaign.id}><div><span className="section-kicker">LICENSED ASSET</span><h3>{campaign.assetTitle}</h3><p>{campaign.name} · {campaign.status}</p></div><div><strong>{campaign.impressions.toLocaleString()}</strong><small>impressions</small></div><div><strong>{campaign.conversions.toLocaleString()}</strong><small>conversions</small></div><div><strong>+{campaign.roi}%</strong><small>attributed ROI</small></div></article>)}</div><p className="privacy-note">ROI is tied to licences in D1 and campaign events from your authenticated workspace. Conversion value is a configurable reporting assumption until your ad platform is connected.</p></section>;
}

function MetricCard({ label, value, detail, tone = "rust" }: { label: string; value: string; detail: string; tone?: "rust" | "green" }) { return <article className={`metric-card ${tone}`}><span className="section-kicker">{label}</span><strong>{value}</strong><small>{detail}</small></article>; }

type DashboardAction = { step: string; title: string; detail: string; view: View; anchor?: string };

function dashboardActions(role: string): DashboardAction[] {
  if (role === "contributor") return [
    { step: "01", title: "Complete your profile", detail: "Identity, base location, and portfolio so editors can verify you.", view: "contributor", anchor: "onboarding-profile" },
    { step: "02", title: "Sign terms & set payout", detail: "Firma signature reference plus a payout rail for the seller tender.", view: "contributor", anchor: "onboarding-seller" },
    { step: "03", title: "Submit your first record", detail: "Media, place evidence, rights status, and a pricing model.", view: "contributor", anchor: "onboarding-asset" },
  ];
  if (role === "buyer") return [
    { step: "01", title: "Search the verified archive", detail: "Brief-led search with visible match evidence and rights status.", view: "search" },
    { step: "02", title: "Track licensed campaign ROI", detail: "Spend, impressions, and attributed conversions per licensed asset.", view: "buyer" },
    { step: "03", title: "Raise a rights question", detail: "Open a resolution case for usage, provenance, or takedown concerns.", view: "community" },
  ];
  return [
    { step: "01", title: "Clear the editorial review queue", detail: "Seller tenders and asset decisions waiting on an editor.", view: "review" },
    { step: "02", title: "Work the governance pipeline", detail: "Ingestion, AI tagging, curator correction, and approval stages.", view: "governance" },
    { step: "03", title: "Inspect the admin ledger", detail: "Every user-account and image approval sign-off with proof state.", view: "ledger" },
    { step: "04", title: "Check community resolution cases", detail: "Rights and provenance cases that may need moderator input.", view: "community" },
  ];
}

function DashboardHome({ sessionUser, api, navigate }: { sessionUser: SessionUser; api: (path: string, init?: RequestInit) => Promise<Response>; navigate: (view: View) => void }) {
  const [metrics, setMetrics] = useState<{ label: string; value: string; detail: string; tone?: "rust" | "green" }[]>([]);
  const [metricsState, setMetricsState] = useState<"loading" | "ready" | "unavailable">("loading");
  const isContributor = sessionUser.role === "contributor";
  const isBuyer = sessionUser.role === "buyer";

  useEffect(() => {
    let active = true;
    setMetricsState("loading");
    const load = async () => {
      if (isContributor) {
        const response = await api("/api/analytics/contributor");
        const data = await readJson<ContributorAnalytics>(response, "Analytics unavailable");
        return [
          { label: "Archive searches", value: data.summary.searches.toLocaleString(), detail: "for your context and tags" },
          { label: "Asset views", value: data.summary.views.toLocaleString(), detail: "on your published work" },
          { label: "Demand change", value: `+${data.summary.demandChange}%`, detail: "compared with prior period", tone: "green" as const },
          { label: "Saved to briefs", value: data.summary.saves.toLocaleString(), detail: "lightbox saves" },
        ];
      }
      if (isBuyer) {
        const response = await api("/api/analytics/buyer");
        const data = await readJson<BuyerAnalytics>(response, "Analytics unavailable");
        return [
          { label: "Campaign spend", value: formatZar(data.summary.spendCents), detail: "licensed asset spend" },
          { label: "Licensed assets", value: data.summary.licensedAssets.toString(), detail: "with campaign attribution" },
          { label: "Attributed ROI", value: `+${data.summary.roi}%`, detail: "conversion value proxy", tone: "green" as const },
          { label: "Conversions", value: data.summary.conversions.toLocaleString(), detail: `${data.summary.impressions.toLocaleString()} impressions` },
        ];
      }
      const [reviewResponse, governanceResponse] = await Promise.all([api("/api/admin/review"), api("/api/governance/assets?stage=all")]);
      const review = await readJson<{ results: Asset[] }>(reviewResponse, "Review queue unavailable");
      const governance = await readJson<{ results: Asset[] }>(governanceResponse, "Governance queue unavailable");
      const attention = governance.results.filter((item) => item.workflowStage !== "approval").length;
      return [
        { label: "Pending editorial review", value: review.results.length.toString(), detail: "assets awaiting a decision", tone: review.results.length ? "rust" as const : "green" as const },
        { label: "Governance attention", value: attention.toString(), detail: "records before the approval stage", tone: attention ? "rust" as const : "green" as const },
        { label: "Pipeline records", value: governance.results.length.toString(), detail: "across all workflow stages" },
      ];
    };
    load().then((rows) => { if (active) { setMetrics(rows); setMetricsState("ready"); } }).catch(() => { if (active) { setMetrics([]); setMetricsState("unavailable"); } });
    return () => { active = false; };
  }, [api, isContributor, isBuyer]);

  const actions = dashboardActions(sessionUser.role);
  const firstName = sessionUser.displayName.split(" ")[0] ?? sessionUser.displayName;
  const today = new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const subtitle = isContributor
    ? "Your seller onboarding, demand signals, and publication pipeline in one place."
    : isBuyer
      ? "Licensed campaigns, attributed performance, and the next brief to search."
      : "Editorial review, metadata governance, and community resolution at a glance.";

  function runAction(action: DashboardAction) {
    navigate(action.view);
    if (action.anchor) window.setTimeout(() => document.getElementById(action.anchor as string)?.scrollIntoView({ behavior: "smooth", block: "start" }), 140);
  }

  return <main className="dashboard-page">
    <div className="dashboard-heading">
      <div><span className="section-kicker">DASHBOARD · {sessionUser.organizationName}</span><h1>Welcome back, <em>{firstName}.</em></h1><p>{subtitle}</p></div>
      <div className="dashboard-date"><strong>{today}</strong><span>{sessionUser.role} workspace</span></div>
    </div>
    {metricsState === "unavailable"
      ? <div className="empty-state" role="status">Live workspace metrics are unavailable. The service may be offline — the actions below still route to each workspace, and no placeholder figures are shown.</div>
      : <div className="metric-grid dashboard-metrics" aria-busy={metricsState === "loading"}>{metricsState === "loading" ? <div className="empty-state" role="status">Loading workspace metrics…</div> : metrics.map((metric) => <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone} />)}</div>}
    <section className="dashboard-actions" aria-label="Next actions">
      <div className="card-heading"><div><span className="section-kicker">NEXT ACTIONS</span><h2>What to do <em>next.</em></h2></div><span className="status-pill cool">{sessionUser.role}</span></div>
      <div className="action-grid">{actions.map((action) => <button key={action.title} type="button" className="action-card" onClick={() => runAction(action)}><span className="action-step">{action.step}</span><strong>{action.title}</strong><small>{action.detail}</small><span className="action-go">Open →</span></button>)}</div>
    </section>
  </main>;
}

function AdminLedgerWorkspace({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [category, setCategory] = useState<"all" | "user_account" | "image">("all");
  const [entries, setEntries] = useState<ApprovalLedgerEntry[]>([]);
  const [summary, setSummary] = useState({ total: 0, userAccount: 0, image: 0, signedAudit: 0, legacyWorkflow: 0, verifiedIntegrity: 0, failedIntegrity: 0 });
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ApprovalLedgerEntry[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [connectors, setConnectors] = useState<AuditAnalyticsConnectors | null>(null);

  useEffect(() => {
    let active = true;
    setState("loading");
    api(`/api/admin/approval-ledger?category=${category}&limit=250`)
      .then((response) => readJson<{ summary: typeof summary; results: ApprovalLedgerEntry[]; analytics?: AuditAnalyticsConnectors }>(response, "Approval ledger unavailable"))
      .then((data) => {
        if (!active) return;
        setSummary(data.summary);
        setEntries(data.results);
        if (data.analytics) setConnectors(data.analytics);
        setState("ready");
      })
      .catch(() => {
        if (!active) return;
        setEntries([]);
        setState("unavailable");
        onNotice("The admin approval ledger is unavailable. No local approval records were shown.");
      });
    return () => { active = false; };
  }, [api, category, onNotice]);

  const runAuditSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    setSearchState("loading");
    try {
      const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}&limit=100` : "?limit=100";
      const data = await readJson<{ results: ApprovalLedgerEntry[]; connectors: AuditAnalyticsConnectors }>(await api(`/api/admin/analytics/audit-search${query}`), "Audit search unavailable");
      setSearchResults(data.results);
      setConnectors(data.connectors);
      setSearchState("ready");
    } catch {
      setSearchResults([]);
      setSearchState("unavailable");
      onNotice("The cross-system audit search is unavailable. The live D1 ledger remains available below.");
    }
  };

  const filters = [
    { value: "all" as const, label: "All events", count: summary.total },
    { value: "user_account" as const, label: "User accounts", count: summary.userAccount },
    { value: "image" as const, label: "Images", count: summary.image },
  ];

  return <main className="ledger-page">
    <div className="ledger-heading">
      <div><span className="section-kicker">TOP ADMIN / APPROVAL LEDGER</span><h1>Every sign-off in <em>one record.</em></h1><p>User-account approvals, seller signatures, verification updates, and image decisions are listed with actor, subject, resource, and proof state.</p></div>
      <div className="ledger-proof"><strong>{summary.verifiedIntegrity}</strong><span>verified signed audit events</span></div>
    </div>

    <div className="ledger-stats" aria-busy={state === "loading"}>
      <MetricCard label="User account events" value={summary.userAccount.toString()} detail="seller signatures, KYC, tender decisions" tone={summary.userAccount ? "rust" : "green"} />
      <MetricCard label="Image events" value={summary.image.toString()} detail="metadata sign-offs and approvals" tone={summary.image ? "rust" : "green"} />
      <MetricCard label="Signed audit" value={summary.signedAudit.toString()} detail="hash-chain and Ed25519 proof" tone={summary.failedIntegrity ? "rust" : "green"} />
      <MetricCard label="Legacy workflow" value={summary.legacyWorkflow.toString()} detail="visible but not signed" />
    </div>

    <div className="ledger-toolbar">
      <div className="filter-tabs" role="tablist" aria-label="Approval ledger category">{filters.map((item) => <button key={item.value} type="button" role="tab" aria-selected={category === item.value} className={category === item.value ? "active" : ""} onClick={() => setCategory(item.value)}>{item.label} <span>{item.count}</span></button>)}</div>
      <span className={`ledger-integrity ${summary.failedIntegrity ? "failed" : "verified"}`}>{summary.failedIntegrity ? `${summary.failedIntegrity} integrity issue${summary.failedIntegrity === 1 ? "" : "s"}` : "Signed records verified"}</span>
    </div>

    <section className="ledger-search-panel" aria-labelledby="ledger-search-title">
      <div className="ledger-search-heading"><div><span className="section-kicker">OWNER / CEO SEARCH</span><h2 id="ledger-search-title">Search across the <em>audit system.</em></h2><p>Searches live D1 audit records and, when configured, the redacted R2 Data Catalog copy. Catalog rows are analytics copies, not replacement proof.</p></div></div>
      <form className="ledger-search-form" onSubmit={runAuditSearch}>
        <label htmlFor="ledger-audit-search">Search action, asset, actor, resource, or redacted event context</label>
        <div><input id="ledger-audit-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} autoComplete="off" /><button type="submit" disabled={searchState === "loading"}>{searchState === "loading" ? "Searching..." : "Search system"}</button></div>
      </form>
      <div className="ledger-connectors" aria-label="Audit connector status">
        <span>D1 live <strong>connected</strong></span>
        <span>Pipeline <strong>{connectors?.pipeline ?? "not_configured"}</strong></span>
        <span>R2 Data Catalog <strong>{connectors?.r2DataCatalog ?? "not_configured"}</strong></span>
        <span>R2 SQL search <strong>{connectors?.catalogSearch === "unavailable" ? "unavailable" : connectors?.r2Sql ?? "not_configured"}</strong></span>
        {connectors?.table && <span>Table <strong>{connectors.table}</strong></span>}
      </div>
      {searchState === "unavailable" && <div className="empty-state" role="alert">Cross-system search could not be completed. Retry after checking the Worker connector configuration.</div>}
      {searchState === "ready" && !searchResults.length && <div className="empty-state">No audit records matched that search.</div>}
      {searchState === "ready" && searchResults.length > 0 && <div className="ledger-search-results" aria-live="polite"><span className="section-kicker">{searchResults.length} MATCHES</span>{searchResults.map((entry) => <LedgerRow key={`search:${entry.source}:${entry.id}`} entry={entry} />)}</div>}
    </section>

    <section className="ledger-list" aria-live="polite">
      {state === "loading" && <div className="empty-state" role="status">Loading approval ledger...</div>}
      {state === "unavailable" && <div className="empty-state">Approval records could not be loaded. Check the Worker API, D1 migrations, and admin session.</div>}
      {state === "ready" && !entries.length && <div className="empty-state">No approval or sign-off events matched this filter.</div>}
      {state === "ready" && entries.map((entry) => <LedgerRow key={`${entry.source}:${entry.id}`} entry={entry} />)}
    </section>
  </main>;
}

function LedgerRow({ entry }: { entry: ApprovalLedgerEntry }) {
  const date = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.occurredAt));
  const proof = entry.integrity.status === "verified" ? "Signed proof verified" : entry.integrity.status === "failed" ? "Integrity check failed" : entry.integrity.status === "catalog" ? "R2 catalog analytics copy" : "Legacy workflow record";
  return <article className={`ledger-row ${entry.category} ${entry.integrity.status}`}>
    <div className="ledger-row-mark" aria-hidden="true">{entry.category === "image" ? "IMG" : "USR"}</div>
    <div className="ledger-row-main">
      <div className="ledger-row-top"><span className="section-kicker">{date}</span><span className={`ledger-proof-pill ${entry.integrity.status}`}>{proof}</span></div>
      <h2>{entry.action}</h2>
      <p><strong>{entry.actor.name}</strong> ({entry.actor.role}) recorded <strong>{entry.decision.replaceAll("_", " ")}</strong> for {entry.subject.type} <strong>{entry.subject.name}</strong>.</p>
      <div className="ledger-meta"><span>{entry.resource.type}: {entry.resource.title}</span>{entry.sequence && <span>Stream {entry.streamId} / #{entry.sequence}</span>}{entry.integrity.hash && <span>Hash {entry.integrity.hash.slice(0, 12)}...</span>}</div>
      {entry.notes && <p className="ledger-notes">{entry.notes}</p>}
    </div>
  </article>;
}

type OnboardingStepKey = "profile" | "seller" | "asset";

const ONBOARDING_STEPS: { key: OnboardingStepKey; step: string; title: string; detail: string; anchor: string }[] = [
  { key: "profile", step: "01", title: "Contributor profile", detail: "Identity, base location, and portfolio for verification.", anchor: "onboarding-profile" },
  { key: "seller", step: "02", title: "Terms & payout", detail: "Sign the contributor terms and link a payout rail.", anchor: "onboarding-seller" },
  { key: "asset", step: "03", title: "First record", detail: "Submit media with place, rights, and pricing context.", anchor: "onboarding-asset" },
];

function StepIcon({ stepKey }: { stepKey: OnboardingStepKey }) {
  if (stepKey === "profile") return <svg viewBox="0 0 32 32" focusable="false"><rect x="4" y="6" width="24" height="20" rx="2" /><circle cx="12" cy="14" r="3" /><path d="M7.5 23c1-3 4.5-3 4.5-3s3.5 0 4.5 3" /><path d="M19 12h6M19 16h6M19 20h4" /></svg>;
  if (stepKey === "seller") return <svg viewBox="0 0 32 32" focusable="false"><path d="M6 24 20 10l2 2L8 26H6z" /><path d="M18 12l2-2 2 2-2 2z" /><path d="M5 28h22" /></svg>;
  return <svg viewBox="0 0 32 32" focusable="false"><rect x="4" y="7" width="24" height="18" rx="2" /><circle cx="11" cy="13" r="2.4" /><path d="M4 22l7-6 5 4 5-5 7 6" /><path d="M16 3v4" /></svg>;
}

function OnboardingStepper({ completed }: { completed: Partial<Record<OnboardingStepKey, boolean>> }) {
  const firstOpen = ONBOARDING_STEPS.find((step) => !completed[step.key])?.key;
  const doneCount = ONBOARDING_STEPS.filter((step) => completed[step.key]).length;
  return <section className="onboarding-stepper" aria-label="Contributor onboarding progress">
    <div className="card-heading"><div><span className="section-kicker">SELLER ONBOARDING</span><h2>Three steps to <em>selling.</em></h2></div><span className="status-pill cool">{doneCount} of {ONBOARDING_STEPS.length} complete</span></div>
    <ol className="step-track">{ONBOARDING_STEPS.map((step) => {
      const state = completed[step.key] ? "done" : step.key === firstOpen ? "current" : "todo";
      const stateLabel = state === "done" ? "Complete" : state === "current" ? "Up next" : "Pending";
      return <li key={step.key}><button type="button" className={`step-item ${state}`} aria-label={`Step ${step.step}: ${step.title} — ${stateLabel}`} onClick={() => document.getElementById(step.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" })}><span className="step-visual" aria-hidden="true"><StepIcon stepKey={step.key} /></span><span className="step-copy"><small>{step.step} · {stateLabel}</small><strong>{step.title}</strong><span>{step.detail}</span></span><span className="step-state" aria-hidden="true">{state === "done" ? "✓" : "→"}</span></button></li>;
    })}</ol>
  </section>;
}

function BuyerActionsPanel({ navigate, onNotice }: { navigate: (view: View) => void; onNotice: (notice: string) => void }) {
  return <section className="buyer-actions" aria-label="Buyer licence workflow">
    <div className="card-heading"><div><span className="section-kicker">LICENCE WORKFLOW</span><h2>From brief to <em>licensed asset.</em></h2></div><span className="status-pill cool">Rights checked before checkout</span></div>
    <div className="action-grid">
      <button type="button" className="action-card" onClick={() => navigate("search")}><span className="action-step">01</span><strong>Find and inspect assets</strong><small>Open any result to review provenance, releases, and match evidence before you commit.</small><span className="action-go">Search archive →</span></button>
      <button type="button" className="action-card" onClick={() => { navigate("search"); onNotice("Select an asset and choose Request access: licence rules are evaluated against its releases before any payment is created."); }}><span className="action-step">02</span><strong>Validate the licence</strong><small>Release and rights rules are evaluated server-side before any payment is created.</small><span className="action-go">How validation works →</span></button>
      <button type="button" className="action-card" onClick={() => navigate("community")}><span className="action-step">03</span><strong>Raise a rights question</strong><small>Open a resolution case for usage, provenance, or takedown concerns.</small><span className="action-go">Open resolution desk →</span></button>
    </div>
  </section>;
}

function BuyerActionsPanelNext({ navigate, onNotice }: { navigate: (view: View) => void; onNotice: (notice: string) => void }) {
  return <section className="buyer-actions" aria-label="Buyer licence workflow">
    <div className="card-heading"><div><span className="section-kicker">LICENCE WORKFLOW</span><h2>From brief to <em>licensed asset.</em></h2></div><span className="status-pill cool">Rights checked before checkout</span></div>
    <div className="action-grid">
      <button type="button" className="action-card" onClick={() => navigate("search")}><span className="action-step">01</span><strong>Find and inspect assets</strong><small>Open any result to review provenance, releases, and match evidence before you commit.</small><span className="action-go">Search archive -&gt;</span></button>
      <button type="button" className="action-card" onClick={() => { navigate("buyer"); onNotice("Choose an asset below to run the server-side licence checks before creating a request."); window.setTimeout(() => document.getElementById("buyer-licence-validation")?.scrollIntoView({ behavior: "smooth", block: "start" }), 140); }}><span className="action-step">02</span><strong>Validate the licence</strong><small>Release and rights rules are evaluated server-side before any payment is created.</small><span className="action-go">Open validation panel -&gt;</span></button>
      <button type="button" className="action-card" onClick={() => navigate("community")}><span className="action-step">03</span><strong>Raise a rights question</strong><small>Open a resolution case for usage, provenance, or takedown concerns.</small><span className="action-go">Open resolution desk -&gt;</span></button>
    </div>
  </section>;
}

type LicenceHistoryItem = { id: string; assetId: string; assetTitle: string; licenceType: string; territory: string; durationDays: number; priceCents: number; status: string; createdAt: string; previewUrl: string | null };
type BuyerPurchaseHistoryItem = { id: string; kind: string; title: string; status: string; amountCents: number; currency: string; createdAt: string; details: string; referenceId: string };
type BuyerCreditsAccount = { oneCreditCents: number; balanceCredits: number; transactions: { id: string; transaction_type: string; credits: number; amount_cents: number; reference_type: string | null; created_at: string }[]; pendingPurchases: { id: string; credits: number; amount_cents: number; status: string; created_at: string }[] };
type BuyerPlatformSubscription = { id: string; status: string; priceCents: number; currency: string; billingDay: number; startDate: string; nextChargeDate: string; lastPaymentAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string };

type HostedCheckoutResponse = { checkoutUrl?: string; checkoutForm?: { action: string; fields: Record<string, string> } };

function openHostedCheckout(data: HostedCheckoutResponse): void {
  if (data.checkoutForm) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = data.checkoutForm.action;
    form.style.display = "none";
    for (const [name, value] of Object.entries(data.checkoutForm.fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    return;
  }
  if (data.checkoutUrl) {
    window.location.assign(data.checkoutUrl);
    return;
  }
  throw new Error("Checkout session did not include a payment destination");
}

function formatPurchaseDate(value: string): string {
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(value));
}

function BuyerFinancePanel({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [purchases, setPurchases] = useState<BuyerPurchaseHistoryItem[]>([]);
  const [credits, setCredits] = useState<BuyerCreditsAccount | null>(null);
  const [subscription, setSubscription] = useState<BuyerPlatformSubscription | null>(null);
  const [startDate, setStartDate] = useState(today);
  const [billingDay, setBillingDay] = useState("1");
  const [creditQuantity, setCreditQuantity] = useState("1");
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [busy, setBusy] = useState<"subscription" | "credits" | "cancel" | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [purchaseResponse, creditResponse, subscriptionResponse] = await Promise.all([api("/api/my/purchases"), api("/api/my/credits"), api("/api/my/platform-subscription")]);
      const purchaseData = await readJson<{ results: BuyerPurchaseHistoryItem[] }>(purchaseResponse, "Purchase history unavailable");
      const creditData = await readJson<BuyerCreditsAccount>(creditResponse, "Credit account unavailable");
      const subscriptionData = await readJson<{ subscription: BuyerPlatformSubscription | null }>(subscriptionResponse, "Membership details unavailable");
      setPurchases(purchaseData.results);
      setCredits(creditData);
      setSubscription(subscriptionData.subscription);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function startMembership(event: React.FormEvent) {
    event.preventDefault();
    setBusy("subscription");
    try {
      const response = await api("/api/buyer/platform-subscription/checkout", { method: "POST", body: JSON.stringify({ startDate, billingDay: Number(billingDay), successUrl: `${window.location.origin}/?payment=success`, cancelUrl: `${window.location.origin}/?payment=cancelled` }) });
      const data = await readJson<HostedCheckoutResponse>(response, "Membership checkout unavailable");
      openHostedCheckout(data);
    } catch { onNotice("Membership checkout is unavailable. No recurring payment was created."); } finally { setBusy(null); }
  }

  async function buyCredits(event: React.FormEvent) {
    event.preventDefault();
    const quantity = Number(creditQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return;
    setBusy("credits");
    try {
      const response = await api("/api/buyer/credits/checkout", { method: "POST", body: JSON.stringify({ credits: quantity, successUrl: `${window.location.origin}/?payment=success`, cancelUrl: `${window.location.origin}/?payment=cancelled` }) });
      const data = await readJson<HostedCheckoutResponse>(response, "Credit checkout unavailable");
      openHostedCheckout(data);
    } catch { onNotice("Credit checkout is unavailable. Credits are added only after verified payment."); } finally { setBusy(null); }
  }

  async function cancelMembership() {
    setBusy("cancel");
    try { await readJson(await api("/api/my/platform-subscription/cancel", { method: "POST", body: "{}" }), "Membership cancellation unavailable"); onNotice("Your recurring membership has been cancelled."); await load(); }
    catch { onNotice("We could not cancel the membership. No change was made."); } finally { setBusy(null); }
  }

  return <section id="buyer-finance" className="buyer-finance" aria-labelledby="buyer-finance-title">
    <div className="card-heading"><div><span className="section-kicker">BUYER ACCOUNT / PAYMENTS</span><h2 id="buyer-finance-title">Your purchase history and <em>buying power.</em></h2></div><span className="status-pill cool">Live account data</span></div>
    {state === "loading" && <div className="empty-state" role="status">Loading your purchase history, membership, and credits...</div>}
    {state === "unavailable" && <div className="empty-state" role="alert">Buyer payment details are unavailable. No cached balances or purchase records are shown.</div>}
    {state === "ready" && <>
      <div className="metric-grid buyer-finance-metrics">
        <MetricCard label="Purchases recorded" value={purchases.length.toString()} detail="licences, credits, and membership" />
        <MetricCard label="Available credits" value={(credits?.balanceCredits ?? 0).toLocaleString()} detail="1 credit = R100" tone={credits?.balanceCredits ? "green" : undefined} />
        <MetricCard label="Membership" value={subscription?.status === "active" ? "Active" : subscription?.status ?? "Not started"} detail="R1,299 per month" tone={subscription?.status === "active" ? "green" : undefined} />
        <MetricCard label="Paid history" value={formatZar(purchases.filter((item) => item.status === "paid" || item.status === "payment_succeeded").reduce((sum, item) => sum + item.amountCents, 0))} detail="verified completed payments" />
      </div>
      <div className="buyer-finance-columns">
        <article className="buyer-finance-card">
          <div className="card-heading"><div><span className="section-kicker">MONTHLY MEMBERSHIP</span><h3>Keep access ready for the next brief.</h3></div><span className="status-pill warm">R1,299 / month</span></div>
          <p className="buyer-finance-copy">Choose the first charge date and the day of month for recurring charges. Your membership becomes active only after the payment provider confirms the payment.</p>
          {subscription?.status === "active" || subscription?.status === "pending" || subscription?.status === "past_due"
           ? <div className="buyer-finance-status"><strong>{subscription.status.replaceAll("_", " ")}</strong><span>Next charge: {subscription.nextChargeDate} - billing day {subscription.billingDay}</span><button type="button" className="text-button" disabled={busy !== null} onClick={() => void cancelMembership()}>{busy === "cancel" ? "Cancelling..." : "Cancel membership"}</button></div>
            : <form className="buyer-finance-form" onSubmit={startMembership}><label>Start date<input type="date" min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><label>Monthly billing day<select value={billingDay} onChange={(event) => setBillingDay(event.target.value)}>{Array.from({ length: 28 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}{day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th"} of each month</option>)}</select></label><button type="submit" className="dark-button" disabled={busy !== null}>{busy === "subscription" ? "Opening checkout..." : "Start membership"}</button></form>}
        </article>
        <article className="buyer-finance-card">
          <div className="card-heading"><div><span className="section-kicker">ARCHIVE CREDITS</span><h3>Buy credits for artist quotes.</h3></div><span className="status-pill cool">R100 / credit</span></div>
          <p className="buyer-finance-copy">Credits are held in your account after verified payment and can be used toward custom, tailor-made licences agreed with artists.</p>
          <form className="buyer-finance-form" onSubmit={buyCredits}><label>Credits to buy<input type="number" min="1" max="1000" step="1" value={creditQuantity} onChange={(event) => setCreditQuantity(event.target.value)} required /></label><div className="buyer-finance-total"><span>Total</span><strong>{formatZar((Number(creditQuantity) || 0) * 10000)}</strong></div><button type="submit" className="dark-button" disabled={busy !== null}>{busy === "credits" ? "Opening checkout..." : "Buy credits"}</button></form>
          <div className="buyer-finance-balance"><strong>{(credits?.balanceCredits ?? 0).toLocaleString()}</strong><span>credits available for future custom licences</span></div>
        </article>
      </div>
      <article className="buyer-finance-card buyer-purchase-history"><div className="card-heading"><div><span className="section-kicker">ALL PURCHASES</span><h3>Everything bought on this account.</h3></div><span className="status-pill cool">{purchases.length} record{purchases.length === 1 ? "" : "s"}</span></div>{purchases.length ? <div className="purchase-history-list">{purchases.map((purchase) => <div className="purchase-history-row" key={`${purchase.kind}:${purchase.id}`}><div><strong>{purchase.title}</strong><small>{purchase.details} · {formatPurchaseDate(purchase.createdAt)}</small></div><b className={`purchase-status ${purchase.status}`}>{purchase.status.replaceAll("_", " ")}</b><span>{formatZar(purchase.amountCents)}</span></div>)}</div> : <div className="empty-state">No purchases are recorded yet. Your completed licences, credits, and membership payments will appear here.</div>}</article>
    </>}
  </section>;
}

type ContributorRevenueStatement = {
  statement: {
    currency: string;
    generatedAt: string;
    customPricedLicences: {
      results: { id: string; assetId: string; assetTitle: string; kind: string; licenceType: string; territory: string; durationDays: number; purchaseCents: number; royaltyCents: number; platformFeeCents: number; refundedCents: number; status: string; buyerName: string; paidAt: string | null; createdAt: string }[];
      total: number;
      purchaseCents: number;
      royaltyCents: number;
      platformFeeCents: number;
      refundedCents: number;
    };
    mediaInventory: {
      total: number;
      results: { id: string; title: string; kind: string; status: string; monetizationModel: string; licensePriceCents: number | null }[];
      byTypeAndPackage: { kind: string; monetizationModel: string; total: number; published: number }[];
    };
    paymentFlow: {
      byStatus: { status: string; transactionCount: number; amountCents: number }[];
      packageMix: { licenceType: string; durationDays: number; territory: string; transactionCount: number; purchaseCents: number; royaltyCents: number; refundedCents: number }[];
      transactionCount: number;
    };
    performance: {
      range: string;
      summary: { views: number; downloads: number; subscriptionDownloads: number; licensedAssets: number; royaltyCents: number; roiStatus: string; roiExplanation: string };
      assets: { id: string; title: string; kind: string; views: number; downloads: number; subscriptionDownloads: number; licenceCount: number; royaltyCents: number; royaltyPerThousandViewsCents: number | null }[];
    };
    veldSubscriptionRoyalty: { status: "not_allocated"; amountCents: number; period: string | null; subscriptionPurchases: number; subscriptionGrossCents: number; explanation: string };
    payoutPosition: { postedRoyaltyCents: number; paidOutCents: number; inFlightCents: number; failedPayoutCents: number; outstandingCents: number; note: string };
    payoutPolicy: { cadence: "monthly"; method: "lump_sum"; payoutDayOfMonth: number; timeZone: string; nextScheduledPayoutDate: string; amountExpectedCents: number; status: string; explanation: string };
    privacy: { buyerIdentity: string; hidden: string[]; scope: string };
  };
};

function ContributorRevenuePanel({ api }: { api: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [data, setData] = useState<ContributorRevenueStatement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    setState("loading");
    api("/api/analytics/contributor/revenue")
      .then((response) => readJson<ContributorRevenueStatement>(response, "Revenue statement unavailable"))
      .then((next) => { if (active) { setData(next); setState("ready"); } })
      .catch(() => { if (active) { setData(null); setState("unavailable"); } });
    return () => { active = false; };
  }, [api]);

  if (state === "loading") return <section className="revenue-panel" aria-busy="true"><div className="empty-state" role="status">Loading your licence and royalty statement...</div></section>;
  if (!data) return <section className="revenue-panel"><div className="empty-state">Your revenue statement is unavailable. No cached or estimated figures are shown.</div></section>;
  const statement = data.statement;
  return <section className="revenue-panel" aria-labelledby="revenue-statement-title">
    <div className="revenue-heading"><div><span className="section-kicker">SELLER FINANCE / RIGHTS STATEMENT</span><h2 id="revenue-statement-title">Know who licensed your work — and what Veld <em>owes.</em></h2><p>This statement is limited to your media and your organisation. It separates custom-priced licence sales from any Veld subscription royalty allocation.</p></div><span className="status-pill cool">Authenticated seller view</span></div>
    <div className="revenue-summary"><MetricCard label="Custom licence royalties" value={formatZar(statement.customPricedLicences.royaltyCents)} detail="posted contributor royalty entries" tone="green" /><MetricCard label="Paid out" value={formatZar(statement.payoutPosition.paidOutCents)} detail="matched to approved payout batches" /><MetricCard label="Outstanding" value={formatZar(statement.payoutPosition.outstandingCents)} detail="not yet matched to a payout" tone={statement.payoutPosition.outstandingCents ? "rust" : "green"} /><MetricCard label="Subscription royalty" value={statement.veldSubscriptionRoyalty.status === "not_allocated" ? "Not allocated" : formatZar(statement.veldSubscriptionRoyalty.amountCents)} detail="Veld pool status" /></div>
    <div className="revenue-columns">
      <article className="revenue-card revenue-wide"><div className="card-heading"><div><span className="section-kicker">CUSTOM-PRICED LICENCES</span><h3>Who bought your media</h3></div><span className="status-pill cool">{statement.customPricedLicences.total} record{statement.customPricedLicences.total === 1 ? "" : "s"}</span></div><p className="revenue-explanation"><strong>Yes:</strong> you can see the buyer display name, asset, licence scope, purchase amount, and status for paid custom-priced media you own. Email addresses, payment details, provider references, and private checkout data are hidden.</p>{statement.customPricedLicences.results.length ? <div className="revenue-table-wrap"><table className="revenue-table"><caption className="sr-only">Custom-priced media licence buyers and royalties</caption><thead><tr><th>Buyer</th><th>Media / scope</th><th>Purchase</th><th>Your royalty</th><th>Status</th></tr></thead><tbody>{statement.customPricedLicences.results.map((licence) => <tr key={licence.id}><td><strong>{licence.buyerName}</strong><small>Display name only</small></td><td><strong>{licence.assetTitle}</strong><small>{licence.kind} · {licence.licenceType} · {licence.territory}</small></td><td>{formatZar(licence.purchaseCents)}</td><td>{formatZar(licence.royaltyCents)}</td><td><span className={`revenue-status ${licence.status}`}>{licence.status}</span></td></tr>)}</tbody></table></div> : <div className="empty-state">No paid custom-priced licences are recorded for your media yet.</div>}</article>
      <article className="revenue-card"><div className="card-heading"><div><span className="section-kicker">VELD SUBSCRIPTION ROYALTY</span><h3>Generic contribution status</h3></div><span className="status-pill warm">Not allocated</span></div><p className="revenue-explanation"><strong>Important:</strong> Veld currently records subscription access separately, but has not posted a generic royalty-pool allocation to this account. No subscription royalty amount is estimated or promised until Veld publishes the period, allocation basis, and ledger entry.</p><div className="revenue-facts"><span><strong>{statement.veldSubscriptionRoyalty.subscriptionPurchases}</strong> subscription purchase{statement.veldSubscriptionRoyalty.subscriptionPurchases === 1 ? "" : "s"} linked to your profile</span><span><strong>{formatZar(statement.veldSubscriptionRoyalty.subscriptionGrossCents)}</strong> subscription receipts recorded, not your royalty</span></div><p className="privacy-note">{statement.payoutPosition.note}</p></article>
    </div>
    <p className="privacy-note"><strong>Privacy and safety:</strong> {statement.privacy.scope} {statement.privacy.buyerIdentity} Hidden: {statement.privacy.hidden.join(", ")}.</p>
  </section>;
}

function ContributorFinanceBreakdownPanel({ api }: { api: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [data, setData] = useState<ContributorRevenueStatement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    api("/api/analytics/contributor/revenue")
      .then((response) => readJson<ContributorRevenueStatement>(response, "Finance statement unavailable"))
      .then((next) => { if (active) { setData(next); setState("ready"); } })
      .catch(() => { if (active) setState("unavailable"); });
    return () => { active = false; };
  }, [api]);

  if (state === "loading") return <section className="revenue-detail-panel" aria-busy="true"><div className="empty-state" role="status">Loading media, packages, and transaction totals...</div></section>;
  if (!data) return <section className="revenue-detail-panel"><div className="empty-state">The detailed finance breakdown is unavailable. The statement will not show cached or estimated totals.</div></section>;
  const statement = data.statement;
  return <section className="revenue-detail-panel" aria-labelledby="seller-finance-detail-title">
    <div className="revenue-heading"><div><span className="section-kicker">END-TO-END SELLER STATEMENT</span><h2 id="seller-finance-detail-title">Your listings, packages, and <em>money trail.</em></h2><p>Every number below is tied to your owned media, a recorded licence status, a posted ledger entry, or a payout batch. Subscription receipts are shown as context—not as your royalty.</p></div><span className="status-pill warm">Payout on the 25th</span></div>
    <div className="payout-policy-banner"><div><span className="section-kicker">NEXT LUMP-SUM PAYOUT</span><strong>{formatZar(statement.payoutPolicy.amountExpectedCents)}</strong><span>expected from posted, not-yet-paid royalties</span></div><div><strong>{statement.payoutPolicy.nextScheduledPayoutDate}</strong><span>{statement.payoutPolicy.timeZone} · {statement.payoutPolicy.status.replaceAll("_", " ")}</span></div><p>{statement.payoutPolicy.explanation}</p></div>
    <div className="revenue-columns">
      <article className="revenue-card"><div className="card-heading"><div><span className="section-kicker">MEDIA INVENTORY</span><h3>What you have listed</h3></div><span className="status-pill cool">{statement.mediaInventory.total} records</span></div><div className="statement-breakdown">{statement.mediaInventory.byTypeAndPackage.map((item) => <div key={`${item.kind}-${item.monetizationModel}`}><strong>{item.total}</strong><span>{item.kind} · {item.monetizationModel.replaceAll("_", " ")}</span><small>{item.published} published</small></div>)}</div><div className="revenue-table-wrap"><table className="revenue-table statement-table"><caption className="sr-only">Seller media inventory and payment packages</caption><thead><tr><th>Media</th><th>Type</th><th>Listing package</th><th>Price</th><th>Status</th></tr></thead><tbody>{statement.mediaInventory.results.map((item) => <tr key={item.id}><td><strong>{item.title}</strong></td><td>{item.kind}</td><td>{item.monetizationModel.replaceAll("_", " ")}</td><td>{item.licensePriceCents === null ? "Quote" : formatZar(item.licensePriceCents)}</td><td><span className="revenue-status">{item.status}</span></td></tr>)}</tbody></table></div></article>
      <article className="revenue-card"><div className="card-heading"><div><span className="section-kicker">PAYMENT FLOW</span><h3>Transaction status</h3></div><span className="status-pill cool">{statement.paymentFlow.transactionCount} licences</span></div><div className="statement-breakdown">{statement.paymentFlow.byStatus.map((item) => <div key={item.status}><strong>{formatZar(item.amountCents)}</strong><span>{item.status}</span><small>{item.transactionCount} record{item.transactionCount === 1 ? "" : "s"}</small></div>)}</div><p className="privacy-note">This flow excludes provider references and payment credentials. It includes pending, paid, refunded, expired, and cancelled licence records belonging to your media.</p></article>
    </div>
    <article className="revenue-card revenue-package-card"><div className="card-heading"><div><span className="section-kicker">LICENCE PACKAGES SOLD</span><h3>Package and transaction amounts</h3></div></div><div className="revenue-table-wrap"><table className="revenue-table"><caption className="sr-only">Licence packages and transaction amounts</caption><thead><tr><th>Package</th><th>Duration / territory</th><th>Transactions</th><th>Purchase total</th><th>Your royalty</th><th>Refunded</th></tr></thead><tbody>{statement.paymentFlow.packageMix.length ? statement.paymentFlow.packageMix.map((item) => <tr key={`${item.licenceType}-${item.durationDays}-${item.territory}`}><td><strong>{item.licenceType}</strong></td><td>{item.durationDays} days · {item.territory}</td><td>{item.transactionCount}</td><td>{formatZar(item.purchaseCents)}</td><td>{formatZar(item.royaltyCents)}</td><td>{formatZar(item.refundedCents)}</td></tr>) : <tr><td colSpan={6}>No paid or refunded licence transactions are recorded yet.</td></tr>}</tbody></table></div></article>
  </section>;
}

function ContributorStatementTools({ api }: { api: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [data, setData] = useState<ContributorRevenueStatement | null>(null);
  const [busy, setBusy] = useState<"csv" | "pdf" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/analytics/contributor/revenue")
      .then((response) => readJson<ContributorRevenueStatement>(response, "Performance statement unavailable"))
      .then(setData)
      .catch(() => setError("Performance data is unavailable; exports remain disabled until the statement can be verified."));
  }, [api]);

  async function download(format: "csv" | "pdf") {
    setBusy(format); setError("");
    try {
      const response = await api(`/api/analytics/contributor/revenue.${format}`);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `veld-seller-statement-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch { setError(`The ${format.toUpperCase()} statement could not be generated. No partial file was downloaded.`); }
    finally { setBusy(null); }
  }

  if (!data) return <section className="revenue-tools-panel"><div className="empty-state">{error || "Loading export and performance tools..."}</div></section>;
  const statement = data.statement;
  const points = statement.performance.assets.filter((item) => item.views > 0).sort((a, b) => b.views - a.views).slice(0, 8).map((item) => ({ label: item.title.slice(0, 18), value: item.views }));
  return <section className="revenue-tools-panel" aria-labelledby="seller-statement-tools-title">
    <div className="revenue-heading"><div><span className="section-kicker">STATEMENT TOOLS / PERFORMANCE</span><h2 id="seller-statement-tools-title">Download the record. Read the <em>signal.</em></h2><p>PDF is a presentation-ready finance statement. CSV is the audit-friendly detail export. Both use the same authenticated, owner-scoped statement.</p></div><div className="statement-export-actions"><button type="button" className="outline-button" disabled={busy !== null} onClick={() => void download("pdf")}>{busy === "pdf" ? "Preparing PDF…" : "Download PDF"}</button><button type="button" className="dark-button" disabled={busy !== null} onClick={() => void download("csv")}>{busy === "csv" ? "Preparing CSV…" : "Download CSV"}</button></div></div>
    {error && <p className="upload-error" role="alert">{error}</p>}
    <div className="analytics-columns seller-performance-columns"><article className="analytics-card analytics-wide"><div className="card-heading"><div><span className="section-kicker">ROYALTY YIELD / {statement.performance.range}</span><h3>Where attention becomes value</h3></div><span className="status-pill cool">Proxy, not ROI</span></div><MetricBars points={points} tone="rust" /><p className="privacy-note">{statement.performance.summary.roiExplanation}</p></article><article className="analytics-card"><span className="section-kicker">PERFORMANCE TOTALS</span><h3>{statement.performance.summary.views.toLocaleString()} views</h3><p>{statement.performance.summary.downloads.toLocaleString()} downloads · {statement.performance.summary.subscriptionDownloads.toLocaleString()} subscription downloads · {statement.performance.summary.licensedAssets} assets with licence activity.</p><p>A true ROI percentage is unavailable because seller costs are not recorded.</p><div className="seller-performance-list">{statement.performance.assets.filter((item) => item.views > 0 || item.licenceCount > 0 || item.downloads > 0).slice(0, 6).map((item) => <div key={item.id}><strong>{item.title}</strong><span>{item.views.toLocaleString()} views · {item.downloads.toLocaleString()} downloads · {item.licenceCount} licences · {formatZar(item.royaltyCents)}</span></div>)}</div></article></div>
  </section>;
}

type CheckoutValidationResponse = ReturnType<typeof archiveDomain.evaluateLicenceRequest> & {
  assetId: string;
  priceCents: number | null;
  currency: string;
  monetizationModel: MonetizationModel;
};

function BuyerLicenceValidationPanel({ assets, api, navigate, onNotice, onRefresh }: { assets: Asset[]; api: (path: string, init?: RequestInit) => Promise<Response>; navigate: (view: View) => void; onNotice: (notice: string) => void; onRefresh: () => Promise<void> }) {
  const availableAssets = useMemo(() => assets.filter((asset) => asset.status === "published" && asset.workflowStage === "approval"), [assets]);
  const [selectedAssetId, setSelectedAssetId] = useState(availableAssets[0]?.id ?? "");
  const [licenceType, setLicenceType] = useState<LicenceType>("commercial");
  const [territory, setTerritory] = useState("Worldwide");
  const [durationDays, setDurationDays] = useState("365");
  const [validation, setValidation] = useState<CheckoutValidationResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!availableAssets.some((asset) => asset.id === selectedAssetId)) setSelectedAssetId(availableAssets[0]?.id ?? "");
  }, [availableAssets, selectedAssetId]);

  useEffect(() => {
    setValidation(null);
    setState("idle");
    setErrorMessage("");
  }, [selectedAssetId, licenceType, territory, durationDays]);

  const selectedAsset = availableAssets.find((asset) => asset.id === selectedAssetId) ?? null;
  const duration = Number(durationDays);

  async function validate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAssetId || !territory.trim() || !Number.isInteger(duration) || duration < 1 || duration > 3650) return;
    setState("loading");
    setErrorMessage("");
    try {
      const response = await api("/api/checkout/validate", { method: "POST", body: JSON.stringify({ assetId: selectedAssetId, licenceType, territory: territory.trim(), durationDays: duration }) });
      const data = await readJson<CheckoutValidationResponse>(response, "Licence validation unavailable");
      setValidation(data);
      setState("ready");
    } catch {
      setValidation(null);
      setState("error");
      setErrorMessage("The server could not validate this request. Check the Worker connection and try again; no licence or payment was created.");
    }
  }

  async function createLicenceRequest() {
    if (!validation?.allowed || !selectedAssetId || !Number.isInteger(duration)) return;
    if (validation.monetizationModel === "custom_quote") {
      onNotice("This asset requires a custom quote. Open the resolution desk to start a rights and pricing conversation.");
      navigate("community");
      return;
    }
    setCreating(true);
    try {
      const response = await api("/api/checkout", { method: "POST", body: JSON.stringify({ assetId: selectedAssetId, licenceType, territory: territory.trim(), durationDays: duration }) });
      const data = await readJson<{ licenceId: string; priceCents: number; currency: string }>(response, "Licence request unavailable");
      onNotice(`Licence request created for ${formatZar(data.priceCents)}. Payment is not charged until a payment session is configured.`);
      await onRefresh();
    } catch {
      setErrorMessage("The licence request could not be created. Your validation is still available to retry.");
    } finally {
      setCreating(false);
    }
  }

  return <section className="licence-validation-panel" id="buyer-licence-validation" aria-labelledby="licence-validation-title">
    <div className="card-heading"><div><span className="section-kicker">SERVER-SIDE LICENCE CHECK</span><h2 id="licence-validation-title">Validate before you <em>commit.</em></h2></div><span className="status-pill cool">No payment yet</span></div>
    <p className="licence-validation-intro">Select a published asset and intended use. The Worker checks approval, rights scope, and the release evidence required for that licence type before creating anything.</p>
    {!availableAssets.length
      ? <div className="empty-state">No published assets are available to validate yet. Search the archive for approved records, then return here.<br /><button type="button" className="outline-button" onClick={() => navigate("search")}>Search approved assets</button></div>
      : <>
        <form className="licence-validation-form" onSubmit={validate}>
          <label>Asset to validate<select value={selectedAssetId} onChange={(event) => setSelectedAssetId(event.target.value)}>{availableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title} - {asset.city ?? asset.country ?? "Location pending"}</option>)}</select></label>
          <label>Licence type<select value={licenceType} onChange={(event) => setLicenceType(event.target.value as LicenceType)}>{(["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"] as LicenceType[]).map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
          <label>Territory<input required maxLength={80} value={territory} onChange={(event) => setTerritory(event.target.value)} /></label>
          <label>Duration<select value={durationDays} onChange={(event) => setDurationDays(event.target.value)}><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="730">2 years</option><option value="1095">3 years</option></select></label>
          <button type="submit" className="dark-button" disabled={state === "loading" || !territory.trim()}>{state === "loading" ? "Checking rights..." : "Run licence check"} <span>-&gt;</span></button>
        </form>
        {selectedAsset && <div className="licence-selection-evidence" role="note"><div><strong>{selectedAsset.title}</strong><span>{selectedAsset.city ?? selectedAsset.country ?? "Location evidence pending"} - {selectedAsset.kind === "video" ? "Film & video" : "Photography"}</span></div><div><span>Rights</span><strong>{rightsLabel(selectedAsset.rightsStatus)}</strong></div><div><span>Releases</span><strong>{releaseLabel(selectedAsset.modelReleaseStatus)} / {releaseLabel(selectedAsset.propertyReleaseStatus)}</strong></div></div>}
        {state === "error" && <div className="validation-error" role="alert">{errorMessage}</div>}
        {state === "ready" && validation && <div className={`validation-result ${validation.allowed ? "allowed" : "blocked"}`} role="status" aria-live="polite">
          <div className="validation-result-heading"><div><span className="section-kicker">VALIDATION RESULT</span><h3>{validation.allowed ? "Ready for a licence request." : "This request is blocked."}</h3></div><strong>{validation.allowed ? (validation.priceCents === null ? "Custom quote" : formatZar(validation.priceCents)) : `${validation.blockingReasons.length} issue${validation.blockingReasons.length === 1 ? "" : "s"}`}</strong></div>
          <p>{validation.allowed ? "The selected use passed the current approval, rights, and release checks. Creating a request does not charge payment." : "Resolve the failed checks or choose a narrower use before creating a request."}</p>
          <div className="validation-checks">{validation.checks.map((check) => <div key={check.label}><span className={check.passed ? "check-pass" : "check-fail"}>{check.passed ? "OK" : "!"}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>
          {validation.allowed && <button type="button" className="approve-button" disabled={creating} onClick={() => void createLicenceRequest()}>{creating ? "Creating request..." : validation.monetizationModel === "custom_quote" ? "Open custom-quote desk" : "Create licence request"} -&gt;</button>}
        </div>}
      </>}
  </section>;
}

function BuyerWorkspace({ assets, api, navigate, onNotice }: { assets: Asset[]; api: (path: string, init?: RequestInit) => Promise<Response>; navigate: (view: View) => void; onNotice: (notice: string) => void }) {
  const [licences, setLicences] = useState<LicenceHistoryItem[]>([]);
  const [lightboxes, setLightboxes] = useState<BuyerLightbox[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [newLightboxTitle, setNewLightboxTitle] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  const load = useCallback(async () => {
    try {
      const [licenceResponse, lightboxResponse, savedSearchResponse] = await Promise.all([api("/api/my/licences"), api("/api/lightboxes"), api("/api/saved-searches")]);
      const licenceData = await readJson<{ results: LicenceHistoryItem[] }>(licenceResponse, "Licence history unavailable");
      const lightboxData = await readJson<{ results: BuyerLightbox[] }>(lightboxResponse, "Lightboxes unavailable");
      const savedSearchData = await readJson<{ results: SavedSearch[] }>(savedSearchResponse, "Saved searches unavailable");
      setLicences(licenceData.results);
      setLightboxes(lightboxData.results);
      setSavedSearches(savedSearchData.results);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function createLightbox(event: React.FormEvent) {
    event.preventDefault();
    if (!newLightboxTitle.trim()) return;
    try {
      const response = await api("/api/lightboxes", { method: "POST", body: JSON.stringify({ title: newLightboxTitle.trim() }) });
      if (!response.ok) throw new Error();
      setNewLightboxTitle("");
      onNotice("Lightbox created.");
      await load();
    } catch { onNotice("Could not create the lightbox."); }
  }

  async function removeSavedSearch(id: string) {
    try { await api(`/api/saved-searches/${id}`, { method: "DELETE" }); setSavedSearches((current) => current.filter((item) => item.id !== id)); }
    catch { onNotice("Could not remove the saved search."); }
  }

  return <>
    <BuyerFinancePanel api={api} onNotice={onNotice} />
    <BuyerActionsPanelNext navigate={navigate} onNotice={onNotice} />
    <BuyerLicenceValidationPanel assets={assets} api={api} navigate={navigate} onNotice={onNotice} onRefresh={load} />
    <section className="buyer-collections" aria-label="Licences, lightboxes, and saved searches">
      <div className="card-heading"><div><span className="section-kicker">LICENCE HISTORY</span><h2>What you have <em>licensed.</em></h2></div></div>
      {state === "unavailable" && <div className="empty-state">Licence history is unavailable right now.</div>}
      {state !== "unavailable" && (licences.length ? <div className="campaign-list">{licences.map((licence) => <div className="campaign-row" key={licence.id}><div><strong>{licence.assetTitle}</strong><small>{licence.licenceType} · {licence.territory}</small></div><b>{licence.status}</b><span>{formatZar(licence.priceCents)}</span></div>)}</div> : <div className="empty-state">No licences yet. Search the archive to license your first asset.</div>)}

      <div className="card-heading"><div><span className="section-kicker">LIGHTBOXES</span><h2>Shortlist assets for a <em>brief.</em></h2></div></div>
      <form className="inline-form" onSubmit={createLightbox}><input value={newLightboxTitle} onChange={(event) => setNewLightboxTitle(event.target.value)} placeholder="New lightbox title" aria-label="New lightbox title" /><button type="submit" className="outline-button">Create</button></form>
      {state !== "unavailable" && (lightboxes.length ? <div className="rank-list">{lightboxes.map((lightbox) => <div className="rank-row" key={lightbox.id}><strong>{lightbox.title}</strong><span>{lightbox.assetCount} asset{lightbox.assetCount === 1 ? "" : "s"}</span></div>)}</div> : <div className="empty-state">No lightboxes yet. Save assets from search results to start one.</div>)}

      <div className="card-heading"><div><span className="section-kicker">SAVED SEARCHES</span><h2>Get alerted on <em>new matches.</em></h2></div></div>
      {state !== "unavailable" && (savedSearches.length ? <div className="rank-list">{savedSearches.map((search) => <div className="rank-row" key={search.id}><strong>{search.label}</strong><span>{search.notifyOnNew ? "Alerts on" : "Alerts off"}</span><button type="button" className="text-button" onClick={() => void removeSavedSearch(search.id)}>Remove</button></div>)}</div> : <div className="empty-state">Save a search from the search results page to get notified about new matches.</div>)}
    </section>
  </>;
}

function PayoutBatchAdmin({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [batches, setBatches] = useState<PayoutBatchSummary[]>([]);
  const [selected, setSelected] = useState<(PayoutBatchSummary & { items: PayoutBatchItem[] }) | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [creating, setCreating] = useState(false);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);

  const load = useCallback(async () => {
    try { const response = await api("/api/admin/payout-batches"); const data = await readJson<{ results: PayoutBatchSummary[] }>(response, "Payout batches unavailable"); setBatches(data.results); }
    catch { onNotice("Payout batches are unavailable right now."); }
  }, [api, onNotice]);

  useEffect(() => { void load(); }, [load]);

  async function createBatch(event: React.FormEvent) {
    event.preventDefault();
    if (!periodStart || !periodEnd) return;
    setCreating(true);
    try {
      const response = await api("/api/admin/payout-batches", { method: "POST", body: JSON.stringify({ periodStart, periodEnd, currency: "ZAR" }) });
      if (!response.ok) throw new Error();
      onNotice("Payout batch created as a draft. Review the contributors and approve it before any payout provider is called.");
      await load();
    } catch { onNotice("Could not create the payout batch."); } finally { setCreating(false); }
  }

  async function viewBatch(id: string) {
    try { const response = await api(`/api/admin/payout-batches/${id}`); const data = await readJson<PayoutBatchSummary & { items: PayoutBatchItem[] }>(response, "Batch detail unavailable"); setSelected(data); }
    catch { onNotice("Could not load payout batch detail."); }
  }

  async function decideBatch(nextDecision: "approve" | "reject") {
    if (!selected) return;
    setDecision(nextDecision);
    try {
      const response = await api(`/api/admin/payout-batches/${selected.id}/decision`, { method: "POST", body: JSON.stringify({ decision: nextDecision }) });
      if (!response.ok) throw new Error();
      onNotice(nextDecision === "approve" ? "Payout batch approved and processing has started." : "Payout batch rejected. No payout was sent.");
      await load();
      await viewBatch(selected.id);
    } catch { onNotice(nextDecision === "approve" ? "Could not approve this payout batch. No payout was sent." : "Could not reject this payout batch."); }
    finally { setDecision(null); }
  }

  return <section className="admin-panel" aria-label="Payout batches">
    <div className="card-heading"><div><span className="section-kicker">PAYOUT BATCHES</span><h2>Review contributor <em>payouts.</em></h2></div></div>
    <form className="inline-form" onSubmit={createBatch}><label>Period start<input type="date" required value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label><label>Period end<input type="date" required value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label><button type="submit" className="dark-button" disabled={creating}>{creating ? "Creating…" : "Create batch"}</button></form>
    {batches.length ? <div className="campaign-list">{batches.map((batch) => <button type="button" className="campaign-row" key={batch.id} onClick={() => void viewBatch(batch.id)}><div><strong>{batch.periodStart} → {batch.periodEnd}</strong><small>{batch.itemCount} contributor(s)</small></div><b>{batch.status === "draft" ? "awaiting approval" : batch.status}</b><span>{formatZar(batch.totalCents)}</span></button>)}</div> : <div className="empty-state">No payout batches yet.</div>}
    {selected && <div className="payout-batch-detail"><div className="card-heading"><div><span className="section-kicker">BATCH REVIEW</span><h3>{selected.periodStart} → {selected.periodEnd}</h3></div><strong>{selected.status === "draft" ? "Awaiting approval" : selected.status}</strong></div><p className="field-help">This review shows the contributors, verified payout rails, and total before money moves. Approval starts provider processing; rejection cancels the draft.</p><ul>{selected.items.map((item) => <li key={item.id}><strong>{item.contributorName}</strong><span>{formatZar(item.amountCents)}</span><b>{item.status}</b>{item.failureReason && <small>{item.failureReason}</small>}</li>)}</ul>{selected.status === "draft" && <div className="review-actions"><button type="button" className="dark-button" disabled={decision !== null || !selected.items.length} onClick={() => void decideBatch("approve")}>{decision === "approve" ? "Approving…" : "Approve & process"}</button><button type="button" className="ghost-button danger-button" disabled={decision !== null} onClick={() => void decideBatch("reject")}>{decision === "reject" ? "Rejecting…" : "Reject batch"}</button></div>}<button type="button" className="text-button" onClick={() => setSelected(null)}>Close</button></div>}
  </section>;
}

const WEBHOOK_EVENT_OPTIONS = ["asset.published", "licence.paid", "*"];

function WebhookSubscriptionsAdmin({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [targetUrl, setTargetUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["asset.published"]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { const response = await api("/api/webhooks/subscriptions"); const data = await readJson<{ results: WebhookSubscription[] }>(response, "Webhooks unavailable"); setSubscriptions(data.results); }
    catch { onNotice("Webhook subscriptions are unavailable right now."); }
  }, [api, onNotice]);

  useEffect(() => { void load(); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!targetUrl || !events.length) return;
    setCreating(true);
    try {
      const response = await api("/api/webhooks/subscriptions", { method: "POST", body: JSON.stringify({ targetUrl, events }) });
      if (!response.ok) throw new Error();
      const data = await response.json() as { secret: string };
      onNotice(`Webhook created. Signing secret (shown once): ${data.secret}`);
      setTargetUrl("");
      await load();
    } catch { onNotice("Could not create the webhook subscription."); } finally { setCreating(false); }
  }

  async function remove(id: string) {
    try { await api(`/api/webhooks/subscriptions/${id}`, { method: "DELETE" }); setSubscriptions((current) => current.filter((item) => item.id !== id)); }
    catch { onNotice("Could not disable the webhook."); }
  }

  return <section className="admin-panel" aria-label="Webhook subscriptions">
    <div className="card-heading"><div><span className="section-kicker">DEVELOPER WEBHOOKS</span><h2>Integrate with <em>external systems.</em></h2></div></div>
    <form className="inline-form" onSubmit={create}><label>Target URL<input type="url" required value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://example.com/hooks/veld" /></label><div className="checkbox-row-group">{WEBHOOK_EVENT_OPTIONS.map((option) => <label key={option} className="checkbox-row"><input type="checkbox" checked={events.includes(option)} onChange={(event) => setEvents((current) => event.target.checked ? [...current, option] : current.filter((value) => value !== option))} /> {option}</label>)}</div><button type="submit" className="dark-button" disabled={creating}>{creating ? "Creating…" : "Create webhook"}</button></form>
    {subscriptions.length ? <div className="rank-list">{subscriptions.map((subscription) => <div className="rank-row" key={subscription.id}><strong>{subscription.targetUrl}</strong><span>{subscription.events.join(", ")}</span><button type="button" className="text-button" onClick={() => void remove(subscription.id)}>Disable</button></div>)}</div> : <div className="empty-state">No webhook subscriptions configured.</div>}
  </section>;
}

function PhotoIndexHealth({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [jobs, setJobs] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState<"all" | "failed" | "dead_lettered" | "needs_review">("all");

  const load = useCallback(async () => {
    try { const response = await api(`/api/admin/photo-jobs?status=${status}`); const data = await readJson<{ results: Record<string, unknown>[] }>(response, "Photo jobs unavailable"); setJobs(data.results); }
    catch { onNotice("Photo index jobs are unavailable right now."); }
  }, [api, onNotice, status]);

  useEffect(() => { void load(); }, [load]);

  async function replay(jobId: string) {
    try { const response = await api(`/api/admin/photo-jobs/${jobId}/replay`, { method: "POST", body: "{}" }); if (!response.ok) throw new Error(); onNotice("Job replayed."); await load(); }
    catch { onNotice("Could not replay this job."); }
  }

  return <section className="admin-panel" aria-label="Photo index health">
    <div className="card-heading"><div><span className="section-kicker">PHOTO INDEX HEALTH</span><h2>Enrichment & indexing <em>jobs.</em></h2></div></div>
    <div className="filter-tabs">{(["all", "needs_review", "failed", "dead_lettered"] as const).map((value) => <button key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>{value.replaceAll("_", " ")}</button>)}</div>
    {jobs.length ? <div className="campaign-list">{jobs.map((job) => <div className="campaign-row" key={String(job.id)}><div><strong>{String(job.title ?? job.asset_id)}</strong><small>{String(job.operation)} · attempt {String(job.attempts)}</small></div><b>{String(job.status)}</b>{["failed", "dead_lettered", "needs_review", "skipped"].includes(String(job.status)) && <button type="button" className="text-button" onClick={() => void replay(String(job.id))}>Replay</button>}</div>)}</div> : <div className="empty-state">No jobs match this filter.</div>}
  </section>;
}

function AdminOperationsPanel({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  return <div className="admin-operations">
    <PayoutBatchAdmin api={api} onNotice={onNotice} />
    <PhotoIndexHealth api={api} onNotice={onNotice} />
    <WebhookSubscriptionsAdmin api={api} onNotice={onNotice} />
  </div>;
}

function GovernanceWorkspace({ api, onNotice, sessionUser }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; sessionUser: SessionUser }) {
  const [items, setItems] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [stage, setStage] = useState<WorkflowStage | "all">("all");
  const [licenceType, setLicenceType] = useState<LicenceType>("commercial");
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

  async function action(name: "save_correction" | "approve", updates: Partial<Asset> = {}) {
    if (!selected) return;
    try {
      const response = await api(`/api/governance/assets/${selected.id}/action`, { method: "POST", body: JSON.stringify({ action: name, ...updates }) });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(problem.error ?? "Governance action failed");
      }
      const refreshed = await api("/api/governance/assets?stage=all");
      if (refreshed.ok) setItems((await refreshed.json() as { results: Asset[] }).results);
    } catch { onNotice("The governance action was not saved. No local decision was applied."); return; }
    onNotice(name === "save_correction" ? "This exact metadata revision is now recorded as human-reviewed." : "Approved revision queued for keyword and semantic indexing.");
  }

  async function checkout() {
    if (!selected || !validation) return;
    if (selected.monetizationModel === "custom_quote") { onNotice("Custom quote selected. No payment was created; contact the contributor for pricing."); return; }
    try { const response = await api("/api/checkout", { method: "POST", body: JSON.stringify({ assetId: selected.id, licenceType, territory: "Worldwide", durationDays: 365 }) }); if (!response.ok) throw new Error(); onNotice("Checkout opened: all release rules passed."); }
    catch { onNotice(validation.allowed ? "Checkout could not be opened. Payment was not created." : `Checkout blocked: ${validation.blockingReasons[0]}`); }
  }

  return <>
  <main className="governance-page"><div className="governance-intro"><div><span className="section-kicker">CURATOR OPERATIONS / METADATA GOVERNANCE</span><h1>Review what the model <em>cannot know.</em></h1><p>Assets move from source file to licensable record through an explicit, auditable chain.</p></div><div className="governance-summary"><strong>{items.filter((item) => item.workflowStage !== "approval").length}</strong><span>assets need human attention</span></div></div><div className="governance-pipeline"><button className={stage === "all" ? "active" : ""} onClick={() => setStage("all")}><b>00</b><span>All assets<small>Full pipeline</small></span><strong>{items.length}</strong></button>{(["ingestion", "ai_tagging", "curator_correction", "approval"] as WorkflowStage[]).map((value, index) => <React.Fragment key={value}><i>→</i><button className={stage === value ? "active" : ""} onClick={() => setStage(value)}><b>0{index + 1}</b><span>{value === "ai_tagging" ? "AI tagging" : value === "curator_correction" ? "Curator correction" : value[0].toUpperCase() + value.slice(1)}<small>{items.filter((item) => item.workflowStage === value).length} records</small></span><strong>{items.filter((item) => item.workflowStage === value).length}</strong></button></React.Fragment>)}</div><div className="governance-grid"><div className="governance-queue"><div className="governance-queue-heading"><span className="section-kicker">REVIEW QUEUE</span><span>{visible.length} records</span></div>{visible.map((item) => <button key={item.id} className={`governance-item ${item.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}><div className={`governance-thumb ${item.kind}`}><span>{item.kind === "video" ? "▶" : "V"}</span></div><div><small>{item.workflowStage === "curator_correction" ? "Needs correction" : item.workflowStage === "ai_tagging" ? "AI tagging" : item.workflowStage === "approval" ? "Approved" : "Ingestion"}</small><strong>{item.title}</strong><span>{item.contributor} · {item.city ?? item.country}</span></div><i className={item.humanVerified ? "verified" : ""}></i></button>)}</div>{selected && <GovernanceDetail asset={selected} licenceType={licenceType} setLicenceType={setLicenceType} validation={validation!} onAction={action} onCheckout={checkout} />}</div></main>
  {sessionUser.role === "admin" && <AdminOperationsPanel api={api} onNotice={onNotice} />}
  </>;
}

function GovernanceDetail({ asset, licenceType, setLicenceType, validation, onAction, onCheckout }: { asset: Asset; licenceType: LicenceType; setLicenceType: (value: LicenceType) => void; validation: ReturnType<typeof archiveDomain.evaluateLicenceRequest>; onAction: (name: "save_correction" | "approve", updates?: Partial<Asset>) => void; onCheckout: () => void }) {
  const [notes, setNotes] = useState(asset.curatorNotes);
  const [workingTitle, setWorkingTitle] = useState(asset.title);
  const [caption, setCaption] = useState(asset.caption);
  const [visibleText, setVisibleText] = useState(asset.visibleText ?? "");
  const [locationType, setLocationType] = useState<NonNullable<Asset["visualLocationType"]>>(asset.visualLocationType ?? "unknown");
  const [category, setCategory] = useState<NonNullable<Asset["primaryCategory"]>>(asset.primaryCategory ?? "other");
  const [attributes, setAttributes] = useState(asset.sceneAttributes ?? []);
  useEffect(() => {
    setNotes(asset.curatorNotes); setWorkingTitle(asset.title); setCaption(asset.caption); setVisibleText(asset.visibleText ?? "");
    setLocationType(asset.visualLocationType ?? "unknown"); setCategory(asset.primaryCategory ?? "other"); setAttributes(asset.sceneAttributes ?? []);
  }, [asset.id, asset.assetRevision, asset.curatorNotes, asset.title, asset.caption, asset.visibleText, asset.visualLocationType, asset.primaryCategory, asset.sceneAttributes]);
  const approved = asset.workflowStage === "approval" && asset.status === "published";
  const currentRevisionReviewed = archiveDomain.canApproveMetadataRevision(asset);
  const licences: LicenceType[] = ["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"];
  const locationTypes: Array<NonNullable<Asset["visualLocationType"]>> = ["urban_street", "coastal_landscape", "market_scene", "indoor", "residential", "rural_landscape", "industrial", "event", "transport", "nature", "sports", "food", "other", "unknown"];
  const categories: Array<NonNullable<Asset["primaryCategory"]>> = ["people", "lifestyle", "travel", "nature", "architecture", "food", "business", "transport", "arts_culture", "sport", "news_editorial", "objects", "other"];
  const sceneAttributeOptions = ["indoor", "outdoor", "daylight", "night", "sunrise_sunset", "people_present", "no_people", "crowd", "single_person", "group", "vehicle", "building", "landscape", "close_up", "wide_view", "aerial", "food_present", "text_present", "copy_space"] as const;
  const issues = asset.enrichmentValidation?.issues ?? [];
  const saveReview = () => onAction("save_correction", { title: workingTitle, caption, visibleText, visualLocationType: locationType, primaryCategory: category, sceneAttributes: attributes, curatorNotes: notes });
  return <article className="governance-detail"><div className="detail-heading"><div><span className="section-kicker">ASSET / {asset.id} · REV {asset.assetRevision ?? 1}</span><h2>{asset.title}</h2><p>{[asset.city, asset.province].filter(Boolean).join(", ") || "Geographic location not supplied"} · {asset.contributor}</p></div><span className={`governance-status ${approved ? "approved" : "pending"}`}>{approved ? "Approved" : currentRevisionReviewed ? "Reviewed" : "Needs review"}</span></div><div className={`governance-preview ${asset.kind}`}><span>{asset.kind === "video" ? "▶" : "V"}</span><small>SOURCE · {asset.sourceFileName ?? "source file pending"}</small><b>{asset.aiConfidence ? `${Math.round(asset.aiConfidence * 100)}%` : "—"}<em>AI confidence</em></b></div><div className={`ai-review-summary ${issues.length ? "warning" : "clear"}`} role="note"><strong>{issues.length ? "AI output needs attention" : "AI listing suggestions"}</strong><span>{issues.length ? issues.join(" · ").replaceAll("_", " ") : "Structured suggestions are ready for human confirmation."}</span><small>AI runs once after a new image upload. Later edits are manual. Visible setting: {locationType.replaceAll("_", " ")} · Geographic source: {(asset.geographicLocationSource ?? "none").replaceAll("_", " ")}. The model never supplies country, city, locality, or landmark from pixels.</small></div><div className="governance-fields"><label>Working title<input value={workingTitle} onChange={(event) => setWorkingTitle(event.target.value)} /></label><label>Caption / observable description<textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={3} /></label><label>Visible location type<select value={locationType} onChange={(event) => setLocationType(event.target.value as NonNullable<Asset["visualLocationType"]>)}>{locationTypes.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select><small className="field-help">A visible setting classification, not a geographic claim.</small></label><label>Primary category<select value={category} onChange={(event) => setCategory(event.target.value as NonNullable<Asset["primaryCategory"]>)}>{categories.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><fieldset className="scene-attribute-field"><legend>Scene attributes</legend><div className="scene-attribute-options">{sceneAttributeOptions.map((value) => <label key={value}><input type="checkbox" checked={attributes.includes(value)} onChange={(event) => setAttributes((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} />{value.replaceAll("_", " ")}</label>)}</div></fieldset><label>Visible text in image<textarea value={visibleText} onChange={(event) => setVisibleText(event.target.value)} rows={2} /><small className="field-help">Detected language: {asset.detectedLanguage ?? "none"} · readability: {asset.textReadability?.replaceAll("_", " ") ?? "no text"}</small></label><label>AI suggestions<div className="governance-tags">{asset.aiTags.length ? asset.aiTags.map((tag) => <span key={tag}>{tag}</span>) : <small>Pending AI pass</small>}</div></label><label>Curator note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></label></div><div className="release-evidence"><div><span className="section-kicker">CONTRIBUTOR RELEASES</span><h3>Evidence cross-check</h3></div><div className="evidence-grid"><Evidence label="Model release" status={asset.modelReleaseStatus} /><Evidence label="Property release" status={asset.propertyReleaseStatus} /></div></div><div className="governance-actions">{!approved && <><button className="dark-button" onClick={saveReview}>Save reviewed revision ↗</button><button className="approve-button" disabled={!currentRevisionReviewed} title={currentRevisionReviewed ? "Approve this reviewed revision" : "Save the reviewed revision first"} onClick={() => onAction("approve")}>Approve asset ✓</button></>}{approved && <span className="approved-copy"><span className="verified-dot"></span> Revision {asset.approvedRevision} approved; {asset.indexedRevision === asset.approvedRevision ? "hybrid index is current" : "index sync is pending"}.</span>}</div><div className={`checkout-guard ${validation.allowed ? "clear" : "blocked"}`}><div><span className="section-kicker">PRE-CHECKOUT GATE</span><h3>Licence rules <em>before</em> payment.</h3><p>Requested licence is checked against approval, rights scope, and contributor releases.</p><p className="pricing-note">Seller access: <strong>{assetPricingLabel(asset)}</strong></p></div><div className="checkout-controls"><label>Requested licence<select value={licenceType} onChange={(event) => setLicenceType(event.target.value as LicenceType)}>{licences.map((licence) => <option key={licence} value={licence}>{licence[0].toUpperCase() + licence.slice(1)}</option>)}</select></label><button className={validation.allowed && asset.monetizationModel !== "custom_quote" ? "approve-button" : "blocked-button"} onClick={onCheckout}>{validation.allowed && asset.monetizationModel !== "custom_quote" ? "Continue to checkout ↗" : asset.monetizationModel === "custom_quote" ? "Request custom quote" : "Checkout blocked"}</button></div><div className="checkout-checks">{validation.checks.map((check) => <div key={check.label}><span className={check.passed ? "check-pass" : "check-fail"}>{check.passed ? "✓" : "×"}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div></div></article>;
}

function Evidence({ label, status }: { label: string; status: Asset["modelReleaseStatus"] }) { return <div className="evidence-row"><span className={`evidence-icon ${status}`}>{status === "verified" ? "✓" : status === "pending" ? "!" : "—"}</span><span><strong>{label}</strong><small>{status === "verified" ? "Document verified" : status === "not_required" ? "Not required" : status === "pending" ? "Evidence needs review" : "No document attached"}</small></span><b>{status.replace("_", " ")}</b></div>; }

function AssetPricingFields({ asset, setAsset }: { asset: { monetizationModel: MonetizationModel; licensePriceZar: string }; setAsset: (asset: any) => void }) {
  return <div className="asset-pricing-fields"><label>How should this asset be sold?<select value={asset.monetizationModel} onChange={(event) => setAsset({ ...asset, monetizationModel: event.target.value as MonetizationModel })}><option value="membership">Membership access</option><option value="individual_license">Sell an individual licence</option><option value="custom_quote">Custom quote for premium work</option></select></label>{asset.monetizationModel === "individual_license" && <label>Annual licence price (ZAR)<input required min="1" step="0.01" type="number" value={asset.licensePriceZar} onChange={(event) => setAsset({ ...asset, licensePriceZar: event.target.value })} placeholder="e.g. 2500" /><small className="field-help">Your price is used for a standard one-year licence. Rights and releases still need editorial approval.</small></label>}{asset.monetizationModel === "custom_quote" && <small className="field-help">Buyers will be asked to contact you for a bespoke price instead of checking out immediately.</small>}</div>;
}

function putFileWithProgress(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => { if (request.status >= 200 && request.status < 300) resolve(); else reject(new Error(`Upload failed with status ${request.status}`)); };
    request.onerror = () => reject(new Error("Upload failed due to a network error"));
    request.send(file);
  });
}

function ContributorWorkspace({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [form, setForm] = useState({ bio: "", organisationName: "", location: "", contributorType: "individual", equipment: "", portfolioUrl: "", acceptTerms: false });
  const [asset, setAsset] = useState({ kind: "image", title: "", description: "", caption: "", city: "", province: "", locality: "", landmark: "", subjectTags: "", culturalTags: "", rightsStatus: "pending", modelReleaseStatus: "unknown", propertyReleaseStatus: "unknown", monetizationModel: "membership" as MonetizationModel, licensePriceZar: "" });
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [pendingUpload, setPendingUpload] = useState<{ assetId: string; uploadUrl: string; uploadId: string } | null>(null);
  const [seller, setSeller] = useState({ signerName: "", signatureReference: "", provider: "stripe_connect", providerAccountId: "", accountHolderName: "", accountLast4: "", branchLast4: "" });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState<Partial<Record<OnboardingStepKey, boolean>>>({});

  useEffect(() => {
    let active = true;
    api("/api/onboarding/status").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { workflow?: Record<string, unknown> | null };
      if (!active || !data.workflow) return;
      const workflow = data.workflow;
      setCompleted({
        profile: Boolean(workflow.user_id) || ["submitted", "approved"].includes(String(workflow.onboarding_status ?? "")),
        seller: Boolean(workflow.tender_id),
        asset: false,
      });
      if (typeof workflow.organisation_name === "string" && workflow.organisation_name) setForm((current) => ({ ...current, organisationName: String(workflow.organisation_name), bio: typeof workflow.bio === "string" ? workflow.bio : current.bio }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [api]);

  async function saveOnboarding(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try { const response = await api("/api/onboarding", { method: "PUT", body: JSON.stringify({ ...form, languages: ["English", "isiXhosa", "Afrikaans"], specialties: asset.subjectTags.split(",").map((tag) => tag.trim()).filter(Boolean) }) }); if (!response.ok) throw new Error(); onNotice("Contributor profile submitted for verification."); setCompleted((current) => ({ ...current, profile: true })); } catch { onNotice("Profile captured in the workspace. Apply migration 0002_phase1_core.sql and connect auth to persist it."); } finally { setSaving(false); }
  }

  async function runUpload(assetId: string, uploadFile: File) {
    setUploadProgress(0);
    setUploadError("");
    try {
      const digest = await crypto.subtle.digest("SHA-256", await uploadFile.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const idempotencyKey = `asset-upload:${assetId}:${sha256}`;
      const sessionResponse = await api("/api/uploads", { method: "POST", body: JSON.stringify({ filename: uploadFile.name, contentType: uploadFile.type, sizeBytes: uploadFile.size, assetId, idempotencyKey, sha256 }) });
      const session = await sessionResponse.json() as { uploadUrl?: string; uploadId: string };
      if (!sessionResponse.ok || !session.uploadUrl) throw new Error("R2 is not configured");
      setPendingUpload({ assetId, uploadUrl: session.uploadUrl, uploadId: session.uploadId });
      await putFileWithProgress(session.uploadUrl, uploadFile, setUploadProgress);
      const completionResponse = await api(`/api/uploads/${session.uploadId}/complete`, { method: "POST", body: "{}" });
      if (!completionResponse.ok) throw new Error(`Upload completion failed (${completionResponse.status})`);
      setUploadProgress(100);
      setPendingUpload(null);
      return true;
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The upload failed. Check your connection and try again.");
      return false;
    }
  }

  async function retryUpload() {
    if (!pendingUpload || !file) return;
    setUploadProgress(0);
    setUploadError("");
    try {
      await putFileWithProgress(pendingUpload.uploadUrl, file, setUploadProgress);
      const completionResponse = await api(`/api/uploads/${pendingUpload.uploadId}/complete`, { method: "POST", body: "{}" });
      if (!completionResponse.ok) throw new Error(`Upload completion failed (${completionResponse.status})`);
      setUploadProgress(100);
      setPendingUpload(null);
      onNotice("Upload completed after retry. Asset submitted to the editorial review queue.");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The retry failed. Check your connection and try again.");
    }
  }

  async function createAsset(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const payload = { ...asset, subjectTags: asset.subjectTags.split(",").map((tag) => tag.trim()).filter(Boolean), culturalTags: asset.culturalTags.split(",").map((tag) => tag.trim()).filter(Boolean), licensePriceCents: asset.monetizationModel === "individual_license" && asset.licensePriceZar ? Math.round(Number(asset.licensePriceZar) * 100) : null };
      const createdResponse = await api("/api/assets", { method: "POST", body: JSON.stringify(payload) });
      if (!createdResponse.ok) throw new Error();
      const created = await createdResponse.json() as { id: string };
      if (file) {
        const uploaded = await runUpload(created.id, file);
        if (!uploaded) { onNotice("Asset record saved, but the media upload failed. Retry the upload below without losing your submission."); setSaving(false); return; }
      }
      onNotice("Asset submitted to the editorial review queue."); setCompleted((current) => ({ ...current, asset: true })); setAsset({ ...asset, title: "", description: "", caption: "" }); setFile(null); setUploadProgress(null);
    } catch { onNotice("The metadata form is ready, but persistence needs a local D1 migration and R2 credentials."); } finally { setSaving(false); }
  }

  async function submitSellerWorkflow(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const walletResponse = await api("/api/onboarding/wallet", { method: "POST", body: JSON.stringify({ provider: seller.provider, providerAccountId: seller.providerAccountId || undefined, accountHolderName: seller.accountHolderName, accountLast4: seller.accountLast4 || undefined, branchLast4: seller.branchLast4 || undefined, currency: "ZAR" }) });
      if (!walletResponse.ok) throw new Error("wallet");
      const contractResponse = await api("/api/onboarding/contract", { method: "POST", body: JSON.stringify({ signerName: seller.signerName, signatureMethod: "firma", signatureReference: seller.signatureReference, turnstileToken: turnstileToken || undefined }) });
      if (!contractResponse.ok) throw new Error("contract");
      onNotice("Contract signed and tender submitted. Complete KYC documents before admin approval."); setCompleted((current) => ({ ...current, seller: true }));
    } catch { onNotice("Seller workflow needs the 0005 migration, a configured Turnstile secret, and provider wallet credentials."); } finally { setSaving(false); }
  }

  return <main className="workspace-page"><div className="workspace-intro"><span className="section-kicker">CONTRIBUTOR WORKSPACE</span><h1>Keep the <em>context.</em></h1><p>Submit a record with the location, rights, and cultural context an editor needs to trust it.</p></div><OnboardingStepper completed={completed} /><div className="workspace-grid"><form className="workspace-card" id="onboarding-profile" onSubmit={saveOnboarding}><div className="card-heading"><span className="section-kicker">01 · PROFILE</span>{completed.profile ? <span className="status-pill cool">Submitted</span> : <span className="status-pill">Draft</span>}</div><h2>Your contributor profile</h2><label>Organisation or public name<input value={form.organisationName} onChange={(event) => setForm({ ...form, organisationName: event.target.value })} /></label><label>Biography<textarea value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} /></label><div className="two-fields"><label>Contributor type<select value={form.contributorType} onChange={(event) => setForm({ ...form, contributorType: event.target.value })}><option value="individual">Individual</option><option value="agency">Agency</option><option value="archive">Archive</option><option value="institution">Institution</option></select></label><label>Base location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label></div><label>Portfolio URL<input value={form.portfolioUrl} onChange={(event) => setForm({ ...form, portfolioUrl: event.target.value })} placeholder="https://…" /></label><label className="checkbox-row"><input type="checkbox" checked={form.acceptTerms} onChange={(event) => setForm({ ...form, acceptTerms: event.target.checked })} /> I accept the contributor terms</label><button className="dark-button" disabled={saving}>Save profile <span>↗</span></button></form>
    <form className="workspace-card" id="onboarding-seller" onSubmit={submitSellerWorkflow}><div className="card-heading"><span className="section-kicker">02 · SELLER SETUP</span>{completed.seller ? <span className="status-pill cool">Tender submitted</span> : <span className="status-pill warm">Pending tender</span>}</div><h2>Sign terms & set payout</h2><p className="dialog-intro">Your signed terms hash, KYC case, and payout wallet are linked to one internal approval record. Raw bank credentials are never stored here.</p><label>Signer name<input required value={seller.signerName} onChange={(event) => setSeller({ ...seller, signerName: event.target.value })} /></label><label>Firma signature reference<input required minLength={8} value={seller.signatureReference} onChange={(event) => setSeller({ ...seller, signatureReference: event.target.value })} placeholder="Reference returned by Firma" /></label><div className="two-fields"><label>Payout rail<select value={seller.provider} onChange={(event) => setSeller({ ...seller, provider: event.target.value })}><option value="stripe_connect">Stripe Connect</option><option value="payfast">PayFast</option><option value="za_bank">South African bank adapter</option></select></label><label>Provider account ID<input value={seller.providerAccountId} onChange={(event) => setSeller({ ...seller, providerAccountId: event.target.value })} placeholder="Connected account / recipient reference" /></label></div><label>Account holder<input required value={seller.accountHolderName} onChange={(event) => setSeller({ ...seller, accountHolderName: event.target.value })} /></label><div className="two-fields"><label>Account last 4<input inputMode="numeric" pattern="\d{4}" value={seller.accountLast4} onChange={(event) => setSeller({ ...seller, accountLast4: event.target.value })} /></label><label>Branch last 4<input inputMode="numeric" pattern="\d{4}" value={seller.branchLast4} onChange={(event) => setSeller({ ...seller, branchLast4: event.target.value })} /></label></div><TurnstileChallenge onToken={setTurnstileToken} /><label className="checkbox-row"><input type="checkbox" required /> I agree to the current Contributor Terms of Service and authorize this digital signature record.</label><button className="dark-button" disabled={saving}>Submit seller tender <span>↗</span></button></form>
    <form className="workspace-card" id="onboarding-asset" onSubmit={createAsset}><div className="card-heading"><span className="section-kicker">03 · FIRST ASSET</span>{completed.asset ? <span className="status-pill cool">In review</span> : <span className="status-pill warm">Needs review</span>}</div><h2>Submit a record</h2><AssetPricingFields asset={asset} setAsset={setAsset} /><div className="two-fields"><label>Media type<select value={asset.kind} onChange={(event) => setAsset({ ...asset, kind: event.target.value })}><option value="image">Photography</option><option value="video">Film & video</option></select></label><label>Source file<input type="file" accept="image/*,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />{file ? <small className="field-help">{file.name} · {Math.max(1, Math.round(file.size / 1024 / 1024))} MB — uploads after the record is created</small> : <small className="field-help">Image or video up to the configured limit. The file uploads privately after the record is created.</small>}{uploadProgress !== null && <div className="upload-progress" role="status"><div className="upload-progress-track"><span style={{ width: `${uploadProgress}%` }} /></div><small>{uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : "Upload complete"}</small></div>}{uploadError && <div className="upload-error" role="alert"><span>{uploadError}</span><button type="button" className="outline-button" onClick={() => void retryUpload()}>Retry upload</button></div>}</label></div><label>Title<input required value={asset.title} onChange={(event) => setAsset({ ...asset, title: event.target.value })} placeholder="A precise, human title" /></label><label>Caption<textarea value={asset.caption} onChange={(event) => setAsset({ ...asset, caption: event.target.value })} placeholder="What is actually happening in the frame?" /></label><div className="two-fields"><label>City<input value={asset.city} onChange={(event) => setAsset({ ...asset, city: event.target.value })} /></label><label>Locality<input value={asset.locality} onChange={(event) => setAsset({ ...asset, locality: event.target.value })} placeholder="Cape Flats, Bo-Kaap…" /></label></div><label>Subject tags<input value={asset.subjectTags} onChange={(event) => setAsset({ ...asset, subjectTags: event.target.value })} placeholder="people, food, community" /></label><label>Cultural context tags<input value={asset.culturalTags} onChange={(event) => setAsset({ ...asset, culturalTags: event.target.value })} placeholder="South African braai, wood-fire braai" /></label><div className="two-fields"><label>Rights<select value={asset.rightsStatus} onChange={(event) => setAsset({ ...asset, rightsStatus: event.target.value })}><option value="pending">Pending verification</option><option value="editorial_only">Editorial only</option><option value="verified">Commercial licensing</option></select></label><label>Model release<select value={asset.modelReleaseStatus} onChange={(event) => setAsset({ ...asset, modelReleaseStatus: event.target.value })}><option value="unknown">Unknown</option><option value="not_required">Not required</option><option value="pending">Pending</option><option value="verified">Verified</option></select></label></div><label>Property release<select value={asset.propertyReleaseStatus} onChange={(event) => setAsset({ ...asset, propertyReleaseStatus: event.target.value })}><option value="unknown">Unknown</option><option value="not_required">Not required</option><option value="pending">Pending</option><option value="verified">Verified</option></select></label><small className="field-help">Commercial campaigns may require model and property evidence. Editorial-only work must remain clearly labelled.</small><button className="dark-button" disabled={saving || !asset.title}>{saving ? "Submitting…" : "Submit for review"} <span>↗</span></button></form></div></main>;
}

type TenderRecord = { [key: string]: string | null | undefined; wallet_id?: string | null };

function ReviewWorkspace({ items, api, onNotice, onReload }: { items: Asset[]; api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; onReload: () => Promise<void> }) {
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  useEffect(() => { void api("/api/admin/onboarding/tenders").then(async (response) => { if (response.ok) setTenders((await response.json() as { results: TenderRecord[] }).results); }).catch(() => undefined); }, [api]);
  async function decide(asset: Asset, decision: "approved" | "rejected" | "needs_changes") { try { const response = await api(`/api/admin/assets/${asset.id}/review`, { method: "POST", body: JSON.stringify({ decision, notes: decision === "approved" ? "Location and rights context reviewed." : "Please add evidence for location and release status." }) }); if (!response.ok) throw new Error(); onNotice(`${asset.title} marked ${decision}.`); await onReload(); } catch { onNotice("Review action is available once the D1 database is migrated and an editor identity is configured."); } }
  async function decideTender(tender: Record<string, unknown>, decision: "approved" | "rejected" | "corrections_requested") { try { const response = await api(`/api/admin/onboarding/tenders/${String(tender.id)}/decision`, { method: "POST", body: JSON.stringify({ decision, notes: decision === "approved" ? "Contract, KYC, and payout wallet verified." : "Please complete the missing seller verification requirement." }) }); if (!response.ok) throw new Error(); onNotice(`${String(tender.display_name)} tender marked ${decision}.`); setTenders((current) => current.filter((item) => item.id !== tender.id)); } catch { onNotice("Tender decision was blocked. Verify the contract, KYC status, wallet status, and 0005 migration."); } }
  async function verifyWallet(tender: Record<string, unknown>) { try { const response = await api(`/api/admin/onboarding/wallets/${String(tender.wallet_id)}/verify`, { method: "POST", body: "{}" }); if (!response.ok) throw new Error(); setTenders((current) => current.map((item) => item.id === tender.id ? { ...item, wallet_status: "verified" } : item)); onNotice("Payout wallet marked verified; tender can now be accepted after KYC clears."); } catch { onNotice("Wallet verification failed."); } }
  return <main className="workspace-page"><div className="workspace-intro"><span className="section-kicker">EDITORIAL GOVERNANCE</span><h1>Review what is <em>real.</em></h1><p>Publish only what has evidence for place, context, rights, consent, and seller identity.</p></div><section className="review-queue"><div className="card-heading"><span className="section-kicker">PENDING TENDERS</span><span>{tenders.length} seller submissions</span></div>{tenders.length ? tenders.map((tender) => <article className="review-item" key={String(tender.id)}><div className="review-copy"><div className="card-heading"><span className="section-kicker">{String(tender.id).slice(0, 8)} · {String(tender.created_at ?? "")}</span><span className="status-pill warm">{String(tender.status)}</span></div><h2>{String(tender.display_name)}</h2><p>{String(tender.email)} · contract {String(tender.contract_version)} · hash {String(tender.contract_hash).slice(0, 16)}…</p><div className="review-evidence"><span>KYC {String(tender.verification_status ?? "missing")}</span><span>Wallet {String(tender.wallet_provider ?? "missing")} / {String(tender.wallet_status ?? "missing")}</span><span>Risk {String(tender.risk_level ?? "unknown")}</span></div><div className="review-actions">{tender.wallet_id && tender.wallet_status !== "verified" && <button className="outline-button" onClick={() => verifyWallet(tender)}>Verify wallet</button>}<button className="dark-button" onClick={() => decideTender(tender, "approved")}>Accept tender</button><button className="ghost-button" onClick={() => decideTender(tender, "corrections_requested")}>Request corrections</button><button className="ghost-button danger-button" onClick={() => decideTender(tender, "rejected")}>Reject</button></div></div></article>) : <div className="empty-state">No seller tenders are waiting for review.</div>}</section><div className="review-queue">{items.length ? items.map((asset) => <article className="review-item" key={asset.id}><div className={`review-visual ${asset.kind}`}><span>{asset.kind === "video" ? "▶" : "V"}</span></div><div className="review-copy"><div className="card-heading"><span className="section-kicker">{asset.city}, {asset.province}</span><span className={`status-pill ${asset.humanVerified ? "cool" : "warm"}`}>{asset.humanVerified ? "Verified" : "Needs review"}</span></div><h2>{asset.title}</h2><p>{asset.caption || asset.description}</p><div className="review-tags">{asset.culturalTags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="review-evidence"><span>Authenticity {archiveDomain.percent(asset.authenticityConfidence)}%</span><span>Rights {asset.rightsStatus}</span><span>Model release {asset.modelReleaseStatus}</span></div><div className="review-actions"><button className="dark-button" onClick={() => decide(asset, "approved")}>Approve</button><button className="ghost-button" onClick={() => decide(asset, "needs_changes")}>Request changes</button><button className="ghost-button danger-button" onClick={() => decide(asset, "rejected")}>Reject</button></div></div></article>) : <div className="empty-state">No records are waiting for editorial review.</div>}</div></main>;
}

function PreviewWatermark() {
  return <div className="preview-watermark" aria-hidden="true"><span>VELD ARCHIVE · PREVIEW</span><small>NOT LICENSED FOR USE</small></div>;
}

function MediaAsset({ asset, controls = false, watermarkRequired = asset.kind === "video" }: { asset: Asset; controls?: boolean; watermarkRequired?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset.id, asset.previewUrl, asset.streamEmbedUrl]);
  if (failed || (!asset.previewUrl && !asset.streamEmbedUrl)) return <div className="media-unavailable" role="status">Preview unavailable</div>;
  const media = controls && asset.streamEmbedUrl
    ? <iframe className="media-frame" src={asset.streamEmbedUrl} title={`${asset.title} video player`} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
    : asset.kind === "video" && asset.previewUrl
      ? <video className="media-element" src={asset.previewUrl} poster={asset.posterUrl ?? undefined} controls={controls} playsInline preload={controls ? "metadata" : "none"} aria-label={`${asset.title} video preview`} onError={() => setFailed(true)} />
      : asset.kind === "image" && asset.previewUrl
        ? <img className="media-element" src={asset.previewUrl} alt={asset.title} loading={controls ? "eager" : "lazy"} onError={() => setFailed(true)} />
        : <div className="media-unavailable" role="status">Stream playback is not configured</div>;
  return <div className="media-stage">{media}{watermarkRequired && asset.kind === "video" && <PreviewWatermark />}</div>;
}

function AssetCard({ asset, index, onOpen }: { asset: Asset; index: number; onOpen: (asset: Asset) => void }) { const explanation = asset.matchExplanation ?? archiveDomain.buildMatchExplanation(asset); return <button type="button" className={`asset-card card-${index + 1}`} onClick={() => onOpen(asset)} aria-haspopup="dialog"><div className={`asset-visual visual-${index + 1} ${asset.kind}`}>{asset.previewUrl && <MediaAsset asset={asset} />}<div className="visual-overlay"><span aria-hidden="true">{asset.kind === "video" ? "▶" : "V"}</span><span>{asset.kind === "video" ? "FILM" : "4K"}</span></div><div className="visual-place">{asset.landmark ?? asset.locality ?? asset.city}</div></div><div className="asset-info"><div><h3>{asset.title}</h3><p>{asset.city}, {asset.province}</p><span className={`confidence-chip ${archiveDomain.confidenceLabel(explanation.matchConfidence)}`}>{archiveDomain.percent(explanation.matchConfidence)}% match</span><small className="asset-pricing-label">{assetPricingLabel(asset)}</small></div><span className={`status-dot ${asset.humanVerified ? "verified" : "review"}`} title={asset.humanVerified ? "Human verified" : "Needs editor review"} aria-label={asset.humanVerified ? "Human verified" : "Needs editor review"} /></div></button>; }

function rightsLabel(status: Asset["rightsStatus"]): string {
  return status === "editorial_only" ? "Editorial use only" : status === "verified" ? "Commercial licensing" : status === "restricted" ? "Restricted use" : "Rights under review";
}

function releaseLabel(status: Asset["modelReleaseStatus"]): string {
  return status === "not_required" ? "Not required" : status === "verified" ? "Verified" : status === "pending" ? "Pending review" : "Not confirmed";
}

function AssetLightboxAction({ asset, sessionUser, api, onNotice }: { asset: Asset; sessionUser: SessionUser | null; api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [lightboxes, setLightboxes] = useState<BuyerLightbox[]>([]);
  const [saving, setSaving] = useState(false);
  const isBuyer = sessionUser?.role === "buyer" || sessionUser?.role === "admin";

  useEffect(() => {
    if (!isBuyer) return;
    let active = true;
    api("/api/lightboxes").then(async (response) => { if (!response.ok) return; const data = await response.json() as { results: BuyerLightbox[] }; if (active) setLightboxes(data.results); }).catch(() => undefined);
    return () => { active = false; };
  }, [api, isBuyer]);

  if (!isBuyer) return null;

  async function saveToLightbox(lightboxId: string) {
    setSaving(true);
    try {
      const response = await api(`/api/lightboxes/${lightboxId}/assets`, { method: "POST", body: JSON.stringify({ assetId: asset.id }) });
      if (!response.ok) throw new Error();
      onNotice(`Saved "${asset.title}" to your lightbox.`);
    } catch {
      onNotice("Could not save this asset to a lightbox.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="lightbox-action" aria-label="Save to lightbox">
    {lightboxes.length
      ? <label>Save to lightbox<select disabled={saving} defaultValue="" onChange={(event) => { if (event.target.value) void saveToLightbox(event.target.value); }}><option value="" disabled>Choose a lightbox…</option>{lightboxes.map((lightbox) => <option key={lightbox.id} value={lightbox.id}>{lightbox.title}</option>)}</select></label>
      : <small className="field-help">Create a lightbox from your Buyer workspace to shortlist this asset.</small>}
  </div>;
}

function AssetVersionHistory({ asset, sessionUser, api }: { asset: Asset; sessionUser: SessionUser | null; api: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [events, setEvents] = useState<AssetVersionEvent[] | null>(null);
  const canView = sessionUser && ["editor", "admin", "contributor"].includes(sessionUser.role);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    api(`/api/assets/${asset.id}/versions`).then(async (response) => { if (!response.ok) return; const data = await response.json() as { results: AssetVersionEvent[] }; if (active) setEvents(data.results); }).catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, [api, asset.id, canView]);

  if (!canView || !events?.length) return null;
  return <details className="version-history"><summary>Revision history ({events.length})</summary><ol>{events.map((event) => <li key={event.id}><strong>Rev {event.assetRevision ?? "—"}</strong><span>{event.summary}</span><small>{event.actorName} · {new Date(event.createdAt).toLocaleString("en-ZA")}</small></li>)}</ol></details>;
}

function AssetModal({ asset, onClose, onNotice, sessionUser, api, trackEvent }: { asset: Asset; onClose: () => void; onNotice: (notice: string) => void; sessionUser: SessionUser | null; api: (path: string, init?: RequestInit) => Promise<Response>; trackEvent: (payload: Record<string, unknown>) => void }) {
  const explanation = asset.matchExplanation ?? archiveDomain.buildMatchExplanation(asset);
  const model = asset.monetizationModel ?? "membership";
  const requestLabel = model === "custom_quote" ? "Request custom quote" : model === "individual_license" ? "Request individual licence" : "Request membership access";
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [paidPreviewAccess, setPaidPreviewAccess] = useState(false);
  const viewRecorded = useRef(false);
  useEffect(() => {
    if (viewRecorded.current) return;
    viewRecorded.current = true;
    trackEvent({ type: "asset_view", assetId: asset.id });
  }, [asset.id, trackEvent]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    setPaidPreviewAccess(false);
    if (asset.kind !== "video" || !sessionUser) return undefined;
    let active = true;
    api(`/api/assets/${encodeURIComponent(asset.id)}/preview-access`).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { paid?: boolean };
      if (active) setPaidPreviewAccess(data.paid === true);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [api, asset.id, asset.kind, sessionUser]);
  const useGuidance = asset.rightsStatus === "editorial_only" ? "Editorial use only — not cleared for advertising or promotion." : asset.rightsStatus === "verified" ? "Commercial licensing is available subject to the selected licence and release evidence." : "Licence availability is subject to rights review.";
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div ref={dialogRef} className="asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-title" onClick={(event) => event.stopPropagation()}><button ref={closeButtonRef} type="button" className="close-button" onClick={onClose} aria-label="Close asset details">×</button><div className={`modal-visual ${asset.kind}`}><MediaAsset asset={asset} controls watermarkRequired={!paidPreviewAccess} /></div><div className="modal-copy"><span className="section-kicker">{asset.kind === "video" ? "FILM & VIDEO" : "PHOTOGRAPHY"} · {asset.city ?? "LOCATION EVIDENCE PENDING"}</span><h2 id="asset-title">{asset.title}</h2><p>{asset.caption || asset.description}</p><div className="tag-list">{asset.visualLocationType && asset.visualLocationType !== "unknown" && <span>Setting: {asset.visualLocationType.replaceAll("_", " ")}</span>}{asset.primaryCategory && asset.primaryCategory !== "other" && <span>Category: {asset.primaryCategory.replaceAll("_", " ")}</span>}{asset.culturalTags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="match-box"><div className="card-heading"><span className="section-kicker">WHY THIS MATCHED</span><strong>{archiveDomain.percent(explanation.matchConfidence)}% {archiveDomain.confidenceLabel(explanation.matchConfidence)}</strong></div>{explanation.signals.slice(0, 3).map((signal) => <p key={signal.label}><b>{signal.label}:</b> {signal.detail}</p>)}<small>{explanation.metadataReviewNote}</small></div><div className="rights-summary" aria-label="Licence and rights summary"><span>Use: <b>{rightsLabel(asset.rightsStatus)}</b></span><span>Model release: <b>{releaseLabel(asset.modelReleaseStatus)}</b></span><span>Property release: <b>{releaseLabel(asset.propertyReleaseStatus)}</b></span><span>Authenticity: <b>{archiveDomain.percent(asset.authenticityConfidence)}%</b></span><span>Access: <b>{assetPricingLabel(asset)}</b></span></div><AssetLightboxAction asset={asset} sessionUser={sessionUser} api={api} onNotice={onNotice} /><AssetVersionHistory asset={asset} sessionUser={sessionUser} api={api} /><p className={`usage-guidance ${asset.rightsStatus === "editorial_only" ? "warning" : ""}`} role="note">{useGuidance}</p>{asset.kind === "video" && !paidPreviewAccess && <p className="preview-rights-note" role="note">Preview watermark remains until a paid licence is confirmed. Licensed original access is then available from your buyer workspace.</p>}<div className="modal-actions"><button type="button" className="dark-button" onClick={() => { onNotice(asset.rightsStatus === "editorial_only" ? "Sign in to review editorial licence terms and request access." : "Sign in to review licence options, release evidence, and request access."); onClose(); }}>{requestLabel} <span>↗</span></button><button type="button" className="ghost-button" onClick={() => { onNotice("Lightbox saving is not available until an authenticated workspace is connected."); onClose(); }}>Save to lightbox</button></div></div></div></div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
