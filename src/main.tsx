import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { archiveDomain, type Asset, type BuyerAnalytics, type CommunityOverview, type ContributorAnalytics, type LicenceType, type MonetizationModel, type SearchResponse, type TakedownReason, type WorkflowStage } from "./shared";
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

type View = "explore" | "contributor" | "buyer" | "review" | "governance" | "community";
type SessionUser = { id: string; email: string; displayName: string; role: string; organizationId: string; organizationName: string };

const demoAssets: Asset[] = [
  { id: "asset-braai-cape-flats", kind: "image", status: "published", title: "Saturday braai, Cape Flats", description: "A human-verified South African braai in an everyday Cape Flats setting.", caption: "Friends gather around a wood-fire braai in the Cape Flats.", country: "South Africa", province: "Western Cape", city: "Cape Town", locality: "Mitchells Plain", landmark: null, subjectTags: ["people", "food", "community", "outdoor"], culturalTags: ["South African braai", "wood-fire braai", "Cape Flats"], rightsStatus: "verified", modelReleaseStatus: "verified", propertyReleaseStatus: "not_required", authenticityConfidence: .92, humanVerified: true, contributor: "Veld demo archive", workflowStage: "approval", aiTags: ["braai", "community"], curatorNotes: "Demo fallback record." },
  { id: "asset-demo-table-mountain", kind: "image", status: "published", title: "Table Mountain above Cape Town", description: "A documented panorama of Table Mountain in Cape Town, Western Cape.", caption: "Table Mountain, Cape Town, Western Cape, South Africa.", country: "South Africa", province: "Western Cape", city: "Cape Town", locality: "City Bowl", landmark: "Table Mountain", subjectTags: ["landscape", "mountain", "city", "coast"], culturalTags: ["South African landscape", "Cape Town"], rightsStatus: "verified", modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", authenticityConfidence: .99, humanVerified: true, contributor: "Veld demo archive", workflowStage: "approval", aiTags: ["South Africa", "Cape Town", "Table Mountain"], curatorNotes: "Demo fallback record." },
  { id: "asset-demo-garden-route", kind: "image", status: "published", title: "Garden Route landscape", description: "A documented photograph of the Garden Route National Park in South Africa.", caption: "Garden Route National Park landscape, South Africa.", country: "South Africa", province: "Eastern Cape", city: "Knysna", locality: "Garden Route", landmark: "Garden Route National Park", subjectTags: ["landscape", "forest", "coast", "travel"], culturalTags: ["South African landscape", "Garden Route"], rightsStatus: "verified", modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", authenticityConfidence: .98, humanVerified: true, contributor: "Veld demo archive", workflowStage: "approval", aiTags: ["South Africa", "Garden Route"], curatorNotes: "Demo fallback record." },
  { id: "asset-demo-road", kind: "video", status: "published", title: "Left-side drive through the Garden Route", description: "A right-hand-drive vehicle travels on the left side of a Garden Route road.", caption: "Road footage through the Garden Route, South Africa.", country: "South Africa", province: "Western Cape", city: "George", locality: "Garden Route", landmark: "Outeniqua Mountains", subjectTags: ["road", "travel", "driving", "video"], culturalTags: ["Garden Route", "right-hand drive", "South African road life"], rightsStatus: "verified", modelReleaseStatus: "not_required", propertyReleaseStatus: "not_required", authenticityConfidence: .94, humanVerified: true, contributor: "Veld demo archive", workflowStage: "approval", aiTags: ["Garden Route", "road footage"], curatorNotes: "Demo fallback record." },
];

function filterDemoAssets(query: string, kind: "all" | "image" | "video"): Asset[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2);
  return demoAssets.filter((asset) => {
    if (kind !== "all" && asset.kind !== kind) return false;
    const haystack = [asset.title, asset.description, asset.caption, asset.city, asset.locality, asset.landmark, ...asset.subjectTags, ...asset.culturalTags].filter(Boolean).join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function App() {
  const [view, setView] = useState<View>("explore");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [notice, setNotice] = useState("Live archive results are loaded from the verified content service.");
  const [reviewItems, setReviewItems] = useState<Asset[]>([]);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [devRole, setDevRole] = useState<"contributor" | "admin">("contributor");

  const api = useCallback((path: string, init: RequestInit = {}) => fetch(path, { ...init, credentials: "include", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}), ...(init.headers ?? {}) } }), [csrfToken]);

  useEffect(() => {
    void fetch("/api/auth/session", { credentials: "include" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { authenticated: boolean; user?: SessionUser; csrfToken?: string };
      if (data.authenticated && data.user) { setSessionUser(data.user); setCsrfToken(data.csrfToken ?? ""); }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ q: activeQuery, kind: filter, status: "published" });
    fetch(`/api/assets?${params}`, { signal: controller.signal, credentials: "include" })
      .then(async (response) => { if (!response.ok) throw new Error("API unavailable"); return response.json() as Promise<SearchResponse>; })
      .then((data) => setAssets(data.results.map((asset) => archiveDomain.withMatchExplanation(asset, activeQuery))))
      .catch(() => {
        setAssets(filterDemoAssets(activeQuery, filter).map((asset) => archiveDomain.withMatchExplanation(asset, activeQuery)));
        setNotice("Demo archive mode is active while the live content service is unavailable.");
      });
    return () => controller.abort();
  }, [activeQuery, filter]);

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

  function navigate(nextView: View) {
    if (!sessionUser && ["contributor", "buyer", "review", "governance"].includes(nextView)) {
      setNotice("Sign in is required for this workspace.");
      return;
    }
    setView(nextView);
    if (nextView === "review") void loadReviewQueue();
  }

  function trackEvent(payload: Record<string, unknown>) {
    if (!analyticsConsent) return;
    void fetch("/api/analytics/events", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, consent: true }) }).catch(() => undefined);
  }

  function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    setActiveQuery(value);
    trackEvent({ type: "search", query: value });
    setView("explore");
    setNotice(query.trim() ? `Searching the archive for “${query.trim()}”` : "Showing the latest verified South African media");
  }

  const verifiedCount = useMemo(() => assets.filter((asset) => asset.humanVerified).length, [assets]);

  return <div className="app-shell">
    <header className="topbar">
      <button className="wordmark wordmark-button" onClick={() => navigate("explore")} aria-label="Veld Archive home"><span className="mark">V</span><span>veld<span className="muted">archive</span></span></button>
      <nav className="nav-links" aria-label="Primary navigation"><button onClick={() => navigate("explore")}>Explore</button><button onClick={() => navigate("community")}>Community & collections</button><button onClick={() => navigate("contributor")}>Contributor insights</button><button onClick={() => navigate("buyer")}>Buyer ROI</button><button onClick={() => navigate("review")}>Editorial review</button><button className="governance-link" onClick={() => navigate("governance")}>Governance <span>NEW</span></button></nav>
      <div className="top-actions">{import.meta.env.DEV && <label className="role-switcher">Local role <select value={devRole} onChange={(event) => setDevRole(event.target.value as "contributor" | "admin")}><option value="contributor">Contributor</option><option value="admin">Admin</option></select></label>}<button className="ghost-button" onClick={async () => { if (!import.meta.env.DEV) { setNotice("Use your organisation identity provider to sign in."); return; } const response = await fetch("/api/auth/dev-login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: devRole }) }); if (!response.ok) { setNotice("Local authentication is unavailable; apply the identity migration first."); return; } const data = await response.json() as { user: SessionUser; csrfToken: string }; setSessionUser(data.user); setCsrfToken(data.csrfToken); setNotice(`Signed in to ${data.user.organizationName}.`); }}>Sign in</button>{sessionUser && <button className="ghost-button" onClick={() => { void api("/api/auth/logout", { method: "POST" }).then(() => { setSessionUser(null); setCsrfToken(""); setNotice("Signed out."); }); }}>Sign out</button>}</div>
    </header>
    {!analyticsConsent && <button className="privacy-consent" onClick={() => setAnalyticsConsent(true)}>Allow anonymous demand insights</button>}

    {view === "explore" && <ExploreView query={query} setQuery={setQuery} runSearch={runSearch} assets={assets} filter={filter} setFilter={setFilter} verifiedCount={verifiedCount} notice={notice} onOpen={setSelectedAsset} />}
    {view === "contributor" && <><AnalyticsDashboard role="contributor" /><ContributorWorkspace api={api} onNotice={setNotice} /></>}
    {view === "buyer" && <AnalyticsDashboard role="buyer" />}
    {view === "review" && <ReviewWorkspace items={reviewItems} api={api} onNotice={setNotice} onReload={loadReviewQueue} />}
    {view === "governance" && <GovernanceWorkspace api={api} onNotice={setNotice} />}
    {view === "community" && <CommunityWorkspace api={api} onNotice={setNotice} />}

    <footer><button className="wordmark wordmark-button" onClick={() => navigate("explore")}><span className="mark">V</span><span>veld<span className="muted">archive</span></span></button><span>© 2026 Veld Archive · South Africa</span><span>Context before category.</span></footer>
    {selectedAsset && <AssetModal asset={selectedAsset} onClose={() => setSelectedAsset(null)} onNotice={setNotice} />}
  </div>;
}

function ExploreView({ query, setQuery, runSearch, assets, filter, setFilter, verifiedCount, notice, onOpen }: { query: string; setQuery: (value: string) => void; runSearch: (event: React.FormEvent) => void; assets: Asset[]; filter: "all" | "image" | "video"; setFilter: (value: "all" | "image" | "video") => void; verifiedCount: number; notice: string; onOpen: (asset: Asset) => void }) {
  const suggestions = ["A real wood-fire braai in the Cape Flats", "A verified Table Mountain landscape at golden hour", "Right-hand-drive road footage in the Garden Route"];
  return <main id="top">
    <section className="hero"><div className="eyebrow"><span className="pulse" /> The trusted South African visual archive</div><h1>Find the image<br /><em>behind the story.</em></h1><p className="hero-copy">Authentic photography and film for brands that care where a story comes from.</p><form className="search-box" onSubmit={runSearch}><span className="search-icon">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Describe the story you need to tell…" aria-label="Search media" /><button type="submit">Search archive <span>↗</span></button></form><div className="suggestion-row">{suggestions.map((suggestion) => <button type="button" key={suggestion} className="suggestion" onClick={() => { setQuery(suggestion); }}>{suggestion} <span>→</span></button>)}</div></section>
    <section className="trust-strip"><div><strong>01</strong><span>Context-first metadata</span></div><div><strong>02</strong><span>Rights you can trust</span></div><div><strong>03</strong><span>Creators paid fairly</span></div><div className="trust-note">Built for the places we know.</div></section>
    <section className="explore-section"><div className="section-heading"><div><span className="section-kicker">CURATED FROM THE GROUND UP</span><h2>The latest from <em>here.</em></h2></div><div className="result-note">{notice}</div></div><div className="toolbar"><div className="filter-tabs" role="tablist" aria-label="Media type">{(["all", "image", "video"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All media" : value === "image" ? "Photography" : "Film & video"}</button>)}</div><div className="verified-stat"><span className="verified-dot" />{verifiedCount} human-verified results</div></div><div className="explainability-note"><strong>Search evidence is visible.</strong><span>Open a result to inspect the fields used, match confidence, and verification status.</span><span className="ai-badge">AI + HUMAN REVIEW</span></div><div className="asset-grid">{assets.length ? assets.map((asset, index) => <AssetCard key={asset.id} asset={asset} index={index} onOpen={onOpen} />) : <div className="empty-state">No assets matched this brief yet. Try a location, landmark, or cultural context.</div>}</div></section>
    <ModerationQueue assets={assets} onReview={onOpen} />
    <section className="manifesto"><div className="manifesto-label">WHY VELD</div><div><h2>South Africa is not a<br /><em>stock category.</em></h2><p>Every place has a texture. Every community has a point of view. Veld gives the people who make the work more control over how it is found, licensed, and remembered.</p></div></section>
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
      .then(async (response) => { if (!response.ok) throw new Error("Analytics unavailable"); return response.json() as Promise<ContributorAnalytics | BuyerAnalytics>; })
      .then(setData).catch(() => setData(null));
    return () => controller.abort();
  }, [role]);

  if (!data) return <section className="analytics-page"><div className="empty-state">Analytics are unavailable. No cached or placeholder figures are shown.</div></section>;

  if (data.role === "contributor") return <section className="analytics-page"><div className="workspace-intro"><span className="section-kicker">CONTRIBUTOR SIGNALS · {data.range}</span><h1>Make what the<br /><em>brief is asking for.</em></h1><p>Demand is shown in aggregate so you can spot opportunity without tracking individual buyers.</p></div><div className="metric-grid"><MetricCard label="Archive searches" value={data.summary.searches.toLocaleString()} detail="for your context and tags" /><MetricCard label="Asset views" value={data.summary.views.toLocaleString()} detail="on your published work" /><MetricCard label="Demand change" value={`+${data.summary.demandChange}%`} detail="compared with prior period" tone="green" /><MetricCard label="Saved to briefs" value={data.summary.saves.toLocaleString()} detail="lightbox saves" /></div><div className="analytics-columns"><article className="analytics-card analytics-wide"><div className="card-heading"><div><span className="section-kicker">SEARCH TRENDS</span><h2>What buyers are looking for</h2></div><span className="status-pill cool">Aggregate only</span></div><MetricBars points={data.searchTrends} /></article><article className="analytics-card"><span className="section-kicker">POPULAR TAGS</span><h2>Context with pull</h2><div className="rank-list">{data.popularTags.map((tag, index) => <div className="rank-row" key={tag.label}><span className="rank-number">0{index + 1}</span><strong>{tag.label}</strong><span>{tag.value}</span></div>)}</div></article><article className="analytics-card"><span className="section-kicker">GEOGRAPHIC DEMAND</span><h2>Where the brief is</h2><div className="rank-list">{data.geographicDemand.map((place) => <div className="place-row" key={place.label}><div><strong>{place.label}</strong><small>{place.detail}</small></div><span className="demand-pill">{place.value}</span></div>)}</div></article></div><div className="opportunity-grid">{data.opportunities.map((item) => <article className={`opportunity-card ${item.tone}`} key={item.title}><span className="section-kicker">OPPORTUNITY</span><h3>{item.title}</h3><p>{item.detail}</p></article>)}</div><p className="privacy-note">Privacy note: Veld stores daily counters, coarse place labels, and approved asset context only. No IP address, device fingerprint, cookie, or raw search history is used for these signals.</p></section>;

  return <section className="analytics-page"><div className="workspace-intro"><span className="section-kicker">BUYER PERFORMANCE · {data.range}</span><h1>Know what your<br /><em>licence made possible.</em></h1><p>See campaign delivery and attributed results beside the exact assets your team licensed.</p></div><div className="metric-grid"><MetricCard label="Campaign spend" value={formatZar(data.summary.spendCents)} detail="licensed asset spend" /><MetricCard label="Licensed assets" value={data.summary.licensedAssets.toString()} detail="with campaign attribution" /><MetricCard label="Attributed ROI" value={`+${data.summary.roi}%`} detail="conversion value proxy" tone="green" /><MetricCard label="Conversions" value={data.summary.conversions.toLocaleString()} detail={`${data.summary.impressions.toLocaleString()} impressions`} /></div><div className="analytics-columns buyer-columns"><article className="analytics-card analytics-wide"><div className="card-heading"><div><span className="section-kicker">DELIVERY TREND</span><h2>Campaign impressions</h2></div><span className="status-pill cool">Licensed assets only</span></div><MetricBars points={data.performance} tone="green" /></article><article className="analytics-card"><span className="section-kicker">CAMPAIGNS</span><h2>Asset-level ROI</h2><div className="campaign-list">{data.campaigns.map((campaign) => <div className="campaign-row" key={campaign.id}><div><strong>{campaign.name}</strong><small>{campaign.assetTitle}</small></div><b>+{campaign.roi}%</b><span>{formatZar(campaign.spendCents)}</span></div>)}</div></article></div><div className="campaign-table">{data.campaigns.map((campaign) => <article className="campaign-detail" key={campaign.id}><div><span className="section-kicker">LICENSED ASSET</span><h3>{campaign.assetTitle}</h3><p>{campaign.name} · {campaign.status}</p></div><div><strong>{campaign.impressions.toLocaleString()}</strong><small>impressions</small></div><div><strong>{campaign.conversions.toLocaleString()}</strong><small>conversions</small></div><div><strong>+{campaign.roi}%</strong><small>attributed ROI</small></div></article>)}</div><p className="privacy-note">ROI is tied to licences in D1 and campaign events from your authenticated workspace. Conversion value is a configurable reporting assumption until your ad platform is connected.</p></section>;
}

function MetricCard({ label, value, detail, tone = "rust" }: { label: string; value: string; detail: string; tone?: "rust" | "green" }) { return <article className={`metric-card ${tone}`}><span className="section-kicker">{label}</span><strong>{value}</strong><small>{detail}</small></article>; }

function GovernanceWorkspace({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
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
    try { const response = await api("/api/checkout", { method: "POST", body: JSON.stringify({ assetId: selected.id, licenceType, territory: "Worldwide", durationDays: 365 }) }); if (!response.ok) throw new Error(); onNotice("Checkout opened: all release rules passed."); }
    catch { onNotice(validation.allowed ? "Checkout could not be opened. Payment was not created." : `Checkout blocked: ${validation.blockingReasons[0]}`); }
  }

  return <main className="governance-page"><div className="governance-intro"><div><span className="section-kicker">CURATOR OPERATIONS / METADATA GOVERNANCE</span><h1>Review what the model <em>cannot know.</em></h1><p>Assets move from source file to licensable record through an explicit, auditable chain.</p></div><div className="governance-summary"><strong>{items.filter((item) => item.workflowStage !== "approval").length}</strong><span>assets need human attention</span></div></div><div className="governance-pipeline"><button className={stage === "all" ? "active" : ""} onClick={() => setStage("all")}><b>00</b><span>All assets<small>Full pipeline</small></span><strong>{items.length}</strong></button>{(["ingestion", "ai_tagging", "curator_correction", "approval"] as WorkflowStage[]).map((value, index) => <React.Fragment key={value}><i>→</i><button className={stage === value ? "active" : ""} onClick={() => setStage(value)}><b>0{index + 1}</b><span>{value === "ai_tagging" ? "AI tagging" : value === "curator_correction" ? "Curator correction" : value[0].toUpperCase() + value.slice(1)}<small>{items.filter((item) => item.workflowStage === value).length} records</small></span><strong>{items.filter((item) => item.workflowStage === value).length}</strong></button></React.Fragment>)}</div><div className="governance-grid"><div className="governance-queue"><div className="governance-queue-heading"><span className="section-kicker">REVIEW QUEUE</span><span>{visible.length} records</span></div>{visible.map((item) => <button key={item.id} className={`governance-item ${item.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}><div className={`governance-thumb ${item.kind}`}><span>{item.kind === "video" ? "▶" : "V"}</span></div><div><small>{item.workflowStage === "curator_correction" ? "Needs correction" : item.workflowStage === "ai_tagging" ? "AI tagging" : item.workflowStage === "approval" ? "Approved" : "Ingestion"}</small><strong>{item.title}</strong><span>{item.contributor} · {item.city ?? item.country}</span></div><i className={item.humanVerified ? "verified" : ""}></i></button>)}</div>{selected && <GovernanceDetail asset={selected} licenceType={licenceType} setLicenceType={setLicenceType} validation={validation!} onAction={action} onCheckout={checkout} />}</div></main>;
}

function GovernanceDetail({ asset, licenceType, setLicenceType, validation, onAction, onCheckout }: { asset: Asset; licenceType: LicenceType; setLicenceType: (value: LicenceType) => void; validation: ReturnType<typeof archiveDomain.evaluateLicenceRequest>; onAction: (name: "run_ai_tagging" | "save_correction" | "approve", updates?: Partial<Asset>) => void; onCheckout: () => void }) {
  const [notes, setNotes] = useState(asset.curatorNotes);
  useEffect(() => setNotes(asset.curatorNotes), [asset.id, asset.curatorNotes]);
  const approved = asset.workflowStage === "approval" && asset.status === "published";
  const licences: LicenceType[] = ["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"];
  return <article className="governance-detail"><div className="detail-heading"><div><span className="section-kicker">ASSET / {asset.id}</span><h2>{asset.title}</h2><p>{asset.city}, {asset.province} · {asset.contributor}</p></div><span className={`governance-status ${approved ? "approved" : "pending"}`}>{approved ? "Approved" : "Needs review"}</span></div><div className={`governance-preview ${asset.kind}`}><span>{asset.kind === "video" ? "▶" : "V"}</span><small>SOURCE · {asset.sourceFileName ?? "source file pending"}</small><b>{asset.authenticityConfidence ? `${Math.round(asset.authenticityConfidence * 100)}%` : "—"}<em>AI confidence</em></b></div><div className="governance-fields"><label>Working title<input defaultValue={asset.title} aria-label="Working title" /></label><label>Caption / context<textarea defaultValue={asset.caption} rows={3} aria-label="Caption or context" /></label><label>AI suggestions<div className="governance-tags">{asset.aiTags.length ? asset.aiTags.map((tag) => <span key={tag}>{tag}</span>) : <small>Pending AI pass</small>}</div></label><label>Curator note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} aria-label="Curator note" /></label></div><div className="release-evidence"><div><span className="section-kicker">CONTRIBUTOR RELEASES</span><h3>Evidence cross-check</h3></div><div className="evidence-grid"><Evidence label="Model release" status={asset.modelReleaseStatus} /><Evidence label="Property release" status={asset.propertyReleaseStatus} /></div></div><div className="governance-actions">{!approved && <><button className="outline-button" onClick={() => onAction("run_ai_tagging", { aiTags: ["South Africa", asset.city ?? "location", asset.kind, "context pending"] })}>Run AI tagging ↗</button><button className="dark-button" onClick={() => onAction("save_correction", { curatorNotes: notes })}>Save correction ↗</button><button className="approve-button" onClick={() => onAction("approve", { curatorNotes: notes })}>Approve asset ✓</button></>}{approved && <span className="approved-copy"><span className="verified-dot"></span> Approval recorded; checkout gate is active.</span>}</div><div className={`checkout-guard ${validation.allowed ? "clear" : "blocked"}`}><div><span className="section-kicker">PRE-CHECKOUT GATE</span><h3>Licence rules <em>before</em> payment.</h3><p>Requested licence is checked against approval, rights scope, and contributor releases.</p><p className="pricing-note">Seller access: <strong>{assetPricingLabel(asset)}</strong></p></div><div className="checkout-controls"><label>Requested licence<select value={licenceType} onChange={(event) => setLicenceType(event.target.value as LicenceType)}>{licences.map((licence) => <option key={licence} value={licence}>{licence[0].toUpperCase() + licence.slice(1)}</option>)}</select></label><button className={validation.allowed && asset.monetizationModel !== "custom_quote" ? "approve-button" : "blocked-button"} onClick={onCheckout}>{validation.allowed && asset.monetizationModel !== "custom_quote" ? "Continue to checkout ↗" : asset.monetizationModel === "custom_quote" ? "Request custom quote" : "Checkout blocked"}</button></div><div className="checkout-checks">{validation.checks.map((check) => <div key={check.label}><span className={check.passed ? "check-pass" : "check-fail"}>{check.passed ? "✓" : "×"}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div></div></article>;
}

function Evidence({ label, status }: { label: string; status: Asset["modelReleaseStatus"] }) { return <div className="evidence-row"><span className={`evidence-icon ${status}`}>{status === "verified" ? "✓" : status === "pending" ? "!" : "—"}</span><span><strong>{label}</strong><small>{status === "verified" ? "Document verified" : status === "not_required" ? "Not required" : status === "pending" ? "Evidence needs review" : "No document attached"}</small></span><b>{status.replace("_", " ")}</b></div>; }

function AssetPricingFields({ asset, setAsset }: { asset: { monetizationModel: MonetizationModel; licensePriceZar: string }; setAsset: (asset: any) => void }) {
  return <div className="asset-pricing-fields"><label>How should this asset be sold?<select value={asset.monetizationModel} onChange={(event) => setAsset({ ...asset, monetizationModel: event.target.value as MonetizationModel })}><option value="membership">Membership access</option><option value="individual_license">Sell an individual licence</option><option value="custom_quote">Custom quote for premium work</option></select></label>{asset.monetizationModel === "individual_license" && <label>Annual licence price (ZAR)<input required min="1" step="0.01" type="number" value={asset.licensePriceZar} onChange={(event) => setAsset({ ...asset, licensePriceZar: event.target.value })} placeholder="e.g. 2500" /><small className="field-help">Your price is used for a standard one-year licence. Rights and releases still need editorial approval.</small></label>}{asset.monetizationModel === "custom_quote" && <small className="field-help">Buyers will be asked to contact you for a bespoke price instead of checking out immediately.</small>}</div>;
}

function ContributorWorkspace({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [form, setForm] = useState({ bio: "", organisationName: "", location: "", contributorType: "individual", equipment: "", portfolioUrl: "", acceptTerms: false });
  const [asset, setAsset] = useState({ kind: "image", title: "", description: "", caption: "", city: "", province: "", locality: "", landmark: "", subjectTags: "", culturalTags: "", rightsStatus: "pending", modelReleaseStatus: "unknown", propertyReleaseStatus: "unknown", monetizationModel: "membership" as MonetizationModel, licensePriceZar: "" });
  const [file, setFile] = useState<File | null>(null);
  const [seller, setSeller] = useState({ signerName: "", signatureReference: "", provider: "stripe_connect", providerAccountId: "", accountHolderName: "", accountLast4: "", branchLast4: "" });
  const [turnstileToken, setTurnstileToken] = useState("");
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
      const walletResponse = await api("/api/onboarding/wallet", { method: "POST", body: JSON.stringify({ provider: seller.provider, providerAccountId: seller.providerAccountId || undefined, accountHolderName: seller.accountHolderName, accountLast4: seller.accountLast4 || undefined, branchLast4: seller.branchLast4 || undefined, currency: "ZAR" }) });
      if (!walletResponse.ok) throw new Error("wallet");
      const contractResponse = await api("/api/onboarding/contract", { method: "POST", body: JSON.stringify({ signerName: seller.signerName, signatureMethod: "firma", signatureReference: seller.signatureReference, turnstileToken: turnstileToken || undefined }) });
      if (!contractResponse.ok) throw new Error("contract");
      onNotice("Contract signed and tender submitted. Complete KYC documents before admin approval.");
    } catch { onNotice("Seller workflow needs the 0005 migration, a configured Turnstile secret, and provider wallet credentials."); } finally { setSaving(false); }
  }

  return <main className="workspace-page"><div className="workspace-intro"><span className="section-kicker">CONTRIBUTOR WORKSPACE</span><h1>Keep the <em>context.</em></h1><p>Submit a record with the location, rights, and cultural context an editor needs to trust it.</p></div><div className="workspace-grid"><form className="workspace-card" onSubmit={saveOnboarding}><div className="card-heading"><span className="section-kicker">01 · PROFILE</span><span className="status-pill">Draft</span></div><h2>Your contributor profile</h2><label>Organisation or public name<input value={form.organisationName} onChange={(event) => setForm({ ...form, organisationName: event.target.value })} /></label><label>Biography<textarea value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} /></label><div className="two-fields"><label>Contributor type<select value={form.contributorType} onChange={(event) => setForm({ ...form, contributorType: event.target.value })}><option value="individual">Individual</option><option value="agency">Agency</option><option value="archive">Archive</option><option value="institution">Institution</option></select></label><label>Base location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label></div><label>Portfolio URL<input value={form.portfolioUrl} onChange={(event) => setForm({ ...form, portfolioUrl: event.target.value })} placeholder="https://…" /></label><label className="checkbox-row"><input type="checkbox" checked={form.acceptTerms} onChange={(event) => setForm({ ...form, acceptTerms: event.target.checked })} /> I accept the contributor terms</label><button className="dark-button" disabled={saving}>Save profile <span>↗</span></button></form>
    <form className="workspace-card" onSubmit={submitSellerWorkflow}><div className="card-heading"><span className="section-kicker">02 · SELLER SETUP</span><span className="status-pill warm">Pending tender</span></div><h2>Sign terms & set payout</h2><p className="dialog-intro">Your signed terms hash, KYC case, and payout wallet are linked to one internal approval record. Raw bank credentials are never stored here.</p><label>Signer name<input required value={seller.signerName} onChange={(event) => setSeller({ ...seller, signerName: event.target.value })} /></label><label>Firma signature reference<input required minLength={8} value={seller.signatureReference} onChange={(event) => setSeller({ ...seller, signatureReference: event.target.value })} placeholder="Reference returned by Firma" /></label><div className="two-fields"><label>Payout rail<select value={seller.provider} onChange={(event) => setSeller({ ...seller, provider: event.target.value })}><option value="stripe_connect">Stripe Connect</option><option value="payfast">PayFast</option><option value="za_bank">South African bank adapter</option></select></label><label>Provider account ID<input value={seller.providerAccountId} onChange={(event) => setSeller({ ...seller, providerAccountId: event.target.value })} placeholder="Connected account / recipient reference" /></label></div><label>Account holder<input required value={seller.accountHolderName} onChange={(event) => setSeller({ ...seller, accountHolderName: event.target.value })} /></label><div className="two-fields"><label>Account last 4<input inputMode="numeric" pattern="\d{4}" value={seller.accountLast4} onChange={(event) => setSeller({ ...seller, accountLast4: event.target.value })} /></label><label>Branch last 4<input inputMode="numeric" pattern="\d{4}" value={seller.branchLast4} onChange={(event) => setSeller({ ...seller, branchLast4: event.target.value })} /></label></div><TurnstileChallenge onToken={setTurnstileToken} /><label className="checkbox-row"><input type="checkbox" required /> I agree to the current Contributor Terms of Service and authorize this digital signature record.</label><button className="dark-button" disabled={saving}>Submit seller tender <span>↗</span></button></form>
    <form className="workspace-card" onSubmit={createAsset}><div className="card-heading"><span className="section-kicker">02 · INGESTION</span><span className="status-pill warm">Needs review</span></div><h2>Submit a record</h2><AssetPricingFields asset={asset} setAsset={setAsset} /><div className="two-fields"><label>Media type<select value={asset.kind} onChange={(event) => setAsset({ ...asset, kind: event.target.value })}><option value="image">Photography</option><option value="video">Film & video</option></select></label><label>File<input type="file" accept="image/*,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label></div><label>Title<input required value={asset.title} onChange={(event) => setAsset({ ...asset, title: event.target.value })} placeholder="A precise, human title" /></label><label>Caption<textarea value={asset.caption} onChange={(event) => setAsset({ ...asset, caption: event.target.value })} placeholder="What is actually happening in the frame?" /></label><div className="two-fields"><label>City<input value={asset.city} onChange={(event) => setAsset({ ...asset, city: event.target.value })} /></label><label>Locality<input value={asset.locality} onChange={(event) => setAsset({ ...asset, locality: event.target.value })} placeholder="Cape Flats, Bo-Kaap…" /></label></div><label>Subject tags<input value={asset.subjectTags} onChange={(event) => setAsset({ ...asset, subjectTags: event.target.value })} placeholder="people, food, community" /></label><label>Cultural context tags<input value={asset.culturalTags} onChange={(event) => setAsset({ ...asset, culturalTags: event.target.value })} placeholder="South African braai, wood-fire braai" /></label><div className="two-fields"><label>Rights<select value={asset.rightsStatus} onChange={(event) => setAsset({ ...asset, rightsStatus: event.target.value })}><option value="pending">Pending verification</option><option value="editorial_only">Editorial only</option><option value="verified">Verified</option></select></label><label>Model release<select value={asset.modelReleaseStatus} onChange={(event) => setAsset({ ...asset, modelReleaseStatus: event.target.value })}><option value="unknown">Unknown</option><option value="not_required">Not required</option><option value="pending">Pending</option><option value="verified">Verified</option></select></label></div><button className="dark-button" disabled={saving || !asset.title}>{saving ? "Submitting…" : "Submit for review"} <span>↗</span></button></form></div></main>;
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

function AssetCard({ asset, index, onOpen }: { asset: Asset; index: number; onOpen: (asset: Asset) => void }) { const explanation = asset.matchExplanation ?? archiveDomain.buildMatchExplanation(asset); return <article className={`asset-card card-${index + 1}`} onClick={() => onOpen(asset)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onOpen(asset); }}><div className={`asset-visual visual-${index + 1} ${asset.kind}`}><div className="visual-overlay"><span>{asset.kind === "video" ? "▶" : "V"}</span><span>{asset.kind === "video" ? "01:24" : "4K"}</span></div><div className="visual-place">{asset.landmark ?? asset.locality ?? asset.city}</div></div><div className="asset-info"><div><h3>{asset.title}</h3><p>{asset.city}, {asset.province}</p><span className={`confidence-chip ${archiveDomain.confidenceLabel(explanation.matchConfidence)}`}>{archiveDomain.percent(explanation.matchConfidence)}% match</span><small className="asset-pricing-label">{assetPricingLabel(asset)}</small></div><span className={`status-dot ${asset.humanVerified ? "verified" : "review"}`} title={asset.humanVerified ? "Human verified" : "Needs editor review"} /></div></article>; }

function AssetModal({ asset, onClose, onNotice }: { asset: Asset; onClose: () => void; onNotice: (notice: string) => void }) {
  const explanation = asset.matchExplanation ?? archiveDomain.buildMatchExplanation(asset);
  const model = asset.monetizationModel ?? "membership";
  const requestLabel = model === "custom_quote" ? "Request custom quote" : model === "individual_license" ? "Request individual licence" : "Request membership access";
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-title" onClick={(event) => event.stopPropagation()}><button className="close-button" onClick={onClose} aria-label="Close">×</button><div className={`modal-visual ${asset.kind}`}><span>{asset.kind === "video" ? "▶" : "V"}</span></div><div className="modal-copy"><span className="section-kicker">{asset.kind === "video" ? "FILM & VIDEO" : "PHOTOGRAPHY"} · {asset.city}</span><h2 id="asset-title">{asset.title}</h2><p>{asset.caption || asset.description}</p><div className="tag-list">{asset.culturalTags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="match-box"><div className="card-heading"><span className="section-kicker">WHY THIS MATCHED</span><strong>{archiveDomain.percent(explanation.matchConfidence)}% {archiveDomain.confidenceLabel(explanation.matchConfidence)}</strong></div>{explanation.signals.slice(0, 3).map((signal) => <p key={signal.label}><b>{signal.label}:</b> {signal.detail}</p>)}<small>{explanation.metadataReviewNote}</small></div><div className="rights-summary"><span>Rights: <b>{asset.rightsStatus}</b></span><span>Authenticity: <b>{archiveDomain.percent(asset.authenticityConfidence)}%</b></span><span>Access: <b>{assetPricingLabel(asset)}</b></span></div><div className="modal-actions"><button className="dark-button" onClick={() => onNotice("Sign in and open the governance workspace to request a licence.")}>{requestLabel} <span>↗</span></button><button className="ghost-button" onClick={() => onNotice("Lightbox saving is not available until an authenticated workspace is connected.")}>Save to lightbox</button></div></div></div></div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
