import type { Config } from "tailwindcss";

// Tailwind is still available for utility classes, but the futuristic design
// uses its own CSS class system (in globals.css) driven by oklch tokens.
// Agent accent colors are kept for any existing consumers.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Space Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        "agent-a": {
          bg: "oklch(0.80 0.15 220 / 0.12)",
          fg: "oklch(0.80 0.15 220)",
          border: "oklch(0.80 0.15 220 / 0.45)",
        },
        "agent-b": {
          bg: "oklch(0.78 0.18 340 / 0.12)",
          fg: "oklch(0.78 0.18 340)",
          border: "oklch(0.78 0.18 340 / 0.45)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
