import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The semantic type scale (globals.css --text-*) is invisible to
// tailwind-merge's defaults, which misread `text-body` & co. as text-COLOR
// classes — merging "text-muted-foreground … text-caption" then drops the
// color. Registering them as font-size classes keeps color and size in
// separate conflict groups.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "caption", "body", "body-lg", "title", "heading"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Read a File's bytes as base64 (no data-URL prefix). Shared by the résumé
 *  upload paths, which both need to hand bytes to the JSON API. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}
