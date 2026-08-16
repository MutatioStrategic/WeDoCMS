export type CropPreset = "square" | "portrait" | "landscape" | "story" | "reel_cover" | "linkedin" | "web_hero" | "email_header";
export type DerivativeVariant = "social_square" | "portrait" | "landscape" | "story_9_16" | "reel_cover" | "linkedin" | "web_hero" | "email_header";

export type EditRecipe = {
  preset: CropPreset;
  crop: { x: number; y: number; width: number; height: number };
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  straighten: number;
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  sharpen: number;
  background: "none" | "blur" | "extend";
  text: { value: string; colour: string; font: string; align: "left" | "center" | "right" };
  logo: { value: string; position: "top-left" | "top-right" | "bottom-left" | "bottom-right"; safeMargin: number };
};

export const cropPresets: Record<CropPreset, { label: string; ratio: number; width: number; height: number }> = {
  square: { label: "Square", ratio: 1, width: 1200, height: 1200 },
  portrait: { label: "Portrait", ratio: 4 / 5, width: 1080, height: 1350 },
  landscape: { label: "Landscape", ratio: 3 / 2, width: 1800, height: 1200 },
  story: { label: "Story", ratio: 9 / 16, width: 1080, height: 1920 },
  reel_cover: { label: "Reel cover", ratio: 9 / 16, width: 1080, height: 1920 },
  linkedin: { label: "LinkedIn", ratio: 1.91, width: 1200, height: 627 },
  web_hero: { label: "Web hero", ratio: 2.4, width: 2400, height: 1000 },
  email_header: { label: "Email header", ratio: 3, width: 1800, height: 600 },
};

export const derivativeForPreset: Record<CropPreset, DerivativeVariant> = {
  square: "social_square", portrait: "portrait", landscape: "landscape", story: "story_9_16", reel_cover: "reel_cover", linkedin: "linkedin", web_hero: "web_hero", email_header: "email_header",
};

export const defaultEditRecipe = (): EditRecipe => ({
  preset: "square", crop: { x: 0, y: 0, width: 1, height: 1 }, rotation: 0, flipX: false, flipY: false, straighten: 0,
  brightness: 100, contrast: 100, saturation: 100, warmth: 0, sharpen: 0, background: "none",
  text: { value: "", colour: "#fffaf0", font: "Arial", align: "left" },
  logo: { value: "", position: "bottom-right", safeMargin: 6 },
});

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fitCrop(sourceWidth: number, sourceHeight: number, ratio: number): { x: number; y: number; width: number; height: number } {
  const sourceRatio = sourceWidth / sourceHeight;
  if (sourceRatio > ratio) {
    const width = sourceHeight * ratio;
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight };
  }
  const height = sourceWidth / ratio;
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height };
}

export function safeZonePercent(margin: number): number {
  return clamp(margin, 0, 30);
}
