import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

/**
 * Dev-only Vite plugin that inlines the bootstrap token into index.html.
 * apply: "serve" ensures this plugin NEVER runs during `vite build` — the token
 * cannot leak into production artefacts. SPEC-016 §3.7, AC-A-Bnd1.
 *
 * reason: The token is injected as a <script> tag in <head> so the SPA can read it
 * synchronously before any module import / async code runs. The SPA's bootstrapAuthIfNeeded()
 * consumes it immediately and then deletes the global. SPEC-016 §3.8.
 */
const loreBootstrapTokenPlugin: Plugin = {
  name: "lore-bootstrap-token",
  // reason: apply: "serve" is CRITICAL — without it, vite build would also execute this
  // plugin and leak VITE_LORE_BOOTSTRAP_TOKEN into the built index.html. SPEC-016 §3.7.
  apply: "serve",
  transformIndexHtml(html: string): string {
    const token = process.env["VITE_LORE_BOOTSTRAP_TOKEN"];
    if (!token) return html;
    // JSON.stringify adds quotes and escapes special chars — safe for inline script injection.
    const safe = JSON.stringify(token);
    return html.replace("</head>", `<script>window.__LORE_BOOTSTRAP_TOKEN__=${safe}</script></head>`);
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: false,
    }),
    react(),
    tailwindcss(),
    loreBootstrapTokenPlugin,
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: false,
  },
});
