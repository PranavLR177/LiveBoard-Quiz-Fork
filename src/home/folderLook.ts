import type { FolderBg, FolderLook } from "../types";

/* The choices for a folder you make on the dial, kept apart from the editor so storage and backups can check a folder
   without loading any of the dial. */
export const FOLDER_BGS: { id: FolderBg; label: string }[] = [
  { id: "plain", label: "Plain" }, { id: "dots", label: "Dots" }, { id: "stripes", label: "Stripes" },
  { id: "grid", label: "Grid" }, { id: "waves", label: "Waves" }, { id: "glow", label: "Glow" }
];
/** Small marks for the folder's tab: plain characters, so they work in every font and can't carry markup. */
export const FOLDER_ICONS = ["", "★", "✎", "♪", "⚑", "☕", "✈", "♥", "✦", "⚙", "☀", "❀", "⌂", "♞", "∑", "$"];
export const FOLDER_COLORS = ["#FF5D8F", "#FF9F1C", "#FFD23F", "#2EC4B6", "#3A86FF", "#8338EC", "#6B5CFF", "#E5484D", "#1B9C85", "#5C6B7A"];

/** A folder look read from storage or a backup: anything unknown falls back, so a bad value can't break the dial. */
export function cleanFolder(f: unknown): FolderLook | null {
  if (!f || typeof f !== "object") return null;
  const x = f as Record<string, unknown>;
  const bg = FOLDER_BGS.some(b => b.id === x.bg) ? (x.bg as FolderBg) : "plain";
  const icon = typeof x.icon === "string" && FOLDER_ICONS.includes(x.icon) ? x.icon : "";
  const at = typeof x.at === "number" && isFinite(x.at) ? x.at : 0;
  return { bg, icon, at };
}
