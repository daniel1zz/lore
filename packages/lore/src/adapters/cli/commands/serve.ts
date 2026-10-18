/**
 * lore serve — start the HTTP API server.
 * Source: SPEC-011 §6
 */

import { defineCommand } from "citty";
import { invocationOf } from "../command-invocation.js";
import { loadLoreApp } from "../loader.js";
import { startHttpServer } from "../../http/index.js";

export default defineCommand({
  meta: {
    name: "serve",
    description: "Start the Lore HTTP API server",
  },
  args: {
    port: {
      type: "string",
      description: "Port to listen on (default: 3456)",
    },
    host: {
      type: "string",
      description: "Host to bind to (default: localhost)",
    },
  },
  run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    // reason: `{surface: "http"}` is load-bearing, not decorative — this boot
    // happens ONCE and then answers requests that carry no directory of their
    // own, so the foreign-corpus-write guard must NOT key on the directory the
    // operator happened to start the server from. Without it, `lore serve`
    // launched inside a nested worktree refuses EVERY HTTP write with
    // `gate:corpus-write:foreign-provenance`, and an HTTP caller has no way to
    // declare intent or recover (spec-corpus-resolution-carries-provenance-
    // and-a-foreign-write §D5, the adapter matrix's one named exemption).
    const { app } = loadLoreApp({ surface: "http", inv });

    const port = args.port !== undefined ? parseInt(args.port, 10) : 3456;
    if (isNaN(port) || port < 1 || port > 65535) {
      process.stderr.write("Error: --port must be a valid port number (1–65535)\n");
      process.exit(1);
    }

    const host = args.host ?? "localhost";

    startHttpServer(app, { port, host });

    // Keep process alive; server runs in background via Bun event loop
    // Graceful shutdown on SIGTERM
    process.on("SIGTERM", () => {
      app.close();
      process.exit(0);
    });

    process.on("SIGINT", () => {
      app.close();
      process.exit(0);
    });
  },
});
