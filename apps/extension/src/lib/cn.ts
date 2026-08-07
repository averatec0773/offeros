import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The semantic type scale (tailwind.config.ts fontSize) is invisible to
// tailwind-merge's defaults, which misread `text-body` & co. as text-COLOR
// classes — merging "text-primary-foreground … text-body" then drops the
// color and the primary button renders black-on-black. Registering them as
// font-size classes keeps color and size in separate conflict groups.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "caption", "body", "body-lg", "title", "heading"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
