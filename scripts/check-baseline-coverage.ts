#!/usr/bin/env bun
/**
 * Root baseline coverage floor step (`bun run check:baseline-coverage`) — AC-BCR-5 of
 * spec-baseline-coverage-cannot-silently-regress-one-program (BR-660, BR-1248).
 *
 * Purpose: `lore integrate` must not advance main unless the MERGED tree leaves no census site of any declared command
 * unaccounted and no runnable command undeclared. This step asks `lore baseline coverage <root>` for every business-tree
 * root of the corpus it resolves (the integrate floor runs it against the corpus snapshot taken at integrate start) and
 * exits 1 unless every root is complete. The ONE exemption is the committed debt ledger `scripts/baseline-coverage-debt.json`
 * (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline): a (leaf, site) pair listed there does not fail the step but
 * is printed with a count; a pair NOT listed fails as before; a listed pair that is now mapped or no longer reported is printed
 * as an informational stale row (never a failure: mappings live in the branchless shared corpus, so failing on them would block
 * every branch's floor until a row-removing commit lands on main), so the ledger only shrinks. `lore baseline coverage` itself never reads the ledger and keeps its INCOMPLETE verdict.
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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
/** The ledger of the checkout being JUDGED (the census reads the cwd's checkout too), not of the checkout this script lives in. */
export const debtLedgerPath = (checkout: string = process.cwd()): string => join(checkout, "scripts", "baseline-coverage-debt.json");

interface LeafReport {
  readonly slug: string;
  readonly commands: readonly string[];
  readonly gaps: readonly string[];
  readonly not_measured: readonly string[];
  readonly unresolved_imports: readonly string[];
  readonly fix_commands: readonly string[];
  readonly absent_commands: readonly { readonly command: string; readonly fix: string }[];
  readonly measured_by: "commands" | "owned_sites" | "absent" | "none";
  readonly ok: boolean;
}

export interface CoverageData {
  readonly target: string;
  readonly complete: boolean;
  readonly leaves: readonly LeafReport[];
  readonly undeclared_commands: readonly { readonly command: string; readonly fix: string }[];
}

/** Prefix of a line that is information only: it never counts against coverage. */
export const INFORMATIONAL_PREFIX = "  absent (informational, not failing)";

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

/**
 * The lines stating what the CLI's `--json` reports for a root: the CLI decided, this renders (no verdict logic here).
 * A leaf the CLI measured (by commands or owned sites) and found ok prints nothing; `measured_by: "none"` is the CLI's own
 * unmeasured state; each declared-but-absent command is printed as INFORMATIONAL (the CLI does not count it against coverage).
 */
export function renderMissing(data: CoverageData): string[] {
  const lines: string[] = [];
  for (const leaf of data.leaves) {
    if (leaf.measured_by === "none") lines.push(`  unmeasured   ${leaf.slug}: measured_by none (no command declared and no owned site)\n    fix: lore baseline map ${leaf.slug} --command <name>`);
    for (const key of leaf.unresolved_imports) lines.push(`  unresolved   ${key} (${leaf.slug}: census incomplete behind this import)`);
    for (const key of leaf.gaps) lines.push(`  gap          ${key}`);
    for (const key of leaf.not_measured) lines.push(`  not_measured ${key}`);
    for (const fix of leaf.fix_commands) lines.push(`    fix: ${fix}`);
    for (const a of leaf.absent_commands) lines.push(`${INFORMATIONAL_PREFIX} ${a.command} (${leaf.slug}: declared command not in this tree; pending or stale)\n    if stale: ${a.fix}`);
  }
  for (const u of data.undeclared_commands) lines.push(`  undeclared   ${u.command}\n    fix: ${u.fix}`);
  return lines;
}

/** One exempt (leaf, site) pair: `gap` = census site with no rule/non-business mapping, `not_measured` = unmeasurable site. */
export interface DebtRow {
  readonly leaf: string;
  readonly site: string;
  readonly kind: "gap" | "not_measured";
}

/** The committed ledger file: pairs revealed when the census learned to record where it stops (DC2-19). */
export interface DebtLedger {
  readonly adr: string;
  readonly reason: string;
  readonly rows: readonly DebtRow[];
}

const pairKey = (row: DebtRow): string => `${row.kind}\t${row.leaf}\t${row.site}`;

/** Every (leaf, site) pair the census currently reports as unaccounted, across the given roots' coverage data. */
export function currentPairs(all: readonly CoverageData[]): DebtRow[] {
  const rows: DebtRow[] = [];
  for (const data of all) {
    for (const leaf of data.leaves) {
      for (const site of leaf.gaps) rows.push({ leaf: leaf.slug, site, kind: "gap" });
      for (const site of leaf.not_measured) rows.push({ leaf: leaf.slug, site, kind: "not_measured" });
    }
  }
  return rows;
}

export interface LedgerVerdict {
  /** Rendered lines for what still fails: unledgered items (with their fix lines) and non-pair problems. */
  readonly failingLines: string[];
  /** Number of unaccounted items that fail (unledgered pairs + non-pair problems). */
  readonly failingCount: number;
  /** Pairs exempted by the ledger, still present in the census. */
  readonly ledgered: number;
  /** Ledger rows that match no current unaccounted pair (mapped, or no longer reported): informational, to be removed. */
  readonly stale: DebtRow[];
  /** One `stale debt row (remove it): <leaf> <site>` line per stale row. */
  readonly staleLines: string[];
  /** True exactly when no unaccounted pair is missing from the ledger; stale rows never fail. */
  readonly ok: boolean;
}

/**
 * Judge the census against the ledger (the CLI's verdict is untouched; only this floor step reads the ledger).
 *
 * @param all - coverage data of every business root.
 * @param ledger - the committed debt ledger.
 * @returns what fails, what is exempt (counted), and which ledger rows are stale.
 */
export function judgeAgainstLedger(all: readonly CoverageData[], ledger: DebtLedger): LedgerVerdict {
  const exempt = new Set(ledger.rows.map(pairKey));
  const present = new Set(currentPairs(all).map(pairKey));
  const stale = ledger.rows.filter((row) => !present.has(pairKey(row)));
  let ledgered = 0;
  const failingLines: string[] = [];
  let failingCount = 0;
  for (const data of all) {
    const leaves = data.leaves.map((leaf) => {
      const keep = (kind: "gap" | "not_measured", site: string): boolean => !exempt.has(pairKey({ leaf: leaf.slug, site, kind }));
      const flags = [...leaf.gaps.map((site) => keep("gap", site)), ...leaf.not_measured.map((site) => keep("not_measured", site))];
      ledgered += flags.filter((kept) => !kept).length;
      // reason: `fix_commands` carries one entry per gap then per not_measured site, in that order; later entries (if any) are not pair-aligned and stay.
      const fixCommands = leaf.fix_commands.filter((_, i) => i >= flags.length || flags[i] === true);
      return {
        ...leaf,
        gaps: leaf.gaps.filter((site) => keep("gap", site)),
        not_measured: leaf.not_measured.filter((site) => keep("not_measured", site)),
        fix_commands: fixCommands,
      };
    });
    const lines = renderMissing({ ...data, leaves });
    failingCount += lines.filter((l) => !l.startsWith(INFORMATIONAL_PREFIX) && !l.startsWith("    fix: ")).length;
    failingLines.push(...lines);
  }
  return {
    failingLines,
    failingCount,
    ledgered,
    stale,
    staleLines: stale.map((row) => `stale debt row (remove it): ${row.leaf} ${row.site}`),
    ok: failingCount === 0,
  };
}

function readLedger(): DebtLedger {
  const file = debtLedgerPath();
  // reason: a tree with no ledger has no exempt debt - the strict reading; deleting the ledger reddens the step, never greens it.
  if (!existsSync(file)) return { adr: "", reason: "no ledger in this tree", rows: [] };
  try {
    return JSON.parse(readFileSync(file, "utf8")) as DebtLedger;
  } catch (cause) {
    return fail(`debt ledger ${file} is not valid JSON: ${String(cause)}`);
  }
}

/**
 * One-shot seeding (`--seed-ledger [--except <site>]...`): write the ledger from what the census reports NOW.
 * Refuses to overwrite an existing ledger: re-seeding would re-admit new debt, and the ledger may only shrink.
 */
function seedLedger(except: ReadonlySet<string>): number {
  if (existsSync(debtLedgerPath())) return fail(`${debtLedgerPath()} already exists; the ledger only shrinks, it is never re-seeded`);
  const rows = currentPairs(businessRoots().map(coverageOf))
    .filter((row) => !except.has(row.site))
    .sort((a, b) => (pairKey(a) < pairKey(b) ? -1 : pairKey(a) > pairKey(b) ? 1 : 0));
  const ledger: DebtLedger = {
    adr: "adr-a-newly-armed-structural-oracle-enforces-from-a-baseline",
    reason:
      "Pairs revealed when the site census began recording depth cuts, shallowest-depth visits and unmodelled bindings (DC2-19). Pre-existing, now visible; each is retired by mapping it (lore baseline map) and deleting its row in the same commit.",
    rows,
  };
  writeFileSync(debtLedgerPath(), `${JSON.stringify(ledger, null, 1)}\n`);
  console.log(`check:baseline-coverage: seeded ${rows.length} ledger row(s) into ${debtLedgerPath()}`);
  return 0;
}

function main(argv: readonly string[]): number {
  if (argv.includes("--seed-ledger")) {
    const except = new Set(argv.flatMap((a, i) => (a === "--except" && argv[i + 1] !== undefined ? [argv[i + 1] as string] : [])));
    return seedLedger(except);
  }
  const all = businessRoots().map(coverageOf);
  const verdict = judgeAgainstLedger(all, readLedger());
  if (verdict.failingCount > 0) {
    console.log(`check:baseline-coverage: INCOMPLETE, ${verdict.failingCount} item(s) unaccounted (not in the debt ledger):`);
    for (const line of verdict.failingLines) console.log(line);
  }
  if (verdict.stale.length > 0) {
    console.log(`check:baseline-coverage: ${verdict.stale.length} stale debt row(s) in scripts/baseline-coverage-debt.json (informational, not failing):`);
    for (const line of verdict.staleLines) console.log(`  ${line}`);
  }
  console.log(`check:baseline-coverage: ${all.map((d) => d.target).join(", ")}: ${verdict.ledgered} ledgered (debt), ${verdict.failingCount} unaccounted, ${verdict.stale.length} stale (informational)`);
  return verdict.ok ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
