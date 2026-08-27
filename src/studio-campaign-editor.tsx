import React, { useEffect, useMemo, useRef, useState } from "react";
import { exportCampaignZip, sanitizeCss, sanitizeHtml } from "./studio-export";
import type { ImageEdit, StudioSource } from "./studio-types";

type CampaignEditorProps = {
  campaignName: string;
  campaignBrief: string;
  sources: StudioSource[];
  editedImages: Map<string, ImageEdit>;
  resetToken: number;
  downloadToken: number;
  onNotice: (notice: string) => void;
};

type GrapesEditor = import("grapesjs").Editor;

function appendBlock(block: import("grapesjs").Block, editor: GrapesEditor): void {
  editor.getWrapper()?.append(block.get("content") as never);
}

const campaignStyles = `
  * { box-sizing: border-box; }
  body { margin: 0; color: #24342b; background: #fffdf9; font-family: Arial, sans-serif; }
  .campaign-page { max-width: 760px; margin: 0 auto; padding: 42px 34px 64px; }
  .campaign-hero { padding: 28px; border-radius: 14px; background: #e7eee4; }
  .campaign-hero h1 { margin: 0 0 12px; font-size: 38px; line-height: 1.05; }
  .campaign-hero p { max-width: 560px; margin: 0; color: #526256; font-size: 16px; line-height: 1.5; }
  .campaign-gallery { display: grid; gap: 18px; margin-top: 24px; }
  .campaign-gallery figure { margin: 0; }
  .campaign-gallery img { display: block; width: 100%; max-height: 390px; border-radius: 10px; object-fit: cover; }
  .campaign-gallery figcaption { margin-top: 7px; color: #68756b; font-size: 12px; }
  .campaign-cta { display: inline-block; margin-top: 26px; border-radius: 999px; padding: 12px 18px; color: #fffdf9; background: #713620; text-decoration: none; }
`;

function escapeMarkup(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function sourceContentMarkup(sources: StudioSource[], editedImages: Map<string, ImageEdit>): string {
  if (!sources.length) {
    return `<p>Add photos from the media list to build this campaign.</p>`;
  }
  return sources.map((source) => {
    const title = escapeMarkup(source.title);
    const previewUrl = editedImages.get(source.id)?.previewUrl ?? source.previewUrl;
    const image = previewUrl
      ? `<img src="${escapeMarkup(previewUrl)}" alt="${title}">`
      : `<div class="campaign-missing-image">Preview unavailable for ${title}</div>`;
    return `<figure>${image}<figcaption>${title}</figcaption></figure>`;
  }).join("");
}

function sourceMarkup(sources: StudioSource[], editedImages: Map<string, ImageEdit>): string {
  return `<div class="campaign-gallery" data-studio-gallery>${sourceContentMarkup(sources, editedImages)}</div>`;
}

function initialMarkup(sources: StudioSource[], brief: string, editedImages: Map<string, ImageEdit>): string {
  const copy = escapeMarkup(brief.trim() || "Write a clear message for the people you want to reach.");
  return `<div class="campaign-page"><section class="campaign-hero"><h1>Campaign headline</h1><p>${copy}</p></section>${sourceMarkup(sources, editedImages)}<a class="campaign-cta" href="#">Call to action</a></div>`;
}

function previewDocument(html: string, css: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${sanitizeCss(css)}</style></head><body>${sanitizeHtml(html)}</body></html>`;
}

export function CampaignEditor({ campaignName, campaignBrief, sources, editedImages, resetToken, downloadToken, onNotice }: CampaignEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<GrapesEditor | null>(null);
  const readyRef = useRef(false);
  const changedRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const handledDownloadTokenRef = useRef(0);
  const sourceSignature = useMemo(() => sources.map((source) => `${source.id}:${source.previewUrl ?? ""}`).join("|"), [sources]);
  const editedSignature = useMemo(() => [...editedImages.entries()].map(([id, edit]) => `${id}:${edit.previewUrl}`).join("|"), [editedImages]);

  useEffect(() => {
    let active = true;
    readyRef.current = false;
    changedRef.current = false;
    setStatus("loading");
    setPreviewOpen(false);
    const host = hostRef.current;
    const blocks = blocksRef.current;
    if (!host || !blocks) return undefined;
    const blockKeyboardHandlers: Array<[HTMLElement, (event: KeyboardEvent) => void]> = [];

    void (async () => {
      try {
        const [{ default: grapesjs }] = await Promise.all([
          import("grapesjs"),
          import("grapesjs/dist/css/grapes.min.css"),
        ]);
        if (!active || !host || !blocks) return;
        const firstImage = sources.find((source) => source.kind === "image" && source.previewUrl);
        const editorConfig = {
          container: host,
          fromElement: false,
          height: "520px",
          storageManager: false,
          noticeOnUnload: false,
          allowScripts: false,
          panels: { defaults: [] },
          blockManager: {
            appendTo: blocks,
            blocks: [
              {
                id: "campaign-heading",
                label: "Heading",
                category: "Content",
                onClick: appendBlock,
                content: { type: "text", tagName: "h1", content: "Campaign headline" },
              },
              {
                id: "campaign-copy",
                label: "Text",
                category: "Content",
                onClick: appendBlock,
                content: { type: "text", tagName: "p", content: "Add a concise campaign message here." },
              },
              {
                id: "campaign-image",
                label: "Photo",
                category: "Content",
                onClick: appendBlock,
                content: { type: "image", src: firstImage?.previewUrl ?? "", attributes: { alt: firstImage?.title ?? "Campaign photo" } },
              },
              {
                id: "campaign-button",
                label: "Button",
                category: "Content",
                onClick: appendBlock,
                content: { type: "link", content: "Call to action", attributes: { href: "#" } },
              },
              {
                id: "campaign-section",
                label: "Section",
                category: "Layout",
                onClick: appendBlock,
                content: { type: "section", content: "Drop blocks here" },
              },
            ],
          },
        } as unknown as Parameters<typeof grapesjs.init>[0];
        const editor = grapesjs.init(editorConfig);
        editor.setStyle(campaignStyles);
        editor.setComponents(initialMarkup(sources, campaignBrief, editedImages));
        editor.on("component:update", () => { if (readyRef.current) changedRef.current = true; });
        editor.on("component:add", () => { if (readyRef.current) changedRef.current = true; });
        editor.on("component:remove", () => { if (readyRef.current) changedRef.current = true; });
        blocks.querySelectorAll<HTMLElement>(".gjs-block").forEach((blockElement) => {
          blockElement.tabIndex = 0;
          blockElement.setAttribute("role", "button");
          const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              blockElement.click();
            }
          };
          blockElement.addEventListener("keydown", onKeyDown);
          blockKeyboardHandlers.push([blockElement, onKeyDown]);
        });
        editorRef.current = editor;
        readyRef.current = true;
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();

    return () => {
      active = false;
      readyRef.current = false;
      blockKeyboardHandlers.forEach(([element, handler]) => element.removeEventListener("keydown", handler));
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [resetToken]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !readyRef.current) return;
    const gallery = editor.getWrapper()?.find("[data-studio-gallery]")[0];
    if (gallery) gallery.components(sourceContentMarkup(sources, editedImages));
  }, [editedSignature, sourceSignature]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !readyRef.current || changedRef.current) return;
    editor.setComponents(initialMarkup(sources, campaignBrief, editedImages));
  }, [campaignBrief]);

  function editorOutput(): { html: string; css: string } | null {
    const editor = editorRef.current;
    if (!editor) return null;
    return { html: editor.getHtml({ cleanId: true }), css: editor.getCss() ?? "" };
  }

  async function exportCampaign() {
    if (exportBusy) return;
    const output = editorOutput();
    if (!output) {
      onNotice("The campaign editor is still loading.");
      return;
    }
    setExportBusy(true);
    try {
      const result = await exportCampaignZip({ campaignName, ...output, sources, editedImages });
      onNotice(result.missingImages ? `Campaign ZIP downloaded with ${result.missingImages} unavailable image${result.missingImages === 1 ? "" : "s"}.` : "Campaign ZIP downloaded with HTML, CSS, and image assets.");
    } catch {
      onNotice("The campaign could not be exported. Check the selected previews and try again.");
    } finally {
      setExportBusy(false);
    }
  }

  useEffect(() => {
    if (status === "ready" && downloadToken > handledDownloadTokenRef.current && downloadToken > 0) {
      handledDownloadTokenRef.current = downloadToken;
      void exportCampaign();
    }
  }, [downloadToken, status]);

  function togglePreview() {
    if (!editorRef.current) {
      onNotice("The campaign editor is still loading.");
      return;
    }
    setPreviewOpen((open) => !open);
  }

  const output = editorOutput();
  return <section className="studio-campaign-editor" aria-labelledby="campaign-editor-heading">
    <div className="studio-campaign-editor-heading">
      <div>
        <span className="section-kicker">CAMPAIGN CANVAS</span>
        <h2 id="campaign-editor-heading">Build the message.</h2>
        <p>Drag a simple block into the page, edit its text, then preview it safely before exporting.</p>
      </div>
      <div className="studio-campaign-actions">
        <button type="button" className="outline-button" disabled={status !== "ready"} onClick={togglePreview}>{previewOpen ? "Close preview" : "Preview"}</button>
        <button type="button" className="dark-button" disabled={status !== "ready" || exportBusy} onClick={() => void exportCampaign()}>{exportBusy ? "Preparing ZIP..." : "Export campaign"} <span aria-hidden="true">↓</span></button>
      </div>
    </div>
    <div className="studio-campaign-editor-layout">
      <aside className="studio-campaign-blocks" aria-label="Campaign blocks">
        <span className="section-kicker">ADD CONTENT</span>
        <p>Drag or focus a block, then press Enter to add it.</p>
        <div ref={blocksRef} />
      </aside>
      <div className="studio-campaign-canvas-wrap">
        {status === "loading" && <p className="studio-editor-status" role="status">Loading the campaign editor...</p>}
        {status === "error" && <p className="studio-editor-status error" role="alert">The campaign editor could not load. Refresh and try again.</p>}
        <div className="studio-campaign-canvas" ref={hostRef} aria-label="Campaign editing canvas" />
      </div>
    </div>
    {previewOpen && output && <div className="studio-campaign-preview" role="dialog" aria-modal="true" aria-labelledby="campaign-preview-heading">
      <div className="studio-campaign-preview-heading"><div><span className="section-kicker">SAFE PREVIEW</span><h3 id="campaign-preview-heading">{campaignName.trim() || "Untitled campaign"}</h3></div><button type="button" className="ghost-button" onClick={() => setPreviewOpen(false)}>Close preview</button></div>
      <iframe title="Campaign preview" sandbox="" srcDoc={previewDocument(output.html, output.css)} />
    </div>}
  </section>;
}
