import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#1a1a1a",
          sidebar: "#0f0f0f",
          panel: "#222222",
          hover: "#2a2a2a",
        },
        border: {
          DEFAULT: "#2f2f2f",
          subtle: "#262626",
        },
        accent: {
          DEFAULT: "#d97706",
          hover: "#b45309",
          soft: "#78350f",
        },
        text: {
          DEFAULT: "#ececec",
          muted: "#a1a1a1",
          dim: "#6b6b6b",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
