import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" gera caminhos relativos -> serve em GitHub Pages sob qualquer subpasta.
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: {
    format: "es",
  },
});
