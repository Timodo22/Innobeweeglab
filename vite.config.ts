import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // `npm run dev` serves the SPA; point /api at `wrangler pages dev` on 8788.
      "/api": { target: "http://127.0.0.1:8788", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
