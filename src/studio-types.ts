export type StudioSource = {
  id: string;
  title: string;
  kind: "image" | "video";
  previewUrl: string | null;
  sourceFileName: string;
  duration: number;
};

export type ImageFormat = "image/png" | "image/jpeg";

export type ImageEdit = {
  sourceId: string;
  blob: Blob;
  previewUrl: string;
  fileName: string;
  format: ImageFormat;
  width: number;
  height: number;
  filter: ImageFilter;
  overlay?: ImageOverlay;
};

export type ImageFilter = "none" | "soft" | "mono" | "contrast";

export type ImageOverlayStyle = "clean" | "editorial" | "impact";
export type ImageOverlayPosition = "top" | "middle" | "bottom";
export type ImageOverlayAlign = "left" | "center" | "right";
export type ImageOverlay = {
  text: string;
  style: ImageOverlayStyle;
  position: ImageOverlayPosition;
  align: ImageOverlayAlign;
  color: "light" | "dark";
  background: boolean;
};

export type StudioMode = "photo" | "campaign";
