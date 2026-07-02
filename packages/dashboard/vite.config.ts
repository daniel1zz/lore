import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { configDefaults } from "vitest/config";

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
  build: {
    rollupOptions: {
      // reason: @lore/core's barrel (src/index.ts) re-exports telemetry.ts, which does a
      // top-level `import { appendFileSync, mkdirSync } from "fs"` for its (server-only) JSONL
      // sink. The dashboard only consumes @lore/core's types/Zod schemas (createDocInputSchema,
      // getAllowedTransitions) — the telemetry code path is never invoked in-browser — but Rollup
      // still statically resolves the barrel's transitive imports and fails production builds
      // because its default Node-builtin browser stub has no named exports. Marking these
      // builtins external (not bundled, not analyzed) is the boundary-safe fix on the dashboard
      // side; @lore/core is out of this task's scope (SPEC-022 §9.2 touches @lore/dashboard only).
      external: ["fs", "path", "os"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    // reason: Playwright e2e specs (tests/e2e/*.pw.ts) are a separate suite driven by
    // `playwright test` (see playwright.config.ts), never by vitest. Excluding the dir
    // is belt-and-suspenders: the filename pattern already doesn't match vitest's
    // default *.test.ts(x)/*.spec.ts(x) include behaviour. SPEC-022 §9.7.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
