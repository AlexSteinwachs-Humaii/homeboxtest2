import { Platform } from "react-native";

// Phone palette. The browser uses the Vue HomeBox tokens instead (see below).
const phone = {
  background: "#f3f6f2",
  card: "#ffffff",
  text: "#1c2822",
  muted: "#5c6b63",
  line: "#d5ddd7",
  primary: "#3f624c",
  primaryPressed: "#314d3c",
  onPrimary: "#f4fff7",
  mark: "#4f735c",
  danger: "#8f1d1d",
  dangerBg: "#fdecea",
  input: "#fbfcfb",
};

// frontend/assets/css/main.css `:root,.homebox` — the Go app's website theme.
// primary 139 16% 43%, primary-foreground 139 100% 89%, secondary 77 8% 17%,
// secondary-foreground 76 18% 83%, background-accent 0 0% 81%, sidebar 0 0% 90%.
export const homebox = {
  canvas: "#cfcfcf",
  sidebar: "#e6e6e6",
  sidebarText: "#333333",
  header: "#2a2f28",
  headerText: "#d0dccc",
  primary: "#5c7f67",
  primaryText: "#c7ffd9",
  accent: "#eef6e8",
  accentText: "#213318",
  card: "#ffffff",
  text: "#333333",
  muted: "#5c5c5c",
  border: "#cfcfcf",
  danger: "#8f1d1d",
  dangerBg: "#fdecea",
  radius: 8,
};

const web = {
  background: homebox.canvas,
  card: homebox.card,
  text: homebox.text,
  muted: homebox.muted,
  line: homebox.border,
  primary: homebox.primary,
  primaryPressed: "#4a6854",
  onPrimary: homebox.primaryText,
  mark: homebox.primary,
  danger: homebox.danger,
  dangerBg: homebox.dangerBg,
  input: "#ffffff",
};

export const colors = Platform.OS === "web" ? web : phone;
