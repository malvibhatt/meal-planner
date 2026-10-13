import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8")
) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // release-please rewrites package.json's version when a Release PR merges,
    // so the deployed build always reports the version that was released.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port: 5173,
    // Fail loudly instead of drifting to 5174. A silent port change breaks
    // CORS against the server's CLIENT_ORIGIN, and the error points at CORS
    // rather than at the real cause.
    strictPort: true,
  },
});
