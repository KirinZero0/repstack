import type { Config } from "tailwindcss";

// Every shade the app uses reads from a CSS variable defined in globals.css, so flipping
// data-theme between "dark" and "light" re-skins existing utility classes without touching pages.
const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: { display: ["var(--font-display)", "var(--font-geist-sans)", "system-ui", "sans-serif"] },
      colors: {
        plate: { red: "var(--plate-red)", blue: "var(--plate-blue)", yellow: "var(--plate-yellow)", green: "var(--plate-green)" },
        paper: { DEFAULT: "var(--paper)", rule: "var(--paper-rule)", ink: "var(--paper-ink)" },
        background: "var(--background)",
        foreground: "var(--foreground)",
        white: v("white"),
        neutral: {
          200: v("n-200"),
          300: v("n-300"),
          400: v("n-400"),
          500: v("n-500"),
          600: v("n-600"),
          700: v("n-700"),
          800: v("n-800"),
          900: v("n-900"),
          950: v("n-950"),
        },
        emerald: { 400: v("emerald-400"), 700: v("emerald-700"), 800: v("emerald-800"), 950: v("emerald-950") },
        red: { 400: v("red-400"), 800: v("red-800"), 950: v("red-950") },
        amber: { 400: v("amber-400"), 800: v("amber-800"), 950: v("amber-950") },
        blue: { 400: v("blue-400"), 800: v("blue-800"), 950: v("blue-950") },
      },
    },
  },
  plugins: [],
};
export default config;
