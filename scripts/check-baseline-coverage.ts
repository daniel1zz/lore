#!/usr/bin/env bun
/**
 * Root baseline coverage floor step (`bun run check:baseline-coverage`) — AC-BCR-5 of
 * spec-baseline-coverage-cannot-silently-regress-one-program (BR-660, BR-1248).
 *
 * Purpose: `lore integrate` must not advance main unless the MERGED tree leaves no census site of any declared command
 * unaccounted and no runnable command undeclared. This step asks `lore baseline coverage <root>` for every business-tree
 * root of the corpus it resolves (the integrate floor runs it against the corpus snapshot taken at integrate start) and
 * exits 1 unless every root is complete. Absolute: no ratchet, no allowlist, no count comparison.
 *
 * Which code judges: the checkout this script lives in (`<repo>/packages/lore/src/index.ts`, run by bun), so the floor
 * judges the merged tree with the merged tree's own census, never the shared checkout's build. The census reads the
 * current working directory's checkout (the integration worktree when the floor runs it).
 *
 * Output: only what is missing, one pair per line with its `lore baseline map` fix line, so the tail of a failing floor
 * names the pairs. Exit codes: 0 complete, 1 incomplete, 2 the check itself could not run (no root, unparsable output) —
 * never a silent pass.
 *
 * Side-effect class: IO (spawns `lore`, prints).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

interface LeafReport {
  readonly slug: string;
  readonly commands: readonly string[];
  readonly gaps: readonly string[];
  readonly not_measured: readonly string[];
  readonly unresolved_imports: readonly string[];
  readonly fix_commands: readonly string[];
  readonly ok: boolean;
}

interface CoverageData {
  readonly target: string;
  readonly complete: boolean;
  readonly leaves: readonly LeafReport[];
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
  const r = runLore(["baseline", "coverage", root, "--json"]);
  // exit 1 = incomplete (still prints the JSON); anything else is the check failing to run
  if (r.status !== 0 && r.status !== 1) fail(`\`lore baseline coverage ${root}\` exited ${r.status}: ${r.stderr}${r.stdout}`);
  try {
    const data = (JSON.parse(r.stdout) as { data: CoverageData }).data;
    if (data.complete !== (r.status === 0)) fail(`coverage of ${root} disagrees with itself: complete=${data.complete} but exit ${r.status}`);
    return data;
  } catch (cause) {
    return fail(`unparsable coverage output for ${root}: ${String(cause)}`);
  }
}

/** The lines naming what a root still lacks (empty when complete). */
export function renderMissing(data: CoverageData): string[] {
  const lines: string[] = [];
  for (const leaf of data.leaves) {
    if (leaf.commands.length === 0) lines.push(`  unmeasured   ${leaf.slug}: no command declared\n    fix: lore baseline map ${leaf.slug} --command <name>`);
    for (const key of leaf.unresolved_imports) lines.push(`  unresolved   ${key} (${leaf.slug}: census incomplete behind this import)`);
    const pairs = [...leaf.gaps.map((k) => ["gap         ", k] as const), ...leaf.not_measured.map((k) => ["not_measured", k] as const)];
    for (const [kind, key] of pairs) {
      lines.push(`  ${kind} ${key}\n    fix: lore baseline map ${leaf.slug} --site ${key} --rule <BR-n> | --non-business <reason>`);
    }
  }
  for (const u of data.undeclared_commands) lines.push(`  undeclared   ${u.command}\n    fix: ${u.fix}`);
  return lines;
}

function main(): number {
  let incomplete = 0;
  for (const root of businessRoots()) {
    const data = coverageOf(root);
    if (data.complete) {
      console.log(`check:baseline-coverage: ${root} complete (${data.leaves.length} leaves)`);
      continue;
    }
    incomplete += 1;
    const lines = renderMissing(data);
    console.log(`check:baseline-coverage: ${root} INCOMPLETE, ${lines.length} item(s) unaccounted:`);
    for (const line of lines) console.log(line);
  }
  return incomplete === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
