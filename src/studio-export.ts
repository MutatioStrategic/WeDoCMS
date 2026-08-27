import type { ImageEdit, StudioSource } from "./studio-types";

export function safeFileName(value: string, fallback = "download"): string {
  const cleaned = value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return !cleaned || /^[.]+$/.test(cleaned) ? fallback : cleaned;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFileName(fileName);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * GrapesJS is configured without scripts, but exports are still sanitised at
 * the boundary. This keeps a future block/plugin from turning a campaign
 * preview into an executable document.
 */
export function sanitizeHtml(markup: string): string {
  if (typeof DOMParser === "undefined") {
    return markup
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (attribute) => /expression\s*\(|javascript:/i.test(attribute) ? "" : attribute)
      .replace(/\s(?:src|href)\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, "");
  }
  const documentNode = new DOMParser().parseFromString(markup, "text/html");
  documentNode.querySelectorAll("script, iframe, object, embed, form, link, base").forEach((node) => node.remove());
  documentNode.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const value = attribute.value.trim().toLowerCase();
      if (attribute.name.toLowerCase().startsWith("on") || ((attribute.name === "src" || attribute.name === "href" || attribute.name === "srcset") && value.startsWith("javascript:"))) {
        element.removeAttribute(attribute.name);
      } else if (attribute.name === "style") {
        const safeStyle = sanitizeCss(attribute.value);
        if (safeStyle) element.setAttribute("style", safeStyle);
        else element.removeAttribute("style");
      }
    });
  });
  return documentNode.body.innerHTML;
}

export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[\s\S]*?;/gi, "")
    .replace(/expression\s*\(/gi, "")
    .replace(/url\(\s*(['"]?)\s*javascript:[\s\S]*?\1\s*\)/gi, "none");
}

function extensionFor(blob: Blob, sourceName: string): string {
  const sourceExtension = sourceName.match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1];
  if (sourceExtension) return sourceExtension.toLowerCase() === "jpeg" ? "jpg" : sourceExtension.toLowerCase();
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/webp") return "webp";
  if (blob.type === "image/avif") return "avif";
  return "png";
}

function imageName(source: StudioSource, blob: Blob, used: Set<string>): string {
  const base = safeFileName(source.sourceFileName.replace(/\.[^.]+$/, ""), "image");
  const extension = extensionFor(blob, source.sourceFileName);
  let name = `images/${base}.${extension}`;
  let index = 2;
  while (used.has(name)) name = `images/${base}-${index++}.${extension}`;
  used.add(name);
  return name;
}

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const base = typeof window === "undefined" ? "http://localhost/" : window.location.href;
    const resolvedUrl = new URL(url, base);
    const sameOrigin = typeof window !== "undefined" && resolvedUrl.origin === window.location.origin;
    const response = await fetch(resolvedUrl.href, { credentials: sameOrigin ? "include" : "omit" });
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export async function buildCampaignZip(input: {
  campaignName: string;
  html: string;
  css: string;
  sources: StudioSource[];
  editedImages: Map<string, ImageEdit>;
}): Promise<{ blob: Blob; fileCount: number; missingImages: number }> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const usedNames = new Set<string>();
  let html = sanitizeHtml(input.html);
  let missingImages = 0;

  for (const source of input.sources) {
    const edited = input.editedImages.get(source.id);
    const blob = edited?.blob ?? (source.previewUrl ? await fetchBlob(source.previewUrl) : null);
    if (!blob) {
      missingImages += 1;
      continue;
    }
    const path = imageName(source, blob, usedNames);
    zip.file(path, await blob.arrayBuffer());
    if (source.previewUrl) html = html.split(source.previewUrl).join(path);
    if (edited?.previewUrl) html = html.split(edited.previewUrl).join(path);
  }

  const imageUrls = [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const imageUrl of [...new Set(imageUrls)]) {
    if (/^(data:|https?:\/\/|blob:)/i.test(imageUrl) === false) continue;
    if (/^data:/i.test(imageUrl) || !imageUrl) continue;
    const blob = await fetchBlob(imageUrl);
    if (!blob) { missingImages += 1; continue; }
    const synthetic: StudioSource = { id: imageUrl, title: "Campaign image", kind: "image", previewUrl: imageUrl, sourceFileName: "campaign-image.png", duration: 0 };
    const path = imageName(synthetic, blob, usedNames);
    zip.file(path, await blob.arrayBuffer());
    html = html.split(imageUrl).join(path);
  }

  const campaignName = input.campaignName.trim() || "Untitled campaign";
  zip.file("index.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtmlText(campaignName)}</title><link rel="stylesheet" href="styles.css"></head><body>${html}</body></html>`);
  zip.file("styles.css", sanitizeCss(input.css));
  zip.file("campaign.json", JSON.stringify({ name: campaignName, exportedAt: new Date().toISOString(), sourceCount: input.sources.length, missingImages }, null, 2));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { blob, fileCount: Object.keys(zip.files).length, missingImages };
}

export async function exportCampaignZip(input: {
  campaignName: string;
  html: string;
  css: string;
  sources: StudioSource[];
  editedImages: Map<string, ImageEdit>;
}): Promise<{ fileCount: number; missingImages: number }> {
  const result = await buildCampaignZip(input);
  downloadBlob(result.blob, `${safeFileName(input.campaignName.trim() || "Untitled campaign", "campaign")}.zip`);
  return { fileCount: result.fileCount, missingImages: result.missingImages };
}
