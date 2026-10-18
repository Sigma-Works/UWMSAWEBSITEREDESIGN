import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Vite build configuration.
   • base "/": the site is served from the domain root (msauw.org on
     Firebase Hosting). A GitHub Pages *project* site would need
     base: "/<repo-name>/" instead.
   • manualChunks: long-lived vendor code goes in its own cacheable files.
     Code that most visitors never need (admin dashboard, supabase-js,
     policy pages, the Quad tree) is split automatically because App.jsx
     loads it with dynamic import() / React.lazy. */
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
