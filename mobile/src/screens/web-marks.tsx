import { createElement, type ReactNode } from "react";

import { homebox } from "../theme";

type SvgProps = { width?: number; height?: number; label?: string };

// The website logo is an isometric house, not initials. Paths are a reduced
// copy of frontend/components/App/Logo.vue so the browser mark reads the same.
export function HouseMark({ width = 64, height = 58, label = "HomeBox" }: SvgProps): ReactNode {
  return createElement(
    "svg",
    {
      viewBox: "0 0 64 58",
      width,
      height,
      role: "img",
      "aria-label": label,
    },
    createElement("path", {
      d: "M32 3 L6 18.5 L6 46 L32 55 L58 46 L58 18.5 Z",
      fill: "#dadada",
      stroke: "#111",
      strokeWidth: 1.6,
      strokeLinejoin: "round",
    }),
    createElement("path", {
      d: "M32 3 L6 18.5 L32 30.5 Z",
      fill: "#808080",
      stroke: "#111",
      strokeWidth: 1.4,
      strokeLinejoin: "round",
    }),
    createElement("path", {
      d: "M32 8 L32 48",
      fill: "none",
      stroke: "#111",
      strokeWidth: 1.1,
    }),
    createElement("path", {
      d: "M46 22 L54 18.2 L54 36.5 L46 40.2 Z",
      fill: homebox.primary,
      stroke: "#111",
      strokeWidth: 1.2,
      strokeLinejoin: "round",
    }),
  );
}

export function Wordmark(): ReactNode {
  return createElement(
    "svg",
    { viewBox: "0 0 168 28", width: 168, height: 28, role: "img", "aria-label": "HomeBox" },
    createElement(
      "text",
      {
        x: 0,
        y: 22,
        fill: homebox.headerText,
        fontSize: 22,
        fontWeight: 700,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        letterSpacing: -0.4,
      },
      "HomeBox",
    ),
    createElement(
      "g",
      { transform: "translate(118,1) scale(0.42)" },
      createElement("path", {
        d: "M32 3 L6 18.5 L6 46 L32 55 L58 46 L58 18.5 Z",
        fill: "#dadada",
        stroke: "#111",
        strokeWidth: 1.6,
        strokeLinejoin: "round",
      }),
      createElement("path", {
        d: "M32 3 L6 18.5 L32 30.5 Z",
        fill: "#808080",
        stroke: "#111",
        strokeWidth: 1.4,
        strokeLinejoin: "round",
      }),
      createElement("path", {
        d: "M46 22 L54 18.2 L54 36.5 L46 40.2 Z",
        fill: homebox.primary,
        stroke: "#111",
        strokeWidth: 1.2,
        strokeLinejoin: "round",
      }),
    ),
  );
}

const ICONS: Record<string, string> = {
  home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  locations: "M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3h7zM7 9H4V5h3v4zm10 6h3v4h-3v-4zm0-10h3v4h-3V5z",
  tags: "M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z",
  search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  templates: "M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5L14 3.5zM8 12h8v1.5H8V12zm0 3h8v1.5H8V15z",
  maintenance: "M22.7 19.3l-6.4-6.4c.6-1.2.4-2.7-.6-3.7-1.1-1.1-2.6-1.3-3.8-.7L9.4 10.9 7 8.5 4.6 10.9 2.2 8.5 3.6 7.1 1.2 4.7 2.6 3.3l2.4 2.4 2.4-2.4 1.4 1.4-2.4 2.4 2.4 2.4 2.5-2.5 1.4 1.4c-.6 1.2-.4 2.7.7 3.8 1 1 2.5 1.2 3.7.6l6.4 6.4c.4.4 1 .4 1.4 0l1.1-1.1c.4-.4.4-1 0-1.4z",
  profile: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  tools: "M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.22-1.14.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.49.4 1.04.72 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.22 1.14-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z",
  plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  logout: "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
  chevron: "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
  magnify: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  scan: "M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4zM9 9h6v6H9V9z",
  menu: "M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z",
  pin: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z",
};

export function Icon({ name, size = 18, color = "currentColor" }: { name: string; size?: number; color?: string }): ReactNode {
  const d = ICONS[name] ?? ICONS.home;
  return createElement(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true },
    createElement("path", { d, fill: color }),
  );
}
