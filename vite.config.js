import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match your repo name for GitHub Pages project sites:
// https://YOUR_USERNAME.github.io/msa-uw/  ->  base: "/"
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    // Split large third-party libs into their own cacheable chunks so the
    // main app bundle stays lean and vendor code caches across deploys.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          anime: ["animejs"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
