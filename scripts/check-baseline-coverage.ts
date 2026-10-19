#!/usr/bin/env bun
/**
 * Root baseline coverage floor step (`bun run check:baseline-coverage`) — spec-baseline-coverage-refuses-only-undeclared-commands-a-site
 * (BR-1248, BR-660): `lore integrate` must not advance main while a runnable command is declared by no leaf.
 *
 * Purpose: this is the ONLY thing the step refuses. An unmapped census site is report output of `lore baseline coverage`, never a
 * floor failure, so the step never runs the site census: it asks `lore baseline coverage <root> --commands-only --json` for every
 * business-tree root of the corpus it resolves (the integrate floor runs it against the corpus snapshot taken at integrate start),
 * which needs only the command registry and the declarations.
 *
 * Which code judges: the checkout this script lives in (`<repo>/packages/lore/src/index.ts`, run by bun), so the floor
 * judges the merged tree with the merged tree's own registry, never the shared checkout's build.
 *
 * Output: one line per undeclared command with its `lore baseline map` fix line, then a summary line, so the tail of a failing
 * floor names the commands. Exit codes: 0 every runnable command is declared, 1 at least one is not, 2 the check itself could not
 * run (no root, unparsable output) — never a silent pass. The step never reads a site_map value, so leftover free-text
 * entries cannot fail it (only the full `lore baseline coverage` report exits 2 on one).
 *
 * Side-effect class: IO (spawns `lore`, prints).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

export interface CoverageData {
  readonly target: string;
  readonly complete: boolean;
  readonly undeclared_commands: readonly { readonly command: string; readonly fix: string }[];
}

function runLore(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("bun", ["run", LORE_ENTRY, ...args], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function fail(message: string): never {
  console.error(`check:baseline-coverage: ${message}`);
  process.exit(2);
}

/** Slugs of the business tree's roots, read from the corpus (never a hand list). */
function businessRoots(): string[] {
  const r = runLore(["baseline", "tree", "--json"]);
  if (r.status !== 0) fail(`\`lore baseline tree --json\` exited ${r.status}: ${r.stderr}${r.stdout}`);
  let nodes: { slug: string; depth: number; node: string; tree?: string }[];
  try {
    nodes = (JSON.parse(r.stdout) as { data: typeof nodes }).data;
  } catch (cause) {
    return fail(`unparsable \`lore baseline tree --json\` output: ${String(cause)}`);
  }
  const roots = nodes.filter((n) => n.depth === 0 && n.node === "root" && n.tree === "business").map((n) => n.slug);
  if (roots.length === 0) fail("the corpus has no business baseline root: complete coverage of nothing is not coverage");
  return roots;
}

function coverageOf(root: string): CoverageData {
  const r = runLore(["baseline", "coverage", root, "--commands-only", "--json"]);
  // exit 1 = an undeclared command (still prints the JSON); anything else is the check failing to run
  if (r.status !== 0 && r.status !== 1) fail(`\`lore baseline coverage ${root} --commands-only\` exited ${r.status}: ${r.stderr}${r.stdout}`);
  try {
    const data = (JSON.parse(r.stdout) as { data: CoverageData }).data;
    if (data.complete !== (r.status === 0)) fail(`coverage of ${root} disagrees with itself: complete=${data.complete} but exit ${r.status}`);
    return data;
  } catch (cause) {
    return fail(`unparsable coverage output for ${root}: ${String(cause)}`);
  }
}

/** The lines stating each undeclared command the CLI reported (the CLI decided, this renders: no verdict logic here). */
export function renderUndeclared(all: readonly CoverageData[]): string[] {
  const lines = all.flatMap((data) => data.undeclared_commands.map((u) => `  undeclared   ${u.command}\n    fix: ${u.fix}`));
  const count = all.reduce((n, data) => n + data.undeclared_commands.length, 0);
  if (count > 0) lines.unshift(`check:baseline-coverage: ${count} runnable command(s) no leaf declares:`);
  lines.push(`check:baseline-coverage: ${all.map((d) => d.target).join(", ")}: ${count} undeclared command(s)`);
  return lines;
}

function main(): number {
  const all = businessRoots().map(coverageOf);
  for (const line of renderUndeclared(all)) console.log(line);
  return all.every((d) => d.undeclared_commands.length === 0) ? 0 : 1;
}

if (import.meta.main) process.exit(main());
