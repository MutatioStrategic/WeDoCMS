import React, { useEffect, useMemo, useState } from "react";
import type { Asset } from "./shared";

type StudioTool = "trim" | "audio" | "captions" | "branding" | "reframe";
type ReviewStage = "draft" | "internal_review" | "client_approved" | "final_export";
type QualityProfile = "web_compressed" | "social_high" | "print_image" | "archive_master";
type JobStatus = "queued" | "processing" | "completed" | "failed";
type PlatformPreset = { id: string; label: string; group: string; width: number; height: number; note: string };
type RenderJob = { id: string; presetId: string; status: JobStatus; progress: number; createdAt: string };

const presets: PlatformPreset[] = [
  { id: "instagram-reel", label: "Instagram Reel", group: "Short-form", width: 1080, height: 1920, note: "9:16" },
  { id: "tiktok", label: "TikTok", group: "Short-form", width: 1080, height: 1920, note: "9:16" },
  { id: "youtube-shorts", label: "YouTube Shorts", group: "Short-form", width: 1080, height: 1920, note: "9:16" },
  { id: "youtube-thumbnail", label: "YouTube thumbnail", group: "Video thumbnail", width: 1280, height: 720, note: "16:9" },
  { id: "linkedin-square", label: "LinkedIn square", group: "LinkedIn", width: 1080, height: 1080, note: "1:1" },
  { id: "linkedin-portrait", label: "LinkedIn portrait", group: "LinkedIn", width: 1080, height: 1350, note: "4:5" },
  { id: "linkedin-landscape", label: "LinkedIn landscape", group: "LinkedIn", width: 1920, height: 1080, note: "16:9" },
  { id: "facebook-feed", label: "Facebook feed", group: "Facebook", width: 1200, height: 1500, note: "4:5" },
  { id: "facebook-story", label: "Facebook story", group: "Facebook", width: 1080, height: 1920, note: "9:16" },
  { id: "google-display", label: "Google Display", group: "Ads", width: 1200, height: 628, note: "1.91:1" },
  { id: "web-hero", label: "Web hero video", group: "Web", width: 1920, height: 800, note: "12:5" },
];
const qualityProfiles: Array<{ id: QualityProfile; label: string; note: string }> = [
  { id: "web_compressed", label: "Web compressed", note: "Fast playback, smaller files" },
  { id: "social_high", label: "Social high quality", note: "Platform-ready H.264" },
  { id: "print_image", label: "Print image", note: "PNG/JPEG still export" },
  { id: "archive_master", label: "Archive master", note: "Highest quality derivative" },
];
const demoSource = { id: "demo-source", title: "Garden Route road study", kind: "video" as const, duration: 34, previewUrl: null as string | null, sourceFileName: "garden-route-road-study.mp4" };

function ratioClass(preset: PlatformPreset): string {
  const ratio = preset.width / preset.height;
  if (ratio < 0.75) return "portrait";
  if (ratio > 1.5) return "wide";
  if (Math.abs(ratio - 1) < 0.08) return "square";
  return "standard";
}
function presetById(id: string): PlatformPreset { return presets.find((preset) => preset.id === id) ?? presets[0]; }
function sourceFromAsset(asset: Asset) { return { id: asset.id, title: asset.title, kind: asset.kind, duration: asset.mediaDurationSeconds ?? 34, previewUrl: asset.previewUrl ?? null, sourceFileName: asset.sourceFileName ?? `${asset.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${asset.kind === "video" ? "mp4" : "jpg"}` }; }
function safeMediaUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === "blob:") return url.href;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.origin === window.location.origin)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function Toggle({ label, checked, onChange, note }: { label: string; checked: boolean; onChange: (value: boolean) => void; note?: string }) {
  return <label className="studio-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><b>{label}</b>{note && <small>{note}</small>}</span><i aria-hidden="true" /></label>;
}

export function StudioWorkspace({ assets, onNotice }: { assets: Asset[]; onNotice: (notice: string) => void }) {
  const sourceOptions = useMemo(() => [demoSource, ...assets.map(sourceFromAsset)], [assets]);
  const [sourceId, setSourceId] = useState(demoSource.id);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [localName, setLocalName] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState("instagram-reel");
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>(["instagram-reel", "tiktok", "youtube-shorts", "youtube-thumbnail"]);
  const [tool, setTool] = useState<StudioTool>("trim");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(28);
  const [muted, setMuted] = useState(false);
  const [replaceAudio, setReplaceAudio] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [burnedIn, setBurnedIn] = useState(true);
  const [captionStyle, setCaptionStyle] = useState("clean");
  const [logo, setLogo] = useState(false);
  const [intro, setIntro] = useState(false);
  const [outro, setOutro] = useState(false);
  const [subjectCentred, setSubjectCentred] = useState(true);
  const [detectObjects, setDetectObjects] = useState(true);
  const [safeZones, setSafeZones] = useState(true);
  const [coverFrame, setCoverFrame] = useState(42);
  const [reviewStage, setReviewStage] = useState<ReviewStage>("draft");
  const [quality, setQuality] = useState<QualityProfile>("social_high");
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [splitAt, setSplitAt] = useState(12);

  const selectedSource = sourceId === "local-upload" && localName ? { ...demoSource, id: "local-upload", title: localName, sourceFileName: localName } : sourceOptions.find((source) => source.id === sourceId) ?? demoSource;
  const activePreset = presetById(selectedPresetId);
  const sourceDuration = Math.max(1, selectedSource.duration);
  const outputCount = selectedPresetIds.length;

  useEffect(() => {
    if (!jobs.some((job) => job.status === "processing" || job.status === "queued")) return undefined;
    const timer = window.setInterval(() => setJobs((current) => current.map((job) => {
      if (job.status === "queued") return { ...job, status: "processing" };
      if (job.status !== "processing") return job;
      const progress = Math.min(100, job.progress + 17);
      return progress >= 100 ? { ...job, progress, status: "completed" } : { ...job, progress };
    })), 700);
    return () => window.clearInterval(timer);
  }, [jobs]);

  function updateSource(id: string) {
    setSourceId(id);
    setTrimStart(0);
    const next = sourceOptions.find((source) => source.id === id);
    setTrimEnd(Math.min(28, next?.duration ?? 28));
  }
  function uploadSource(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/")) { onNotice("Choose an image or video source file."); return; }
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalUrl(URL.createObjectURL(file)); setLocalName(file.name); setSourceId("local-upload"); setTrimStart(0); setTrimEnd(28);
  }
  function togglePreset(id: string) { setSelectedPresetIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function startRender() {
    if (!selectedPresetIds.length) { onNotice("Select at least one platform output before rendering."); return; }
    const newJobs = selectedPresetIds.map((presetId) => ({ id: `${presetId}-${Date.now()}`, presetId, status: "queued" as const, progress: 0, createdAt: new Date().toISOString() }));
    setJobs((current) => [...newJobs, ...current.filter((job) => !selectedPresetIds.includes(job.presetId) || job.status === "processing")]);
    setReviewStage("final_export"); onNotice(`${newJobs.length} derivative${newJobs.length === 1 ? "" : "s"} added to the render queue.`);
  }
  function retryJob(job: RenderJob) { setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: "queued", progress: 0 } : item)); onNotice(`${presetById(job.presetId).label} was returned to the render queue.`); }
  function exportCaptions(format: "SRT" | "VTT") { onNotice(`${format} caption export prepared for ${selectedSource.title}.`); }

  const sourcePreview = safeMediaUrl(sourceId === "local-upload" ? localUrl : selectedSource.previewUrl);
  const sourceIsImage = sourceId === "local-upload" ? Boolean(localName && /\.(jpe?g|png|webp|avif)$/i.test(localName)) : selectedSource.kind === "image";

  return <main className="studio-page">
    <div className="studio-intro"><div><span className="section-kicker">PHASE 04 · MEDIA FORMATTING STUDIO</span><h1>Make one source<br /><em>travel further.</em></h1><p>Trim once, protect the brand, and create every platform-ready derivative without touching the original.</p></div><div className="studio-intro-meta"><span className="status-pill cool">Original protected</span><small>Stream playback · R2 derivatives</small></div></div>
    <section className="studio-source-bar"><div><span className="section-kicker">SOURCE ASSET</span><select aria-label="Source asset" value={sourceId} onChange={(event) => updateSource(event.target.value)}>{sourceOptions.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}{localName && <option value="local-upload">{localName} · local preview</option>}</select></div><label className="outline-button studio-upload">Replace source preview<input type="file" accept="image/*,video/*" onChange={(event) => uploadSource(event.target.files?.[0])} /></label><div className="studio-source-facts"><span>{sourceIsImage ? "IMAGE" : "VIDEO"}</span><span>{Math.round(sourceDuration)} sec</span><span>{selectedSource.sourceFileName}</span></div></section>
    <section className="studio-preset-strip"><div className="studio-preset-heading"><span className="section-kicker">OUTPUT PRESETS</span><strong>{outputCount} selected</strong><small>Choose the formats for this batch.</small></div><div className="studio-preset-scroll">{presets.map((preset) => <button type="button" className={`studio-preset ${selectedPresetId === preset.id ? "active" : ""} ${selectedPresetIds.includes(preset.id) ? "checked" : ""}`} key={preset.id} onClick={() => { setSelectedPresetId(preset.id); togglePreset(preset.id); }}><span className="studio-preset-check">{selectedPresetIds.includes(preset.id) ? "✓" : "+"}</span><b>{preset.label}</b><small>{preset.note} · {preset.width}×{preset.height}</small></button>)}</div></section>
    <div className="studio-workbench">
      <aside className="studio-sidebar"><div className="studio-side-section"><span className="section-kicker">EDITING TOOLS</span>{(["trim", "audio", "captions", "branding", "reframe"] as StudioTool[]).map((item) => <button type="button" className={`studio-tool ${tool === item ? "active" : ""}`} key={item} onClick={() => setTool(item)}><span>{item === "trim" ? "01" : item === "audio" ? "02" : item === "captions" ? "03" : item === "branding" ? "04" : "05"}</span>{item === "trim" ? "Timeline & trim" : item === "audio" ? "Audio" : item === "captions" ? "Captions" : item === "branding" ? "Brand kit" : "Smart reframe"}<b>↗</b></button>)}</div><div className="studio-side-section studio-safety-card"><span className="section-kicker">BRAND SAFETY</span><h3>Keep the important bits visible.</h3><Toggle label="Safe zones" checked={safeZones} onChange={setSafeZones} note="Warn on text/logo collisions" /><Toggle label="Subject centred" checked={subjectCentred} onChange={setSubjectCentred} note="Crop follows the main subject" /><Toggle label="Face & object detect" checked={detectObjects} onChange={setDetectObjects} note="Uses source analysis when available" /></div></aside>
      <section className="studio-canvas-column"><div className="studio-canvas-header"><div><span className="section-kicker">LIVE PREVIEW</span><h2>{activePreset.label} <small>{activePreset.note}</small></h2></div><div className="studio-canvas-actions"><button type="button" className="ghost-button" onClick={() => onNotice("Cover frame saved to this project.")}>Save cover</button><button type="button" className="dark-button" onClick={startRender}>Render {outputCount} output{outputCount === 1 ? "" : "s"} <span>↗</span></button></div></div><div className={`studio-canvas ${ratioClass(activePreset)}`} style={{ "--studio-ratio": `${activePreset.width} / ${activePreset.height}` } as React.CSSProperties}>{sourcePreview && sourceIsImage && <img src={sourcePreview} alt="Source preview" />}{sourcePreview && !sourceIsImage && <video src={sourcePreview} muted={muted} playsInline autoPlay loop />}{!sourcePreview && <div className="studio-canvas-art"><span>{selectedSource.kind === "video" ? "▶" : "V"}</span><strong>{selectedSource.title}</strong><small>Source preview is protected</small></div>}{safeZones && <><div className="safe-zone safe-zone-outer" /><div className="safe-zone safe-zone-inner" /><span className="safe-zone-label">SAFE ZONE</span></>}{logo && <div className="studio-logo-mark">VELD</div>}{captions && <div className={`studio-caption-preview ${captionStyle}`}>The story is already here.</div>}<div className="studio-canvas-label">{activePreset.width} × {activePreset.height}</div></div><div className="studio-player-bar"><button type="button" onClick={() => onNotice("Preview playback is ready in the browser.")} aria-label="Play preview">▶</button><span>00:{String(Math.floor(trimStart)).padStart(2, "0")}</span><div className="studio-scrubber"><i style={{ left: `${(trimStart / sourceDuration) * 100}%`, right: `${100 - (trimEnd / sourceDuration) * 100}%` }} /></div><span>00:{String(Math.floor(trimEnd)).padStart(2, "0")}</span><button type="button" className="studio-icon-button" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Unmute" : "Mute"}>{muted ? "⌁" : "◖"}</button></div>
        <div className="studio-timeline"><div className="timeline-label"><span className="section-kicker">TIMELINE-LITE</span><span>{Math.max(0, trimEnd - trimStart)} sec selected</span></div><div className="timeline-track"><div className="timeline-filmstrip"><span>00:00</span><span>00:08</span><span>00:16</span><span>00:24</span><span>00:{String(Math.round(sourceDuration)).padStart(2, "0")}</span></div><div className="timeline-selection" style={{ left: `${(trimStart / sourceDuration) * 100}%`, width: `${((trimEnd - trimStart) / sourceDuration) * 100}%` }}><i /><i /></div><div className="timeline-split" style={{ left: `${(splitAt / sourceDuration) * 100}%` }}><span>split</span></div></div><div className="timeline-range"><label>In <input type="range" min="0" max={Math.max(1, trimEnd - 1)} value={trimStart} onChange={(event) => setTrimStart(Math.min(Number(event.target.value), trimEnd - 1))} /></label><label>Out <input type="range" min={Math.min(sourceDuration - 1, trimStart + 1)} max={sourceDuration} value={trimEnd} onChange={(event) => setTrimEnd(Math.max(Number(event.target.value), trimStart + 1))} /></label></div></div>
      </section>
      <aside className="studio-controls"><div className="studio-control-heading"><span className="section-kicker">{tool === "trim" ? "TIMELINE & TRIM" : tool === "audio" ? "AUDIO" : tool === "captions" ? "CAPTIONS" : tool === "branding" ? "BRAND KIT" : "SMART REFRAME"}</span><span className="studio-control-status">Autosaved</span></div>{tool === "trim" && <div className="studio-control-content"><h3>Shape the cut.</h3><p>Make a clean edit while the source stays untouched.</p><button type="button" className="outline-button" onClick={() => setSplitAt(Math.max(trimStart + 1, Math.min(trimEnd - 1, splitAt)))}>Split at {splitAt}s</button><div className="control-rule" /><Toggle label="Mute source audio" checked={muted} onChange={setMuted} /><Toggle label="Add intro slate" checked={intro} onChange={setIntro} note="Brand opener · 2.0 sec" /><Toggle label="Add outro slate" checked={outro} onChange={setOutro} note="CTA end card · 3.0 sec" /><div className="control-field"><label>Cover frame <span>{coverFrame}%</span><input aria-label="Cover frame position" type="range" min="0" max="100" value={coverFrame} onChange={(event) => setCoverFrame(Number(event.target.value))} /></label></div></div>}{tool === "audio" && <div className="studio-control-content"><h3>Make it sound right.</h3><p>Use the original track, replace it, or export silent.</p><Toggle label="Mute source audio" checked={muted} onChange={setMuted} /><Toggle label="Replace audio" checked={replaceAudio} onChange={setReplaceAudio} note="Upload track at render time" />{replaceAudio && <label className="studio-file-field">Choose audio<input type="file" accept="audio/*" /></label>}<div className="audio-wave"><span>◒</span><div><b>{replaceAudio ? "Replacement track" : "Original source track"}</b><small>{muted ? "Muted for this batch" : "Audio will be mixed into output"}</small></div></div></div>}{tool === "captions" && <div className="studio-control-content"><h3>Say it clearly.</h3><p>Generate captions once, then style them across every output.</p><button type="button" className="dark-button" onClick={() => { setCaptions(true); onNotice("Auto-transcription queued for this source."); }}>Auto-transcribe <span>↗</span></button><Toggle label="Burn captions into video" checked={burnedIn} onChange={setBurnedIn} note="Always visible on social exports" /><label className="studio-select-field">Subtitle style<select value={captionStyle} onChange={(event) => setCaptionStyle(event.target.value)}><option value="clean">Clean lower-third</option><option value="bold">Bold social</option><option value="editorial">Editorial serif</option></select></label><div className="studio-export-row"><button type="button" className="outline-button" onClick={() => exportCaptions("SRT")}>Export SRT</button><button type="button" className="outline-button" onClick={() => exportCaptions("VTT")}>Export VTT</button></div></div>}{tool === "branding" && <div className="studio-control-content"><h3>Make it unmistakably yours.</h3><p>Apply the approved brand treatment to every derivative.</p><Toggle label="Add Veld logo" checked={logo} onChange={setLogo} note="Safe-zone checked" /><Toggle label="Add intro slate" checked={intro} onChange={setIntro} /><Toggle label="Add outro slate" checked={outro} onChange={setOutro} /><label className="studio-select-field">Logo position<select><option>Bottom right</option><option>Bottom left</option><option>Top right</option></select></label><div className="brand-lock"><span>✓</span><div><b>Brand kit locked</b><small>Veld Archive · approved by internal review</small></div></div></div>}{tool === "reframe" && <div className="studio-control-content"><h3>Let the crop follow the story.</h3><p>Subject-aware framing protects people, objects, text, and logos.</p><Toggle label="Keep subject centred" checked={subjectCentred} onChange={setSubjectCentred} /><Toggle label="Detect faces & objects" checked={detectObjects} onChange={setDetectObjects} /><Toggle label="Warn outside safe zones" checked={safeZones} onChange={setSafeZones} /><div className="reframe-score"><strong>{safeZones && subjectCentred ? "92" : "74"}%</strong><span>safe framing confidence</span></div></div>}</aside>
    </div>
    <section className="studio-export-section"><div className="studio-section-heading"><div><span className="section-kicker">BATCH FORMAT</span><h2>One source. Every useful size.</h2></div><div className="studio-export-options"><label>Quality profile<select value={quality} onChange={(event) => setQuality(event.target.value as QualityProfile)}>{qualityProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label><label>Review stage<select value={reviewStage} onChange={(event) => setReviewStage(event.target.value as ReviewStage)}><option value="draft">Draft</option><option value="internal_review">Internal review</option><option value="client_approved">Client approved</option><option value="final_export">Final export</option></select></label></div></div><div className="studio-output-grid">{selectedPresetIds.length ? selectedPresetIds.map((id) => { const preset = presetById(id); const latest = jobs.find((job) => job.presetId === id); return <article className="studio-output-card" key={id}><div className={`studio-output-thumb ${ratioClass(preset)}`}><span>{preset.note}</span><small>{preset.width}×{preset.height}</small></div><div><b>{preset.label}</b><small>{qualityProfiles.find((profile) => profile.id === quality)?.label} · {reviewStage.replace("_", " ")}</small></div><span className={`studio-output-status ${latest?.status ?? "ready"}`}>{latest ? `${latest.progress}%` : "Ready"}</span></article>; }) : <div className="studio-empty-output">Select outputs above to build a batch.</div>}</div></section>
    <section className="studio-queue-section"><div className="studio-section-heading"><div><span className="section-kicker">RENDER QUEUE</span><h2>Keep working while exports finish.</h2></div><span className="studio-queue-note">Tracked derivatives · originals remain private</span></div>{jobs.length ? <div className="studio-queue-list">{jobs.map((job) => { const preset = presetById(job.presetId); return <article className="studio-queue-item" key={job.id}><div className={`queue-status-dot ${job.status}`} /><div><b>{preset.label}</b><small>{preset.note} · {qualityProfiles.find((profile) => profile.id === quality)?.label}</small></div><div className="studio-progress"><span style={{ width: `${job.progress}%` }} /></div><strong>{job.status === "completed" ? "Complete" : job.status === "failed" ? "Failed" : `${job.progress}%`}</strong>{job.status === "completed" && <button type="button" className="outline-button" onClick={() => onNotice(`${preset.label} derivative is ready for review.`)}>Preview</button>}{job.status === "failed" && <button type="button" className="outline-button" onClick={() => retryJob(job)}>Retry</button>}</article>; })}</div> : <div className="studio-empty-queue"><span>✦</span><div><b>No renders yet</b><small>Choose a batch above and render when your review state is ready.</small></div><button type="button" className="dark-button" onClick={startRender}>Start first render <span>↗</span></button></div>}</section>
  </main>;
}
