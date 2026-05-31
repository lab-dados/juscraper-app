/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta sobria com as cores da FGV (azul-marinho institucional).
        // Hexes aproximados do guia de marca — ajustaveis.
        fgv: {
          50: "#eef3f9",
          100: "#d6e2f0",
          200: "#aec6e2",
          300: "#7ea3cf",
          400: "#4d7db6",
          500: "#2a5e9c",
          600: "#1c4880",
          700: "#163a68",
          800: "#102b4d",
          900: "#0b1f38",
          DEFAULT: "#163a68",
        },
        accent: {
          DEFAULT: "#1e6fb8",
          600: "#1a5fa0",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
