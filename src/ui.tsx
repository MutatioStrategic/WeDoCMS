import type { ReactNode } from "react";

export type IconName =
  | "arrow"
  | "bell"
  | "briefcase"
  | "chevron"
  | "command"
  | "compass"
  | "grid"
  | "image"
  | "layout"
  | "logout"
  | "menu"
  | "plus"
  | "search"
  | "settings"
  | "shield"
  | "sparkles"
  | "users"
  | "workflow"
  | "x";

type IconProps = {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  ariaHidden?: boolean;
};

export function Icon({ name, size = 17, strokeWidth = 1.8, className, ariaHidden = true }: IconProps) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let content: ReactNode;
  switch (name) {
    case "arrow": content = <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>; break;
    case "bell": content = <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>; break;
    case "briefcase": content = <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></>; break;
    case "chevron": content = <path d="m9 18 6-6-6-6" />; break;
    case "command": content = <><path d="M18 2a4 4 0 0 0-4 4v12a4 4 0 1 0 4-4H6a4 4 0 1 0 4 4V6a4 4 0 1 0-4 4h12a4 4 0 1 0 4-4" /></>; break;
    case "compass": content = <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9z" /></>; break;
    case "grid": content = <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>; break;
    case "image": content = <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-4.5-4.5L7 20" /></>; break;
    case "layout": content = <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M9 10h12" /></>; break;
    case "logout": content = <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M21 19V5a2 2 0 0 0-2-2h-5" /></>; break;
    case "menu": content = <><path d="M4 6h16M4 12h16M4 18h16" /></>; break;
    case "plus": content = <><path d="M12 5v14M5 12h14" /></>; break;
    case "search": content = <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>; break;
    case "settings": content = <><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" /><path d="m19.4 15 .1.1a2 2 0 0 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.2a2 2 0 0 1-4 0v-.2a2 2 0 0 0-3.4-1.4l-.1.1A2 2 0 0 1 3 15.1l.1-.1a2 2 0 0 0-1.4-3.4h-.2a2 2 0 0 1 0-4h.2A2 2 0 0 0 3.1 4.2L3 4.1A2 2 0 0 1 5.8 1.3l.1.1a2 2 0 0 0 3.4-1.4v-.2a2 2 0 0 1 4 0V0a2 2 0 0 0 3.4 1.4l.1-.1A2 2 0 0 1 19.6 4l-.1.1a2 2 0 0 0 1.4 3.4h.2a2 2 0 0 1 0 4h-.2a2 2 0 0 0-1.5 3.5Z" transform="translate(0 2) scale(.78)" /></>; break;
    case "shield": content = <><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></>; break;
    case "sparkles": content = <><path d="m12 3-1.2 4.3L7 8.5l3.8 1.2L12 14l1.2-4.3L17 8.5l-3.8-1.2z" /><path d="m19 14-.6 2.4L16 17l2.4.6L19 20l.6-2.4L22 17l-2.4-.6z" /></>; break;
    case "users": content = <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>; break;
    case "workflow": content = <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 6h3a3 3 0 0 1 3 3v6M15 18h-3a3 3 0 0 1-3-3v-1" /></>; break;
    case "x": content = <><path d="m6 6 12 12M18 6 6 18" /></>; break;
  }
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden={ariaHidden} focusable="false" {...common}>{content}</svg>;
}
