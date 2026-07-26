import type { Config } from "tailwindcss";

export default {
  content: ["src/**/*.{ts,tsx,html}", "entrypoints/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        "bg-base": "var(--bg-base)",
        "bg-elevated": "var(--bg-elevated)",
        "bg-elevated-hover": "var(--bg-elevated-hover)",
        "border-subtle": "var(--border-subtle)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-tertiary": "var(--text-tertiary)",
        accent: "var(--accent)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        // Web-canon role tokens (side panel).
        primary: "var(--primary)",
        "primary-foreground": "var(--primary-foreground)",
        brand: "var(--brand)",
        "brand-foreground": "var(--brand-foreground)",
        warn: "var(--warn)",
        "warn-bg": "var(--warn-bg)",
      },
      // Semantic type scale, mirrored from the web canon.
      fontSize: {
        micro: "12.5px",
        caption: "14px",
        body: "15px",
        "body-lg": "16px",
        title: "17px",
        heading: "23px",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      transitionTimingFunction: {
        "out-strong": "var(--ease-out)",
        spring: "var(--ease-spring)",
        drawer: "var(--ease-drawer)",
      },
      transitionDuration: {
        fast: "140ms",
        base: "200ms",
        slow: "300ms",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": {
          from: { opacity: "0", transform: "scale(0.9)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(12px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "sheet-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in var(--dur-base) var(--ease-out) both",
        "pop-in": "pop-in 260ms var(--ease-spring) both",
        "slide-in-right": "slide-in-right 220ms var(--ease-out) both",
        "sheet-in-right": "sheet-in-right 340ms var(--ease-drawer) both",
      },
    },
  },
} satisfies Config;
