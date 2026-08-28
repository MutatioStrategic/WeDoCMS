import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // GrapesJS is loaded only by the campaign editor, never on initial navigation.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client"],
          identity: ["@auth0/auth0-react", "@supabase/supabase-js"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.VITE_WORKER_API_URL ?? "http://127.0.0.1:8787",
    },
  },
});
