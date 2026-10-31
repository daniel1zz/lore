/**
 * lore dispatch <task> — prints the whole subagent prompt of an approved code task (AC-DCS2-6): the locked task body, the stored
 * done contract, the commands `lore start`, `lore finish` and `lore land`, and the shipped standing rules byte for byte.
 * Thin pipe over `DispatchService`; the prompt itself lives in `service/dispatch-service.ts`. The rules file is read off the
 * binary's own assets root (`resolveAssetsRoot`), so it is found from any working directory.
 *
 * Exit codes: 0 printed, 4 refused (no stored contract, a check or corpus task, unreadable rules), 1 not found or other errors.
 *
 * Source: spec-integrate-proves-and-lands-evidence-at-landing-the-merge (AC-DCS2-6).
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { invocationOf } from "../command-invocation.js";
import { defineLoreCommand } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { printLine } from "../output.js";
import { resolveAssetsRoot } from "../setup-args.js";
import { createRootAssetReader } from "../../real-asset-source.js";

// Same 6-level derivation as commands/governance.ts (dev mode only; compiled mode derives from the executable).
const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..", "..", "..", "..", "..");

export default defineLoreCommand({
  meta: {
    name: "dispatch",
    description: "Print the subagent prompt of an approved code task from its stored contract and the shipped standing rules",
  },
  args: {
    task: { type: "positional", description: "Task document ID or slug", required: true },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      if (app.createDispatchService === undefined) {
        printLine(inv.io.stderr, "Error: lore dispatch is not available in this composition"); // CLI surface
        return 1;
      }
      const assets = createRootAssetReader(resolveAssetsRoot({ repoRoot: REPO_ROOT, isCompiled: inv.isCompiled, execPath: inv.execPath }));
      const result = await app.createDispatchService(assets).dispatch(args.task as string);
      if (!result.ok) {
        printLine(inv.io.stderr, formatErrorFor(inv, result.error)); // CLI surface
        return exitCode(result.error);
      }
      printLine(inv.io.stdout, result.value.trimEnd());
    } finally {
      app.close();
    }
    return 0;
  },
});
