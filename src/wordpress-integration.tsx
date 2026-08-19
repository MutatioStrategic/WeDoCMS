import { useEffect, useState, type FormEvent } from "react";

type Api = (path: string, init?: RequestInit) => Promise<Response>;
type Connection = { id: string; site_url: string; site_name: string; token_prefix: string; plugin_version: string; status: string; last_seen_at?: string | null; created_at: string };
type Pairing = { pairingCode: string; siteUrl: string; expiresInSeconds: number; apiBaseUrl: string };

export function WordPressIntegrationPanel({ api, onNotice }: { api: Api; onNotice: (notice: string) => void }) {
  const [siteUrl, setSiteUrl] = useState("");
  const [siteName, setSiteName] = useState("");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadConnections() {
    const response = await api("/api/integrations/wordpress/connections");
    if (response.ok) setConnections((await response.json() as { results: Connection[] }).results);
  }

  useEffect(() => { void loadConnections(); }, []);

  async function createPairing(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api("/api/integrations/wordpress/pairing", { method: "POST", body: JSON.stringify({ siteUrl: siteUrl.trim(), siteName: siteName.trim() }) });
      const data = await response.json() as Pairing & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Pairing code could not be created.");
      setPairing(data);
      onNotice("WordPress pairing code created. It expires in ten minutes and can be used once.");
      await loadConnections();
    } catch (error) { onNotice(error instanceof Error ? error.message : "WordPress pairing failed."); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      const response = await api(`/api/integrations/wordpress/connections/${id}/revoke`, { method: "POST", body: "{}" });
      if (!response.ok) throw new Error("Connection could not be revoked.");
      onNotice("WordPress connector revoked. Existing attachments were left in place for review.");
      await loadConnections();
    } catch (error) { onNotice(error instanceof Error ? error.message : "WordPress revocation failed."); }
    finally { setBusy(false); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); onNotice("Copied to clipboard."); }
    catch { onNotice("Copy was blocked by the browser. Select the code manually."); }
  }

  return <main className="workspace-page"><div className="workspace-intro"><span className="section-kicker">WORDPRESS CONNECTOR</span><h1>Publish trusted imagery<br /><em>where your site lives.</em></h1><p>Connect a WordPress site to search approved Veld imagery, import licensed preview derivatives, and retain rights provenance without making WordPress the archive source of truth.</p></div>
    <div className="analytics-columns">
      <section className="workspace-card"><div className="card-heading"><span className="section-kicker">01 · PAIR A SITE</span><span className="status-pill cool">Single-use code</span></div><h2>Create a secure connection</h2><p>Enter the exact HTTPS site URL shown in WordPress. The code is stored as a hash, expires after ten minutes, and is exchanged for a token that is shown only once.</p><form onSubmit={(event) => void createPairing(event)}><label>WordPress site URL<input type="url" required value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://client-site.co.za" /></label><label>Site name<input maxLength={180} value={siteName} onChange={(event) => setSiteName(event.target.value)} placeholder="Client website" /></label><button className="dark-button" type="submit" disabled={busy}>{busy ? "Creating…" : "Create pairing code"} <span>↗</span></button></form>{pairing && <div className="match-box" style={{ marginTop: 20 }}><span className="section-kicker">PASTE INTO WORDPRESS</span><strong style={{ display: "block", fontSize: "1.35rem", letterSpacing: ".08em", margin: "8px 0" }}>{pairing.pairingCode}</strong><p>API base: <code>{pairing.apiBaseUrl}</code></p><button className="outline-button" type="button" onClick={() => void copy(pairing.pairingCode)}>Copy pairing code</button><small style={{ display: "block", marginTop: 10 }}>This code is not the long-lived connector token. WordPress exchanges it once.</small></div>}</section>
      <section className="workspace-card"><div className="card-heading"><span className="section-kicker">02 · RIGHTS BOUNDARY</span><span className="status-pill warm">Originals protected</span></div><h2>What the plugin can do</h2><ul><li>Search published, human-reviewed, preview-backed images.</li><li>Import only an active paid licence's preview derivative.</li><li>Record the asset, licence, variant, and WordPress attachment.</li><li>Warn administrators about expiry, withdrawal, and rights changes.</li></ul><p className="privacy-note">WordPress does not approve rights, create licences, receive originals, or silently delete customer content.</p></section>
    </div>
    <section className="review-queue"><div className="card-heading"><span className="section-kicker">CONNECTED SITES</span><span>{connections.length} connection{connections.length === 1 ? "" : "s"}</span></div>{connections.length ? connections.map((connection) => <article className="review-item" key={connection.id}><div className="review-copy"><div className="card-heading"><span className="section-kicker">{connection.site_name || "WordPress site"}</span><span className={`status-pill ${connection.status === "active" ? "cool" : "warm"}`}>{connection.status}</span></div><h2>{connection.site_url}</h2><p>Token prefix {connection.token_prefix} · plugin {connection.plugin_version || "unknown"} · last seen {connection.last_seen_at ? new Date(connection.last_seen_at).toLocaleString("en-ZA") : "not yet used"}</p>{connection.status === "active" && <button className="ghost-button danger-button" type="button" disabled={busy} onClick={() => void revoke(connection.id)}>Revoke connector</button>}</div></article>) : <div className="empty-state">No WordPress sites are connected to this organisation.</div>}</section>
  </main>;
}
