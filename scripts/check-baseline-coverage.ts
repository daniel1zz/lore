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
 * run (no root, unparsable output) — never a silent pass. The step runs `--commands-only`: it never runs the site census, so a
 * refusal site's declared rule (or the lack of one) cannot fail it.
 *
 * `--changed` reads coverage with `--include-pending`: a command declared only by a leaf's pending revision counts as declared, because
 * a new command cannot be approved before it is on main (approve refuses a command main's tree lacks), so refusing it would deadlock
 * landing. The full run stays approved-only. `--changed` (the integrate floor's `check:baseline-coverage:changed`, BR-1368): judges only the branch's own change against main.
 * It reads coverage ONLY when the diff touches the command registry (`cli/index.ts` or a `cli/commands/*.ts` module), and then
 * refuses only undeclared commands the diff added or renamed ({@link addedCommands}); a diff touching neither exits 0 without
 * spawning `lore`. The full scan stays in `check:baseline-coverage` (plan close).
 *
 * Side-effect class: IO (spawns `lore`, prints).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { changedFiles, resolveBase, wantsChanged, type ChangedFile } from "./changed-files.js";

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

/** Pure. The CLI arguments of one root's coverage read; only the landing (`--changed`) read counts pending declarations (BR-1368). */
export function coverageArgs(root: string, includePending: boolean): string[] {
  return ["baseline", "coverage", root, "--commands-only", "--json", ...(includePending ? ["--include-pending"] : [])];
}

function coverageOf(root: string, includePending: boolean): CoverageData {
  const r = runLore(coverageArgs(root, includePending));
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

const REGISTRY_INDEX = "packages/lore/src/adapters/cli/index.ts";
const COMMAND_MODULE_RE = /^packages\/lore\/src\/adapters\/cli\/commands\/[^/]+\.ts$/;

/** Pure. True when the diff touches the command registry or a command module (a command could have been added or renamed). */
export function registryChanged(changed: readonly ChangedFile[]): boolean {
  return changed.some((c) => c.path === REGISTRY_INDEX || COMMAND_MODULE_RE.test(c.path));
}

/**
 * Pure. The undeclared commands this diff is responsible for: a command whose module `commands/<top>.ts` was added or modified
 * (a subcommand added or renamed there), or whose top-level name appears in a line the diff added to the registry index.
 * An undeclared command in an untouched module is older debt: the plan-close full scan reports it, this step does not.
 */
export function addedCommands(undeclared: readonly string[], changed: readonly ChangedFile[], registryAddedLines: string): string[] {
  const touched = new Set(changed.filter((c) => c.status !== "D").map((c) => c.path));
  return undeclared.filter((command) => {
    const top = command.split(" ")[0] as string;
    return touched.has(`packages/lore/src/adapters/cli/commands/${top}.ts`) || registryAddedLines.includes(`"${top}"`) || registryAddedLines.includes(`${top}:`);
  });
}

/** Injected effects of {@link mainChanged}, so the verdict is testable without a corpus. */
export interface ChangedDeps {
  readonly changed: () => ChangedFile[];
  readonly registryAddedLines: () => string;
  readonly coverage: () => CoverageData[];
}

/** The `--changed` verdict: 0 when nothing registry-related changed or the diff added no undeclared command, 1 otherwise. */
export function mainChanged(deps: ChangedDeps, print: (line: string) => void = console.log): number {
  const changed = deps.changed();
  if (!registryChanged(changed)) {
    print("check:baseline-coverage:changed: the diff touches no command registry file; nothing to declare");
    return 0;
  }
  const all = deps.coverage();
  const undeclared = all.flatMap((d) => d.undeclared_commands.map((u) => u.command));
  const blamed = new Set(addedCommands(undeclared, changed, deps.registryAddedLines()));
  const scoped = all.map((d) => ({ ...d, undeclared_commands: d.undeclared_commands.filter((u) => blamed.has(u.command)) }));
  for (const line of renderUndeclared(scoped)) print(line);
  return blamed.size === 0 ? 0 : 1;
}

function registryAddedLinesVsBase(base: string): string {
  const r = spawnSync("git", ["diff", "-U0", "--no-color", base, "--", REGISTRY_INDEX], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fail(`diff of the registry against ${base} exited ${r.status ?? -1}: ${r.stderr ?? ""}`);
  return (r.stdout ?? "")
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
}

/** The full (plan-close) verdict: approved declarations only, so a pending declaration never approved is caught at the milestone. */
export function mainFull(coverage: (includePending: boolean) => CoverageData[], print: (line: string) => void = console.log): number {
  const all = coverage(false);
  for (const line of renderUndeclared(all)) print(line);
  return all.every((d) => d.undeclared_commands.length === 0) ? 0 : 1;
}

function main(): number {
  return mainFull((includePending) => businessRoots().map((root) => coverageOf(root, includePending)));
}

if (import.meta.main) {
  try {
    if (wantsChanged(process.argv.slice(2))) {
      const base = resolveBase(process.cwd());
      process.exit(mainChanged({ changed: () => changedFiles(process.cwd(), base), registryAddedLines: () => registryAddedLinesVsBase(base), coverage: () => businessRoots().map((root) => coverageOf(root, true)) }));
    }
    process.exit(main());
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}
