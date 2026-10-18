/**
 * lore serve — start the HTTP API server.
 * Source: SPEC-011 §6
 */

import { defineLoreCommand } from "../cli-exit.js";
import { exitCli } from "../cli-exit.js";
import { invocationOf } from "../command-invocation.js";
import { loadLoreApp } from "../loader.js";
import { startHttpServer } from "../../http/index.js";
import { resolveMachineAuthBaseDir } from "../../http/machine-auth.js";

export default defineLoreCommand({
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
  async run(context): Promise<number> {
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
      inv.io.stderr.write("Error: --port must be a valid port number (1–65535)\n");
      exitCli(1);
    }

    const host = args.host ?? "localhost";

    startHttpServer(app, { port, host, io: inv.io, machineAuthBaseDir: resolveMachineAuthBaseDir(inv.env, inv.paths.home) });

    // The server runs in the background via the Bun event loop; this run stays open until SIGTERM / SIGINT, then
    // closes the app and returns 0, so the one entry (`src/index.ts`) ends the process (a returned run is a finished run).
    await new Promise<void>((resolve) => {
      for (const signal of ["SIGTERM", "SIGINT"] as const) {
        process.once(signal, () => {
          app.close();
          resolve();
        });
      }
    });
    return 0;
  },
});
