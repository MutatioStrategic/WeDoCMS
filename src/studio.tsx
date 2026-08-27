import React, { useEffect, useMemo, useRef, useState } from "react";
import { CampaignEditor } from "./studio-campaign-editor";
import { downloadBlob } from "./studio-export";
import { ImageEditor } from "./studio-image-editor";
import type { ImageEdit, StudioMode, StudioSource } from "./studio-types";
import type { Asset } from "./shared";
import { StockvelLogo } from "./ui";

type StudioWorkspaceProps = {
  assets: Asset[];
  api: (path: string, init?: RequestInit) => Promise<Response>;
  onNotice: (notice: string) => void;
  notice: string;
};

function safeMediaUrl(value: string | null | undefined): string | null {
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

function sourceFromAsset(asset: Asset): StudioSource {
  const safeTitle = asset.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "archive-photo";
  return {
    id: asset.id,
    title: asset.title,
    kind: "image",
    duration: 5,
    previewUrl: safeMediaUrl(asset.previewUrl),
    sourceFileName: asset.sourceFileName ?? `${safeTitle}.jpg`,
  };
}

function localSource(file: File): StudioSource {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: file.name.replace(/\.[^.]+$/, "") || "Uploaded photo",
    kind: "image",
    duration: 5,
    previewUrl: URL.createObjectURL(file),
    sourceFileName: file.name || "uploaded-photo.jpg",
  };
}

function isLocalSource(source: StudioSource): boolean {
  return source.id.startsWith("local-");
}

export function StudioWorkspace({ assets, api, onNotice, notice }: StudioWorkspaceProps) {
  const archiveSources = useMemo(() => assets.filter((asset) => asset.kind === "image").map(sourceFromAsset), [assets]);
  const [localSources, setLocalSources] = useState<StudioSource[]>([]);
  const allSources = useMemo(() => [...archiveSources, ...localSources], [archiveSources, localSources]);
  const imageIds = useMemo(() => new Set(allSources.map((source) => source.id)), [allSources]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [archiveAddId, setArchiveAddId] = useState(archiveSources[0]?.id ?? "");
  const [mode, setMode] = useState<StudioMode>("photo");
  const [editingPhoto, setEditingPhoto] = useState(false);
  const [campaignName, setCampaignName] = useState("Untitled campaign");
  const [campaignBrief, setCampaignBrief] = useState("");
  const [campaignResetToken, setCampaignResetToken] = useState(0);
  const [campaignDownloadToken, setCampaignDownloadToken] = useState(0);
  const [editedImages, setEditedImages] = useState<Map<string, ImageEdit>>(() => new Map());
  const selectionSeededRef = useRef(false);
  const localSourcesRef = useRef<StudioSource[]>([]);
  const editedImagesRef = useRef<Map<string, ImageEdit>>(new Map());

  useEffect(() => {
    setArchiveAddId((current) => current && archiveSources.some((source) => source.id === current) && !selectedIds.includes(current)
      ? current
      : archiveSources.find((source) => !selectedIds.includes(source.id))?.id ?? "");
  }, [archiveSources, selectedIds]);

  useEffect(() => {
    setSelectedIds((current) => {
      const valid = current.filter((id) => imageIds.has(id));
      if (!selectionSeededRef.current && valid.length === 0 && allSources[0]) {
        selectionSeededRef.current = true;
        return [allSources[0].id];
      }
      return valid;
    });
    setActiveSourceId((current) => current && imageIds.has(current) ? current : allSources[0]?.id ?? null);
  }, [allSources, imageIds]);

  useEffect(() => { localSourcesRef.current = localSources; }, [localSources]);
  useEffect(() => { editedImagesRef.current = editedImages; }, [editedImages]);
  useEffect(() => () => {
    localSourcesRef.current.forEach((source) => { if (source.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(source.previewUrl); });
    editedImagesRef.current.forEach((edit) => { if (edit.previewUrl.startsWith("blob:")) URL.revokeObjectURL(edit.previewUrl); });
  }, []);

  const selectedSources = selectedIds.map((id) => allSources.find((source) => source.id === id)).filter((source): source is StudioSource => Boolean(source));
  const activeSource = allSources.find((source) => source.id === activeSourceId) ?? selectedSources[0] ?? null;
  const activeEdit = activeSource ? editedImages.get(activeSource.id) : undefined;
  const otherArchiveSources = archiveSources.filter((source) => !selectedIds.includes(source.id));

  function addSource(source: StudioSource) {
    if (selectedIds.includes(source.id)) {
      setActiveSourceId(source.id);
      onNotice(`${source.title} is already in this selection.`);
      return;
    }
    setSelectedIds((current) => [...current, source.id]);
    setActiveSourceId(source.id);
    onNotice(`${source.title} added. Add more photos or start editing.`);
  }

  function addArchiveSource() {
    const source = archiveSources.find((item) => item.id === archiveAddId);
    if (source) addSource(source);
  }

  function uploadPhotos(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const accepted = files.filter((file) => file.type.startsWith("image/") && file.size <= 25 * 1024 * 1024);
    const rejected = files.length - accepted.length;
    if (!accepted.length) {
      onNotice(rejected ? "Choose image files up to 25 MB each." : "Choose one or more photos to upload.");
      return;
    }
    const added = accepted.map(localSource);
    setLocalSources((current) => [...current, ...added]);
    setSelectedIds((current) => [...current, ...added.map((source) => source.id)]);
    setActiveSourceId(added[0].id);
    setMode("photo");
    setEditingPhoto(added.length === 1);
    onNotice(`${added.length} local photo${added.length === 1 ? "" : "s"} added${rejected ? `; ${rejected} file${rejected === 1 ? "" : "s"} skipped` : ""}.`);
  }

  function removeFromSelection(source: StudioSource) {
    setSelectedIds((current) => current.filter((id) => id !== source.id));
    if (activeSourceId === source.id) {
      const next = selectedIds.find((id) => id !== source.id);
      setActiveSourceId(next ?? null);
      setEditingPhoto(false);
    }
    if (isLocalSource(source)) {
      setLocalSources((current) => current.filter((item) => item.id !== source.id));
      if (source.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(source.previewUrl);
    }
    setEditedImages((current) => {
      const edit = current.get(source.id);
      if (edit?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(edit.previewUrl);
      const next = new Map(current);
      next.delete(source.id);
      return next;
    });
  }

  function saveImageEdit(edit: ImageEdit) {
    setEditedImages((current) => {
      const previous = current.get(edit.sourceId);
      if (previous?.previewUrl.startsWith("blob:") && previous.previewUrl !== edit.previewUrl) URL.revokeObjectURL(previous.previewUrl);
      const next = new Map(current);
      next.set(edit.sourceId, edit);
      return next;
    });
  }

  async function downloadCurrent() {
    if (!activeSource) {
      onNotice("Choose a photo first, then download the current selection.");
      return;
    }
    if (activeEdit) {
      downloadBlob(activeEdit.blob, activeEdit.fileName);
      onNotice(`${activeEdit.fileName} downloaded.`);
      return;
    }
    if (activeSource.previewUrl?.startsWith("blob:")) {
      try {
        const response = await fetch(activeSource.previewUrl);
        if (response.ok) {
          downloadBlob(await response.blob(), activeSource.sourceFileName);
          onNotice(`${activeSource.sourceFileName} downloaded.`);
          return;
        }
      } catch {
        onNotice("The local photo is no longer available. Upload it again to continue.");
        return;
      }
    } else {
      try {
        const response = await api(`/api/assets/${encodeURIComponent(activeSource.id)}/original`, { redirect: "manual" });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("Location");
          if (location) {
            window.location.assign(location);
            return;
          }
        }
        if (response.ok) {
          downloadBlob(await response.blob(), activeSource.sourceFileName);
          onNotice(`${activeSource.sourceFileName} downloaded.`);
          return;
        }
        const body = await response.json().catch(() => ({})) as { error?: string };
        onNotice(body.error ?? "This original is not available for download yet. Check access and try again.");
        return;
      } catch {
        onNotice("The download service is unavailable. Try again when the archive is connected.");
        return;
      }
    }
    onNotice("This photo could not be downloaded. Choose another asset or try again.");
  }

  function startNewCampaign() {
    setCampaignName("Untitled campaign");
    setCampaignBrief("");
    setCampaignResetToken((token) => token + 1);
    setCampaignDownloadToken(0);
    setMode("campaign");
    setEditingPhoto(false);
    onNotice("New campaign ready. Your selected photos are still available below.");
  }

  function editActivePhoto() {
    if (!activeSource) {
      onNotice("Choose or upload a photo before opening the photo editor.");
      return;
    }
    setMode("photo");
    setCampaignDownloadToken(0);
    setEditingPhoto(true);
  }

  return <main className="minimal-studio-page">
    <section className="minimal-studio" aria-labelledby="media-studio-heading">
      <header className="minimal-studio-header">
        <div className="studio-header-brand"><StockvelLogo markOnly /><span>STOCKVEL MEDIA STUDIO</span></div>
        <div><span className="section-kicker">MEDIA STUDIO</span><h1 id="media-studio-heading">Make a campaign. Keep it simple.</h1><p>Choose a photo for a quick edit, or collect several images into a clean campaign page you can download and use anywhere.</p></div>
        <span className="studio-local-note">Browser edits only · archive originals stay protected</span>
      </header>

      <p className="studio-notice" role="status" aria-live="polite">{notice}</p>

      <nav className="studio-primary-actions" aria-label="Studio actions">
        <button type="button" className="outline-button" onClick={startNewCampaign}>New campaign</button>
        <button type="button" className={mode === "photo" ? "dark-button" : "outline-button"} onClick={editActivePhoto}>Edit photo</button>
        <button type="button" className={mode === "campaign" ? "dark-button" : "outline-button"} onClick={() => { setMode("campaign"); setCampaignDownloadToken(0); setEditingPhoto(false); }}>Campaign editor</button>
        <button type="button" className="studio-download-button" disabled={mode === "photo" && !activeSource} onClick={() => mode === "campaign" ? setCampaignDownloadToken((token) => token + 1) : void downloadCurrent()}>{mode === "campaign" ? "Download campaign ZIP" : activeEdit ? "Download edited image" : "Download selected photo"} <span aria-hidden="true">↓</span></button>
      </nav>

      <div className="studio-mode-tabs" role="tablist" aria-label="Choose a studio workflow">
        <button type="button" role="tab" aria-selected={mode === "photo"} className={mode === "photo" ? "active" : ""} onClick={() => { setMode("photo"); setEditingPhoto(false); }}>1. Quick photo edit</button>
        <button type="button" role="tab" aria-selected={mode === "campaign"} className={mode === "campaign" ? "active" : ""} onClick={() => { setMode("campaign"); setCampaignDownloadToken(0); setEditingPhoto(false); }}>2. Build a campaign</button>
      </div>

      <section className="studio-media-picker" aria-labelledby="media-picker-heading">
        <div className="studio-section-heading"><div><span className="section-kicker">CHOOSE YOUR MEDIA</span><h2 id="media-picker-heading">Add one photo or several.</h2><p>Selected photos become campaign images. There is no four-photo limit.</p></div><span className="studio-selection-count">{selectedSources.length} selected</span></div>
        <div className="studio-picker-controls">
          <label>Archive photo<select value={archiveAddId} onChange={(event) => setArchiveAddId(event.target.value)} disabled={!otherArchiveSources.length}><option value="">{otherArchiveSources.length ? "Choose an archive photo" : "All archive photos selected"}</option>{otherArchiveSources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label>
          <button type="button" className="outline-button" disabled={!archiveAddId || !otherArchiveSources.length} onClick={addArchiveSource}>Add photo</button>
          <label className="studio-upload-button">Upload photos<input type="file" accept="image/*" multiple onChange={uploadPhotos} /></label>
        </div>
        <p className="studio-help-text">Archive downloads still go through access and licence checks. Local uploads stay in this browser until you close the page.</p>
        {selectedSources.length ? <div className="studio-selected-sources" aria-label="Selected photos">{selectedSources.map((source, index) => <article className={`studio-selected-source ${source.id === activeSource?.id ? "active" : ""}`} key={source.id}><button type="button" className="studio-selected-source-main" onClick={() => { setActiveSourceId(source.id); setEditingPhoto(false); }}><span className="studio-source-number">{String(index + 1).padStart(2, "0")}</span>{source.previewUrl ? <img src={editedImages.get(source.id)?.previewUrl ?? source.previewUrl} alt="" /> : <span className="studio-source-placeholder">No preview</span>}<span><strong>{source.title}</strong><small>{editedImages.has(source.id) ? "Edited version ready" : isLocalSource(source) ? "Local upload" : "Archive preview"}</small></span></button><button type="button" className="studio-remove-source" aria-label={`Remove ${source.title} from selection`} onClick={() => removeFromSelection(source)}>×</button></article>)}</div> : <div className="studio-selection-empty"><strong>Nothing selected yet.</strong><span>Add an archive photo or upload one or more local photos to begin.</span></div>}
      </section>

      {mode === "photo" && (editingPhoto && activeSource ? <ImageEditor source={activeSource} existing={activeEdit} onSaved={saveImageEdit} onClose={() => setEditingPhoto(false)} onNotice={onNotice} /> : <section className="studio-photo-start" aria-labelledby="photo-start-heading"><div>{activeSource?.previewUrl ? <img src={editedImages.get(activeSource.id)?.previewUrl ?? activeSource.previewUrl} alt={activeSource.title} /> : <div className="studio-photo-start-placeholder">Choose a photo to see its preview.</div>}</div><div><span className="section-kicker">QUICK PHOTO EDIT</span><h2 id="photo-start-heading">{activeSource ? activeSource.title : "Start with one photo."}</h2><p>{activeSource ? "Crop, resize, apply a basic filter, add optional marketing text, then save or download." : "This is the fastest path for a one-off social image or manual handoff."}</p><button type="button" className="dark-button" disabled={!activeSource} onClick={editActivePhoto}>Open photo editor <span aria-hidden="true">→</span></button></div></section>)}

      {mode === "campaign" && <section className="studio-campaign-flow" aria-labelledby="campaign-details-heading"><div className="studio-campaign-details"><div><span className="section-kicker">CAMPAIGN DETAILS</span><h2 id="campaign-details-heading">Name it, then shape it.</h2><p>The details travel with the ZIP so a manual handoff remains understandable.</p></div><div className="studio-campaign-fields"><label>Campaign name<input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} /></label><label>Short brief <span className="optional-label">(optional)</span><textarea value={campaignBrief} onChange={(event) => setCampaignBrief(event.target.value)} rows={3} placeholder="What should this campaign help people do?" /></label></div></div><CampaignEditor campaignName={campaignName} campaignBrief={campaignBrief} sources={selectedSources} editedImages={editedImages} resetToken={campaignResetToken} downloadToken={campaignDownloadToken} onNotice={onNotice} /></section>}
    </section>
  </main>;
}
