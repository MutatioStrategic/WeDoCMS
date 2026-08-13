import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CommunityOverview, RightsCase, TakedownReason } from "./shared";

type ThreadPost = { id: string; body: string; author: string; createdAt: string };
type MediationMessage = { id: string; authorId: string; authorName: string; body: string; visibility: string; createdAt: string };

const emptyCommunity: CommunityOverview = { forums: [], threads: [], showcases: [], collections: [] };
const reasons: Record<TakedownReason, string> = { copyright: "Copyright ownership", consent: "Consent or release", cultural_harm: "Cultural harm or misrepresentation", privacy: "Privacy or safety", metadata: "Incorrect metadata", other: "Something else" };

function ThreadDetail({ threadId, title, api, onNotice, onClose, canModerate }: { threadId: string; title: string; api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; onClose: () => void; canModerate: boolean }) {
  const [posts, setPosts] = useState<ThreadPost[]>([]);
  const [reply, setReply] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await api(`/api/community/threads/${threadId}/posts`);
      if (!response.ok) throw new Error();
      const data = await response.json() as { results: ThreadPost[] };
      setPosts(data.results);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  }, [api, threadId]);

  useEffect(() => { void load(); }, [load]);

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      const response = await api(`/api/community/threads/${threadId}/posts`, { method: "POST", body: JSON.stringify({ body: reply.trim() }) });
      if (!response.ok) throw new Error();
      setReply("");
      await load();
    } catch {
      onNotice("Sign in to reply to this discussion.");
    } finally {
      setSending(false);
    }
  }

  async function moderate(postId: string, action: "hide" | "restore") {
    try {
      const response = await api(`/api/admin/community/posts/${postId}/moderate`, { method: "POST", body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error();
      await load();
    } catch {
      onNotice("Could not moderate this post.");
    }
  }

  return <div className="thread-detail" role="dialog" aria-label={`Discussion: ${title}`}>
    <div className="panel-heading"><span className="section-kicker">DISCUSSION</span><h3>{title}</h3><button type="button" className="text-button" onClick={onClose}>Close</button></div>
    {state === "loading" && <p className="community-status" role="status">Loading replies…</p>}
    {state === "unavailable" && <p className="community-status community-status-error" role="alert">Replies are unavailable right now.</p>}
    {state === "ready" && <ul className="thread-posts">{posts.length ? posts.map((post) => <li key={post.id}><strong>{post.author}</strong><p>{post.body}</p><small>{new Date(post.createdAt).toLocaleString("en-ZA")}</small>{canModerate && <button type="button" className="text-button" onClick={() => void moderate(post.id, "hide")}>Hide</button>}</li>) : <li className="empty-state">No replies yet. Be the first to respond.</li>}</ul>}
    <form className="inline-form" onSubmit={sendReply}><textarea required value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Share a considered reply…" maxLength={2000} /><button type="submit" className="dark-button" disabled={sending}>{sending ? "Posting…" : "Post reply"}</button></form>
  </div>;
}

function RightsCaseInbox({ api, onNotice }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void }) {
  const [cases, setCases] = useState<RightsCase[]>([]);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MediationMessage[]>([]);
  const [reply, setReply] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  const loadCases = useCallback(async () => {
    try {
      const response = await api("/api/rights/cases");
      if (!response.ok) throw new Error();
      setCases(await response.json() as RightsCase[]);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  }, [api]);

  useEffect(() => { void loadCases(); }, [loadCases]);

  async function openCase(caseId: string) {
    setOpenCaseId(caseId);
    try {
      const response = await api(`/api/rights/cases/${caseId}/messages`);
      if (!response.ok) throw new Error();
      const data = await response.json() as { results: MediationMessage[] };
      setMessages(data.results);
    } catch {
      setMessages([]);
      onNotice("Mediation messages are unavailable for this case.");
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!openCaseId || !reply.trim()) return;
    try {
      const response = await api(`/api/rights/cases/${openCaseId}/messages`, { method: "POST", body: JSON.stringify({ body: reply.trim() }) });
      if (!response.ok) throw new Error();
      setReply("");
      await openCase(openCaseId);
    } catch {
      onNotice("This message could not be sent. Mediation may not be active for this case.");
    }
  }

  if (state === "unavailable") return null;
  if (state === "ready" && !cases.length) return null;

  return <section className="rights-inbox" aria-label="My rights cases">
    <div className="card-heading"><div><span className="section-kicker">MY RIGHTS CASES</span><h2>Track your <em>open cases.</em></h2></div></div>
    <div className="rank-list">{cases.map((rightsCase) => <div className="rank-row" key={rightsCase.id}><strong>{rightsCase.assetTitle}</strong><span>{rightsCase.status}</span>{rightsCase.mediationRequested && <button type="button" className="text-button" onClick={() => void openCase(rightsCase.id)}>{openCaseId === rightsCase.id ? "Hide messages" : "Open mediation"}</button>}</div>)}</div>
    {openCaseId && <div className="thread-detail" role="dialog" aria-label="Mediation messages">
      <ul className="thread-posts">{messages.length ? messages.map((message) => <li key={message.id}><strong>{message.authorName}</strong><p>{message.body}</p><small>{new Date(message.createdAt).toLocaleString("en-ZA")}</small></li>) : <li className="empty-state">No messages yet in this mediation room.</li>}</ul>
      <form className="inline-form" onSubmit={sendReply}><textarea required value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a mediation message…" maxLength={2000} /><button type="submit" className="dark-button">Send</button></form>
    </div>}
  </section>;
}

function CurationDesk({ api, onNotice, refresh }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; refresh: () => Promise<void> }) {
  const [kind, setKind] = useState<"showcases" | "collections">("showcases");
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [records, setRecords] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const load = useCallback(async () => { try { const response = await api("/api/admin/community/curation"); if (!response.ok) throw new Error(); const data = await response.json() as { showcases: Array<{ id: string; title: string; status: string }>; collections: Array<{ id: string; title: string; status: string }> }; setRecords(data[kind]); } catch { onNotice("Editorial curation is unavailable right now."); } }, [api, kind, onNotice]);
  useEffect(() => { void load(); }, [load]);
  async function create(event: FormEvent) { event.preventDefault(); try { const response = await api(`/api/admin/community/${kind}`, { method: "POST", body: JSON.stringify({ title, description, status: "draft" }) }); if (!response.ok) throw new Error(); setTitle(""); setDescription(""); await load(); onNotice("Editorial record saved as a draft."); } catch { onNotice("Could not save this editorial record."); } }
  async function change(id: string, method: "PATCH" | "DELETE", payload?: Record<string, unknown>) { try { const response = await api(`/api/admin/community/${kind}/${id}`, { method, body: payload ? JSON.stringify(payload) : undefined }); if (!response.ok) throw new Error(); await load(); await refresh(); } catch { onNotice("Could not update this editorial record."); } }
  return <section className="rights-inbox" aria-label="Editorial curation"><div className="card-heading"><div><span className="section-kicker">EDITORIAL CURATION</span><h2>Publish a <em>considered edit.</em></h2></div></div><div className="filter-tabs" role="tablist" aria-label="Curation type"><button type="button" role="tab" aria-selected={kind === "showcases"} className={kind === "showcases" ? "active" : ""} onClick={() => setKind("showcases")}>Showcases</button><button type="button" role="tab" aria-selected={kind === "collections"} className={kind === "collections" ? "active" : ""} onClick={() => setKind("collections")}>Collections</button></div><form className="inline-form" onSubmit={create}><label>Title<input required minLength={3} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Description<textarea required minLength={10} value={description} onChange={(event) => setDescription(event.target.value)} /></label><button type="submit" className="dark-button">Save draft</button></form><div className="rank-list">{records.map((record) => <div className="rank-row" key={record.id}><strong>{record.title}</strong><span>{record.status}</span><button type="button" className="text-button" onClick={() => void change(record.id, "PATCH", { status: record.status === "published" ? "draft" : "published" })}>{record.status === "published" ? "Unpublish" : "Publish"}</button><button type="button" className="text-button" onClick={() => void change(record.id, "DELETE")}>Remove</button></div>)}</div></section>;
}

export function CommunityWorkspace({ api, onNotice, sessionUser }: { api: (path: string, init?: RequestInit) => Promise<Response>; onNotice: (notice: string) => void; sessionUser: { role: string } | null }) {
  const [data, setData] = useState(emptyCommunity);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [caseOpen, setCaseOpen] = useState(false);
  const [caseId, setCaseId] = useState("");
  const [reason, setReason] = useState<TakedownReason>("copyright");
  const [summary, setSummary] = useState("");
  const [mediation, setMediation] = useState(true);
  const [assetId, setAssetId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [overviewState, setOverviewState] = useState<"loading" | "ready" | "unavailable">("loading");

  const loadOverview = useCallback(async () => {
    setOverviewState("loading");
    try {
      const response = await api("/api/community/overview");
      if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) throw new Error("Community API unavailable");
      setData(await response.json() as CommunityOverview);
      setOverviewState("ready");
    } catch {
      setOverviewState("unavailable");
      onNotice("Community content is unavailable right now. Rights cases still require sign-in and a working API.");
    }
  }, [api, onNotice]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  async function lodge(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFeedback("");
    try {
      const response = await api("/api/rights/takedown", { method: "POST", body: JSON.stringify({ assetId, reason, summary, mediationRequested: mediation }) });
      if (!response.ok) throw new Error("The case was not accepted by the server.");
      const record = await response.json() as { id: string };
      const message = `Case ${record.id} lodged. Response target: 5 working days.`;
      setCaseId(record.id);
      setFeedback(message);
      onNotice(message);
    } catch {
      const message = "The case was not lodged. Sign in, check the asset ID, and try again.";
      setFeedback(message);
      onNotice(message);
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="community-page">
    <section className="workspace-intro"><span className="section-kicker">COMMUNITY & COLLECTIONS</span><h1>Make the archive<br /><em>with us.</em></h1><p>Contributor forums, editorial showcases, and region-led collections keep the people and places behind the work visible.</p>{overviewState === "loading" && <p className="community-status" role="status">Loading community spaces…</p>}{overviewState === "unavailable" && <div className="community-status community-status-error" role="alert"><span>Community spaces are temporarily unavailable. Your resolution case form is still available below.</span><button type="button" className="text-button" onClick={() => void loadOverview()}>Retry community content</button></div>}</section>
    <section className="community-section"><div className="section-heading"><div><span className="section-kicker">CONTRIBUTOR FORUMS</span><h2>Knowledge is <em>shared.</em></h2></div><p className="section-intro">Moderated spaces for practical exchange, rights questions, and paid opportunities.</p></div><div className="community-layout"><div className="forum-list">{data.forums.map((forum) => <article className="forum-card" key={forum.id}><div className="forum-icon" aria-hidden="true">✳</div><div><h3>{forum.name}</h3><p>{forum.description}</p><span>{forum.topicCount} topics · {forum.postCount} posts</span></div></article>)}</div><div className="thread-panel"><div className="panel-heading"><span className="section-kicker">DISCUSSIONS TO START WITH</span><button type="button" className="text-button" onClick={() => onNotice("Sign in to start a moderated community discussion.")}>Start a discussion <span aria-hidden="true">↗</span></button></div>{data.threads.map((thread) => <button type="button" className="thread-row" key={thread.id} onClick={() => setOpenThreadId(thread.id)}><span className="thread-marker" aria-hidden="true">{thread.featured ? "★" : "·"}</span><span><strong>{thread.title}</strong><small>{thread.excerpt}</small><small>{thread.author} · {thread.replies} replies · {thread.lastActivity}</small></span><span aria-hidden="true">↗</span></button>)}{openThreadId && <ThreadDetail threadId={openThreadId} title={data.threads.find((thread) => thread.id === openThreadId)?.title ?? "Discussion"} api={api} onNotice={onNotice} onClose={() => setOpenThreadId(null)} canModerate={sessionUser?.role === "editor" || sessionUser?.role === "admin"} />}</div></div></section>
    <section className="showcase-section"><div className="section-heading"><div><span className="section-kicker">EDITORIAL & COMMUNITY EDITS</span><h2>Stories with a <em>point of view.</em></h2></div><p className="section-intro">Curated showcases give context a front seat. Featured collections make regions easier to discover.</p></div><div className="showcase-grid">{data.showcases.map((showcase, index) => <button type="button" className={`showcase-card showcase-${index + 1}`} key={showcase.id} onClick={() => onNotice(`${showcase.title} — ${showcase.theme} showcase by ${showcase.curator}.`)}><span className="collection-art" aria-hidden="true"><span>{index === 0 ? "after / rain" : "long / way"}</span></span><span className="showcase-copy"><small>{showcase.theme}</small><strong>{showcase.title}</strong><span>{showcase.description}</span><em>Curated by {showcase.curator} ↗</em></span></button>)}</div><div className="collection-heading"><span className="section-kicker">FEATURED SOUTH AFRICAN COLLECTIONS</span><span>Updated monthly with contributor review</span></div><div className="collection-grid">{data.collections.map((collection) => <button type="button" className="collection-card" key={collection.id} onClick={() => onNotice(`${collection.title}: ${collection.assetCount} assets from ${collection.contributorCount} contributors.`)}><span className="collection-label">{collection.featuredLabel}</span><h3>{collection.title}</h3><p>{collection.description}</p><span className="collection-meta">{collection.location} <span aria-hidden="true">·</span> {collection.assetCount} assets <span aria-hidden="true">·</span> {collection.contributorCount} contributors</span></button>)}</div></section>
    <section className="resolution-section"><div><span className="section-kicker">RIGHTS & CARE</span><h2>Resolve it with<br /><em>context.</em></h2></div><div><p>Each concern gets a case ID, evidence record, response window, and optional independent mediation room. Nothing disappears into an inbox.</p><div className="resolution-steps"><div><strong>01</strong><span>Lodge & preserve</span><small>Evidence and visibility are recorded.</small></div><div><strong>02</strong><span>Review together</span><small>Contributor response within 5 working days.</small></div><div><strong>03</strong><span>Mediate or appeal</span><small>A neutral facilitator can join the case.</small></div></div><button type="button" className="dark-button" aria-expanded={caseOpen} aria-controls="rights-form" onClick={() => setCaseOpen((open) => !open)}>{caseOpen ? "Close case form" : "Open a resolution case"} <span aria-hidden="true">↗</span></button></div></section>
    {(sessionUser?.role === "editor" || sessionUser?.role === "admin") && <CurationDesk api={api} onNotice={onNotice} refresh={loadOverview} />}
    <RightsCaseInbox api={api} onNotice={onNotice} />
    {caseOpen && <section id="rights-form" className="rights-modal rights-inline" aria-labelledby="rights-form-title">{caseId ? <div className="case-confirmation"><span className="case-check" aria-hidden="true">✓</span><span className="section-kicker">CASE LODGED</span><h2 id="rights-form-title">Your concern has a<br /><em>clear next step.</em></h2><p>Keep this case ID for follow-up. Mediation requested: {mediation ? "yes" : "no"}.</p><div className="case-id"><span>Case ID</span><strong>{caseId}</strong></div><button type="button" className="dark-button" onClick={() => { setCaseId(""); setCaseOpen(false); }}>Done</button></div> : <form onSubmit={lodge}><span className="section-kicker">STRUCTURED TAKEDOWN / DISPUTE</span><h2 id="rights-form-title">Open a resolution<br /><em>case.</em></h2><p className="dialog-intro">Share the context and requested remedy. The archive preserves the record and notifies the relevant contributor.</p><div className="form-grid"><div className="field"><label htmlFor="rights-asset">Asset ID</label><input id="rights-asset" required value={assetId} onChange={(event) => setAssetId(event.target.value)} placeholder="Paste the asset ID" /></div><div className="field"><label htmlFor="rights-reason">Reason</label><select id="rights-reason" value={reason} onChange={(event) => setReason(event.target.value as TakedownReason)}>{Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field field-wide"><label htmlFor="rights-summary">What should the review team know?</label><textarea id="rights-summary" required minLength={20} maxLength={2000} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Share the context, evidence, or requested remedy…" /><small>{summary.length}/2000 characters</small></div><label className="mediation-toggle"><input type="checkbox" checked={mediation} onChange={(event) => setMediation(event.target.checked)} /><span><b>Invite mediation</b><small>Request a neutral facilitator and private message room if the case needs a conversation.</small></span></label></div><p className="form-feedback" role="status" aria-live="polite">{feedback}</p><div className="dialog-footer"><span>Response target: 5 working days</span><button type="submit" className="dark-button" disabled={submitting}>{submitting ? "Lodging…" : "Lodge case"} <span aria-hidden="true">↗</span></button></div></form>}</section>}
  </main>;
}
