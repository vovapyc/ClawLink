import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "agent-a": {
          bg: "#dbeafe",
          fg: "#1e3a8a",
          border: "#60a5fa",
        },
        "agent-b": {
          bg: "#dcfce7",
          fg: "#14532d",
          border: "#4ade80",
        },
      },
    },
  },
  plugins: [],
};

export default config;
