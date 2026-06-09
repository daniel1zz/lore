/**
 * lore serve — start the HTTP API server.
 * Source: SPEC-011 §6
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb } from "../utils.js";
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
  run({ args }) {
    const dbPath = findLoreDb();
    const app = createApp(dbPath);

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
