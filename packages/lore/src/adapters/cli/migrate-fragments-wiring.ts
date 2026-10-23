/**
 * Adapter glue for `lore migrate fragments` and the automatic migration inside `lore setup`.
 * Spec: spec-fragment-injection-timing-one-inject-enum-a-per-turn (Migration mapping: Command + `lore setup` paragraphs).
 *
 * Public surface:
 *   - findLoreProjectRoot(start) — nearest ancestor holding `.lore/`, or null.
 *   - runFragmentsMigration(inv, opts) — resolve layer dirs, run the flow, print one line per file, return the exit code.
 *
 * Invariants:
 *   - Thin: layer resolution + real fs port + printing; the mapping and the hash precondition live in the flow.
 *   - The user layer needs no corpus; the project layer is `<projectRoot>/.lore/context`.
 *   - Writes are atomic (temp file + rename) so a reader never sees a half-written fragment.
 *   - Refused and conflicting files are also named on stderr (never a silent skip), whatever the line sink is.
 *
 * Side-effect class: IO (filesystem, stdout/stderr through `inv.io`).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Invocation, InvocationWriter } from "@lore/core";
import {
  formatOutcomeLine,
  migrateFragments,
  type FragmentLayerDir,
  type MigrateFragmentsFs,
} from "../../flows/migrate-fragments-flow.js";
import { resolveUserConfigDir } from "../../service/context-fragments/user-config-dir.js";
import { printLine } from "./output.js";

/** Nearest ancestor of `start` (inclusive) that holds a `.lore/` directory; null when none does. */
export function findLoreProjectRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".lore"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function makeRealMigrateFs(): MigrateFragmentsFs {
  return {
    async listDir(dir) {
      try {
        return readdirSync(dir);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
      }
    },
    async readFile(path) {
      try {
        return readFileSync(path, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async writeFile(path, text) {
      const temp = `${path}.lore-migrate-${process.pid}.tmp`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(temp, text, "utf8");
      renameSync(temp, path);
    },
  };
}

/**
 * Run the fragment migration for the given scopes and print one line per file.
 *
 * @param inv Invocation (env, home, io).
 * @param opts `scopes` to include; `projectRoot` required when `project` is included; `apply` false = preview;
 *   `sink` receives the per-file lines (stdout normally; stderr when stdout carries JSON).
 * @returns `code`: the migrate exit code (5 conflict, 4 refused, 0 clean, 1 on an IO failure printed to stderr);
 *   `heldBack`: absolute paths of the refused / conflicting files (setup hides them from its rules refresh).
 */
export async function runFragmentsMigration(
  inv: Invocation,
  opts: {
    readonly scopes: readonly ("user" | "project")[];
    readonly projectRoot: string | null;
    readonly apply: boolean;
    readonly sink?: InvocationWriter;
  },
): Promise<{ readonly code: number; readonly heldBack: readonly string[] }> {
  const layers: FragmentLayerDir[] = [];
  for (const scope of opts.scopes) {
    if (scope === "user") layers.push({ scope, dir: join(resolveUserConfigDir(inv.env, inv.paths.home), "context") });
    else if (opts.projectRoot !== null) layers.push({ scope, dir: join(opts.projectRoot, ".lore", "context") });
  }
  const result = await migrateFragments({ fs: makeRealMigrateFs() }, { layers, apply: opts.apply });
  if (!result.ok) {
    inv.io.stderr.write(`Error: fragment migration failed writing ${result.error.path}: ${result.error.message}\n`);
    return { code: 1, heldBack: [] };
  }
  const sink = opts.sink ?? inv.io.stdout;
  const heldBack: string[] = [];
  for (const outcome of result.value.outcomes) {
    printLine(sink, formatOutcomeLine(outcome));
    if (outcome.kind === "refused" || outcome.kind === "conflict") {
      heldBack.push(outcome.path);
      if (sink !== inv.io.stderr) printLine(inv.io.stderr, `lore migrate fragments: ${formatOutcomeLine(outcome)}`);
    }
  }
  return { code: result.value.exitCode, heldBack };
}
