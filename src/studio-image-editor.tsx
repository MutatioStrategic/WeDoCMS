import React, { useEffect, useRef, useState } from "react";
import { downloadBlob, safeFileName } from "./studio-export";
import type { ImageEdit, ImageFilter, ImageFormat, ImageOverlay, ImageOverlayAlign, ImageOverlayPosition, ImageOverlayStyle, StudioSource } from "./studio-types";

type ImageRatio = "original" | "square" | "portrait" | "story" | "landscape";
type CropperInstance = import("cropperjs").default;

const ratios: Record<ImageRatio, { label: string; ratio: number | null; width: number; height: number }> = {
  original: { label: "Original", ratio: null, width: 0, height: 0 },
  square: { label: "Square - 1:1", ratio: 1, width: 1200, height: 1200 },
  portrait: { label: "Portrait - 4:5", ratio: 4 / 5, width: 1080, height: 1350 },
  story: { label: "Story - 9:16", ratio: 9 / 16, width: 1080, height: 1920 },
  landscape: { label: "Landscape - 16:9", ratio: 16 / 9, width: 1600, height: 900 },
};

const filters: Array<{ id: ImageFilter; label: string; css: string }> = [
  { id: "none", label: "Original", css: "none" },
  { id: "soft", label: "Soft", css: "saturate(0.9) contrast(0.96) brightness(1.04)" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.04)" },
  { id: "contrast", label: "Contrast", css: "contrast(1.12) saturate(1.05)" },
];

const overlayStyles: Record<ImageOverlayStyle, { label: string; family: string; weight: number; italic?: boolean }> = {
  clean: { label: "Clean", family: "Arial, sans-serif", weight: 600 },
  editorial: { label: "Editorial", family: "Georgia, serif", weight: 500, italic: true },
  impact: { label: "Impact", family: "Arial Black, Arial, sans-serif", weight: 800 },
};

const defaultOverlay: ImageOverlay = {
  text: "",
  style: "clean",
  position: "bottom",
  align: "center",
  color: "light",
  background: true,
};

function fileNameFor(source: StudioSource, format: ImageFormat): string {
  const base = safeFileName(source.sourceFileName.replace(/\.[^.]+$/, ""), "edited-photo");
  return `${base}-edited.${format === "image/jpeg" ? "jpg" : "png"}`;
}

function drawMarketingText(context: CanvasRenderingContext2D, width: number, height: number, overlay: ImageOverlay): void {
  const text = overlay.text.trim();
  if (!text) return;
  const style = overlayStyles[overlay.style];
  const fontSize = Math.max(24, Math.round(Math.min(width, height) * (overlay.style === "impact" ? 0.055 : 0.045)));
  const lineHeight = Math.round(fontSize * 1.18);
  const maxWidth = Math.max(140, Math.round(width * 0.78));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  context.save();
  context.font = `${style.italic ? "italic " : ""}${style.weight} ${fontSize}px ${style.family}`;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  const padding = Math.round(fontSize * 0.55);
  const blockHeight = lines.length * lineHeight + padding * 2;
  const blockWidth = Math.min(maxWidth, Math.max(...lines.map((item) => context.measureText(item).width)) + padding * 2);
  const margin = Math.round(width * 0.11);
  const x = overlay.align === "left" ? margin : overlay.align === "right" ? width - margin : width / 2;
  const left = overlay.align === "left" ? x - padding : overlay.align === "right" ? x - blockWidth + padding : x - blockWidth / 2;
  const top = overlay.position === "top" ? Math.round(height * 0.09) : overlay.position === "middle" ? Math.round((height - blockHeight) / 2) : Math.round(height * 0.86 - blockHeight);
  if (overlay.background) {
    context.fillStyle = overlay.color === "light" ? "rgba(12, 20, 17, 0.74)" : "rgba(255, 253, 249, 0.78)";
    context.fillRect(Math.max(0, left), Math.max(0, top), Math.min(blockWidth, width), blockHeight);
  }
  context.fillStyle = overlay.color === "light" ? "#fffdf9" : "#172019";
  context.textAlign = overlay.align;
  context.textBaseline = "top";
  lines.forEach((item, index) => context.fillText(item, x, top + padding + index * lineHeight, maxWidth));
  context.restore();
}

function ratioForExisting(edit: ImageEdit | undefined): ImageRatio {
  if (!edit || !edit.width || !edit.height) return "original";
  const ratio = edit.width / edit.height;
  if (Math.abs(ratio - 1) < 0.04) return "square";
  if (Math.abs(ratio - 4 / 5) < 0.04) return "portrait";
  if (Math.abs(ratio - 9 / 16) < 0.04) return "story";
  if (Math.abs(ratio - 16 / 9) < 0.04) return "landscape";
  return "original";
}

export function ImageEditor({ source, existing, onSaved, onClose, onNotice }: {
  source: StudioSource;
  existing?: ImageEdit;
  onSaved: (edit: ImageEdit) => void;
  onClose: () => void;
  onNotice: (notice: string) => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const cropperHostRef = useRef<HTMLDivElement>(null);
  const cropperRef = useRef<CropperInstance | null>(null);
  const [ratioId, setRatioId] = useState<ImageRatio>(() => ratioForExisting(existing));
  const [format, setFormat] = useState<ImageFormat>(() => existing?.format ?? "image/png");
  const [filterId, setFilterId] = useState<ImageFilter>(() => existing?.filter ?? "none");
  const [overlayText, setOverlayText] = useState(existing?.overlay?.text ?? "");
  const [overlayStyle, setOverlayStyle] = useState<ImageOverlayStyle>(existing?.overlay?.style ?? defaultOverlay.style);
  const [overlayPosition, setOverlayPosition] = useState<ImageOverlayPosition>(existing?.overlay?.position ?? defaultOverlay.position);
  const [overlayAlign, setOverlayAlign] = useState<ImageOverlayAlign>(existing?.overlay?.align ?? defaultOverlay.align);
  const [overlayColor, setOverlayColor] = useState<"light" | "dark">(existing?.overlay?.color ?? defaultOverlay.color);
  const [overlayBackground, setOverlayBackground] = useState(existing?.overlay?.background ?? defaultOverlay.background);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRatioId(ratioForExisting(existing));
    setFormat(existing?.format ?? "image/png");
    setFilterId(existing?.filter ?? "none");
    setOverlayText(existing?.overlay?.text ?? "");
    setOverlayStyle(existing?.overlay?.style ?? defaultOverlay.style);
    setOverlayPosition(existing?.overlay?.position ?? defaultOverlay.position);
    setOverlayAlign(existing?.overlay?.align ?? defaultOverlay.align);
    setOverlayColor(existing?.overlay?.color ?? defaultOverlay.color);
    setOverlayBackground(existing?.overlay?.background ?? defaultOverlay.background);
  }, [existing, source.id]);

  useEffect(() => {
    let active = true;
    const image = imageRef.current;
    if (!image || !source.previewUrl) {
      setStatus("unavailable");
      return undefined;
    }
    setStatus("loading");
    const onLoad = async () => {
      try {
        const { default: Cropper } = await import("cropperjs");
        if (!active || !image) return;
        cropperRef.current?.destroy();
        const cropper = new Cropper(image, { container: cropperHostRef.current ?? undefined });
        cropperRef.current = cropper;
        setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
        const selection = cropper.getCropperSelection();
        if (selection) {
          selection.initialCoverage = 0.82;
          selection.aspectRatio = ratios[ratioId].ratio ?? image.naturalWidth / image.naturalHeight;
          selection.$center();
        }
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    };
    const onError = () => { if (active) setStatus("unavailable"); };
    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
    image.crossOrigin = "anonymous";
    image.src = source.previewUrl;
    if (image.complete && image.naturalWidth > 0) void onLoad();
    return () => {
      active = false;
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      cropperRef.current?.destroy();
      cropperRef.current = null;
    };
  }, [source.id, source.previewUrl]);

  useEffect(() => {
    const selection = cropperRef.current?.getCropperSelection();
    const ratio = ratios[ratioId].ratio;
    if (selection && ratio) {
      selection.aspectRatio = ratio;
      selection.$center();
    }
  }, [ratioId]);

  async function savePhoto(shouldDownload: boolean) {
    if (status !== "ready" || !imageSize.width || !imageSize.height) {
      onNotice("This photo preview is not ready to edit yet.");
      return;
    }
    setBusy(true);
    try {
      const selectedRatio = ratios[ratioId];
      const outputWidth = selectedRatio.width || imageSize.width;
      const outputHeight = selectedRatio.height || imageSize.height;
      const selection = cropperRef.current?.getCropperSelection();
      if (!selection) throw new Error("Crop selection unavailable");
      const filter = filters.find((item) => item.id === filterId)?.css ?? "none";
      const cropped = await selection.$toCanvas({
        width: outputWidth,
        height: outputHeight,
        beforeDraw: (context) => { context.filter = filter; },
      });
      const output = document.createElement("canvas");
      output.width = outputWidth;
      output.height = outputHeight;
      const { default: createPica } = await import("pica");
      const resizer = createPica();
      await resizer.resize(cropped, output, { filter: "lanczos3" });
      const overlay: ImageOverlay = { text: overlayText, style: overlayStyle, position: overlayPosition, align: overlayAlign, color: overlayColor, background: overlayBackground };
      const outputContext = output.getContext("2d");
      if (!outputContext) throw new Error("Canvas context unavailable");
      drawMarketingText(outputContext, outputWidth, outputHeight, overlay);
      const blob = await resizer.toBlob(output, format, format === "image/jpeg" ? 0.92 : undefined);
      const edit: ImageEdit = {
        sourceId: source.id,
        blob,
        previewUrl: URL.createObjectURL(blob),
        fileName: fileNameFor(source, format),
        format,
        width: outputWidth,
        height: outputHeight,
        filter: filterId,
        overlay,
      };
      onSaved(edit);
      if (shouldDownload) downloadBlob(blob, edit.fileName);
      onNotice(shouldDownload ? `${edit.fileName} downloaded.` : "Photo edit saved to this campaign.");
    } catch {
      onNotice("The photo could not be processed. Try a smaller image or another preview.");
    } finally {
      setBusy(false);
    }
  }

  const activeFilter = filters.find((item) => item.id === filterId)?.css ?? "none";
  const activeOverlayStyle = overlayStyles[overlayStyle];
  const previewOverlayStyle: React.CSSProperties = {
    color: overlayColor === "light" ? "#fffdf9" : "#172019",
    background: overlayBackground ? overlayColor === "light" ? "rgba(12, 20, 17, .74)" : "rgba(255, 253, 249, .78)" : "transparent",
    fontFamily: activeOverlayStyle.family,
    fontStyle: activeOverlayStyle.italic ? "italic" : "normal",
    fontWeight: activeOverlayStyle.weight,
    textAlign: overlayAlign,
  };

  return <section className="studio-photo-editor" aria-labelledby="photo-editor-heading">
    <div className="studio-photo-editor-heading"><div><span className="section-kicker">SINGLE PHOTO EDIT</span><h2 id="photo-editor-heading">Make one clean change.</h2><p>{source.title} - the archive source remains untouched.</p></div><button type="button" className="ghost-button" onClick={onClose}>Back to workspace</button></div>
    <div className="studio-photo-editor-layout">
      <div className="studio-cropper-wrap"><div className="studio-cropper-host" ref={cropperHostRef}>{source.previewUrl && <img ref={imageRef} alt={`Crop ${source.title}`} style={{ filter: activeFilter }} />}{!source.previewUrl && <div className="studio-photo-unavailable">Preview unavailable</div>}</div>{status === "loading" && <p className="studio-editor-status" role="status">Loading photo editor...</p>}{status === "unavailable" && <p className="studio-editor-status error" role="alert">This photo preview is unavailable. Choose another asset or upload a local photo.</p>}{status === "error" && <p className="studio-editor-status error" role="alert">The photo editor could not load. Refresh and try again.</p>}</div>
      <div className="studio-photo-controls">
        <div className="studio-overlay-preview" aria-label="Marketing text export preview"><div>{source.previewUrl ? <img src={source.previewUrl} alt="" style={{ filter: activeFilter }} /> : <span>Preview unavailable</span>}{overlayText.trim() && <span className={`studio-overlay-preview-copy ${overlayPosition} ${overlayAlign}`} style={previewOverlayStyle}>{overlayText}</span>}</div><small>Approximate export preview</small></div>
        <label>Crop / resize<select value={ratioId} onChange={(event) => setRatioId(event.target.value as ImageRatio)}>{Object.entries(ratios).map(([id, ratio]) => <option key={id} value={id}>{ratio.label}</option>)}</select></label>
        <fieldset><legend>Basic filter</legend><div className="studio-filter-options">{filters.map((filter) => <label key={filter.id}><input type="radio" name={`photo-filter-${source.id}`} value={filter.id} checked={filterId === filter.id} onChange={() => setFilterId(filter.id)} /><span>{filter.label}</span></label>)}</div></fieldset>
        <fieldset className="studio-overlay-fields"><legend>Marketing text on export</legend><label>Text overlay <span className="optional-label">(optional)</span><textarea rows={3} value={overlayText} onChange={(event) => setOverlayText(event.target.value)} placeholder="Write a short campaign message" /></label><div className="studio-overlay-grid"><label>Text style<select value={overlayStyle} onChange={(event) => setOverlayStyle(event.target.value as ImageOverlayStyle)}>{Object.entries(overlayStyles).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label><label>Placement<select value={overlayPosition} onChange={(event) => setOverlayPosition(event.target.value as ImageOverlayPosition)}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label><label>Alignment<select value={overlayAlign} onChange={(event) => setOverlayAlign(event.target.value as ImageOverlayAlign)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Text colour<select value={overlayColor} onChange={(event) => setOverlayColor(event.target.value as "light" | "dark")}><option value="light">Light</option><option value="dark">Dark</option></select></label></div><label className="studio-checkbox-option"><input type="checkbox" checked={overlayBackground} onChange={(event) => setOverlayBackground(event.target.checked)} /> Add contrast panel behind text</label><small className="studio-control-note">This text is burned into the downloaded image and saved as part of this browser-only edit.</small></fieldset>
        <label>Download format<select value={format} onChange={(event) => setFormat(event.target.value as ImageFormat)}><option value="image/png">PNG - transparent-safe</option><option value="image/jpeg">JPEG - compact</option></select></label>
        {existing && <p className="studio-existing-edit" role="status">Saved edit ready - {existing.width} x {existing.height}</p>}
        <div className="studio-photo-actions"><button type="button" className="outline-button" disabled={busy || status !== "ready"} onClick={() => void savePhoto(false)}>{busy ? "Processing..." : "Save photo"}</button><button type="button" className="dark-button" disabled={busy || status !== "ready"} onClick={() => void savePhoto(true)}>Download image <span aria-hidden="true">↓</span></button></div>
      </div>
    </div>
  </section>;
}
