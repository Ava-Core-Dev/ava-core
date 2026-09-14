/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        bg: { base: "#050505", surface: "#121212", elev: "#1C1C1E" },
        text: { primary: "#FFFFFF", secondary: "#8A8A8E", muted: "#525255" },
        gold: { DEFAULT: "#FFB800", muted: "rgba(255,184,0,0.2)" },
        pos: "#00F58C",
        neg: "#FF453A",
        warn: "#FF9F0A",
        info: "#0A84FF",
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
        display: ["Outfit", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
      keyframes: {
        pulseGold: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(255,184,0,0.5)" },
          "50%":     { boxShadow: "0 0 0 12px rgba(255,184,0,0)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        tickerScroll: {
          "0%":   { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        pulseGold: "pulseGold 2s ease-out infinite",
        shimmer: "shimmer 2s linear infinite",
        tickerScroll: "tickerScroll 40s linear infinite",
      },
    },
  },
  plugins: [],
};
