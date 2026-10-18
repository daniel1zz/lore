#!/usr/bin/env bun
/**
 * Evidence-identity drop-set checker (`spec-evidence-identity-an-attested-row-counts-only-for-the`,
 * AC-EI-3; cites AS-17 - a completeness oracle never reports complete over what it could not see).
 *
 * Purpose: prove that no AC dropped from attested_pass by the evidence-identity rule is left unexplained.
 * Public surface: `DropSetRowSchema` / `DropSetSchema` (the committed file's row format, shared with the
 * generator), `evaluateDropSet` (pure), `runCheck` (prints, returns the exit code), `main` (IO).
 * Invariants: this script derives NO coverage state; it reads the state verbatim from
 * `lore ac list --json` (the single derivation) and compares only against the literals in GREEN_STATES (`attested_pass`, `fail_superseded`).
 * A row is `green` when its AC renders attested_pass or fail_superseded NOW (a corrected command counts only once re-verified,
 * because the live state is read, not the recorded one); `explained` when the AC is not green AND
 * the row names a task whose status is not archived; otherwise `unexplained`.
 * Side-effect class: IO (spawns `lore`, reads the drop-set file, prints).
 *
 * Exit codes: 0 every row green or explained; 1 at least one unexplained row (each named);
 * 2 the drop-set file is absent or empty while the corpus has script ACs (never vacuously green);
 * 3 the file is unreadable or malformed, or a lore call failed (fail loud, no silent fallback).
 *
 * Usage: bun scripts/check-evidence-identity-drop-set.ts [--file <path>] [--corpus <dir>] [--lore-entry <index.ts>]
 * NOT wired into `bun run test` or any gate until EI-4 lands the real data file.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DEFAULT_FILE = join(REPO_ROOT, "scripts", "evidence-identity-drop-set.json");
const DEFAULT_LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

export const DropSetRowSchema = z.object({
  spec: z.string().min(1),
  ac: z.string().min(1),
  before: z.string().min(1),
  after: z.string().min(1),
  task: z.string().min(1).optional(),
});
export type DropSetRow = z.infer<typeof DropSetRowSchema>;
export const DropSetSchema = z.array(DropSetRowSchema);

/** Typed failure for exit 3: the check could not be measured. */
export class DropSetCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DropSetCheckError";
  }
}

/** Live-corpus reader, injected so tests feed any corpus shape. */
export interface CorpusReader {
  /** Live coverage state of `ac` in `spec`; `null` when the spec or AC is not visible. */
  readonly getAcState: (spec: string, ac: string) => string | null;
  /** Status of the task doc `slug`; `null` when it does not exist. */
  readonly getTaskStatus: (slug: string) => string | null;
  /** Number of script-mode ACs across live specs (decides exit 2 vs a vacuous pass). */
  readonly countScriptAcs: () => number;
}

export type RowOutcome =
  | { readonly kind: "green"; readonly row: DropSetRow }
  | { readonly kind: "explained"; readonly row: DropSetRow; readonly state: string }
  | { readonly kind: "unexplained"; readonly row: DropSetRow; readonly state: string; readonly reason: string };

/**
 * States that count as green: attested_pass, or fail_superseded (the newest attested pass is strictly newer
 * than the newest fail, M4 - corrected on AC-EI-3). A plain `fail`, not_measured, none and absent never are.
 */
const GREEN_STATES: ReadonlySet<string> = new Set(["attested_pass", "fail_superseded"]);

/** Classifies every row against the live corpus. */
export function evaluateDropSet(rows: readonly DropSetRow[], corpus: CorpusReader): RowOutcome[] {
  return rows.map((row): RowOutcome => {
    const state = corpus.getAcState(row.spec, row.ac) ?? "absent";
    if (GREEN_STATES.has(state)) return { kind: "green", row };
    if (row.task === undefined) return { kind: "unexplained", row, state, reason: "no task recorded" };
    const status = corpus.getTaskStatus(row.task);
    if (status === null) return { kind: "unexplained", row, state, reason: `task ${row.task} not found` };
    if (status === "archived") return { kind: "unexplained", row, state, reason: `task ${row.task} is archived` };
    return { kind: "explained", row, state };
  });
}

/** Reads the drop-set file; `null` when absent or empty (exit 2 candidates), throws on malformed content. */
export function readDropSet(path: string): DropSetRow[] | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new DropSetCheckError(`${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = DropSetSchema.safeParse(json);
  if (!parsed.success) throw new DropSetCheckError(`${path} has an unexpected shape: ${parsed.error.message}`);
  return parsed.data.length === 0 ? null : parsed.data;
}

/** Prints the report through `print` and returns the exit code (0 / 1 / 2). */
export function runCheck(rows: readonly DropSetRow[] | null, corpus: CorpusReader, print: (line: string) => void): number {
  if (rows === null) {
    const scriptAcs = corpus.countScriptAcs();
    if (scriptAcs > 0) {
      print(`check-evidence-identity-drop-set: FAIL - drop-set file absent or empty while the corpus has ${scriptAcs} script AC(s); refusing a vacuous pass (AS-17).`);
      return 2;
    }
    print("check-evidence-identity-drop-set: no drop-set file and no script ACs in the corpus; nothing to check.");
    return 0;
  }
  const outcomes = evaluateDropSet(rows, corpus);
  const green = outcomes.filter((o) => o.kind === "green").length;
  const explained = outcomes.filter((o) => o.kind === "explained").length;
  const bad = outcomes.filter((o): o is Extract<RowOutcome, { kind: "unexplained" }> => o.kind === "unexplained");
  print(`check-evidence-identity-drop-set: ${rows.length} row(s): green=${green} explained=${explained} unexplained=${bad.length}`);
  for (const o of bad) print(`  unexplained spec=${o.row.spec} ac=${o.row.ac} state=${o.state} (${o.reason})`);
  return bad.length === 0 ? 0 : 1;
}

function runLore(corpusCwd: string, loreEntry: string, args: readonly string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("bun", ["run", loreEntry, ...args], { cwd: corpusCwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new DropSetCheckError(`lore ${args.join(" ")} could not run: ${r.error.message}`);
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

const AcListSchema = z.object({
  data: z.object({
    criteria: z.array(z.object({ id: z.string(), verify: z.object({ mode: z.string().optional() }).optional() })),
    // reason: coverage is null for a spec with no child task evidence yet - no coverage means no state
    coverage: z.array(z.object({ ac_id: z.string(), state: z.string() })).nullable(),
  }),
});
const DocListSchema = z.object({ data: z.object({ docs: z.array(z.object({ slug: z.string(), status: z.string() })) }) });
const GetSchema = z.object({ data: z.object({ doc: z.object({ status: z.string() }) }) });

function parseLoreJson<T extends z.ZodTypeAny>(r: { status: number; stdout: string; stderr: string }, what: string, schema: T): z.infer<T> {
  if (r.status !== 0) throw new DropSetCheckError(`${what} failed (exit ${r.status}): ${r.stderr || r.stdout}`);
  let json: unknown;
  try {
    json = JSON.parse(r.stdout);
  } catch (e) {
    throw new DropSetCheckError(`${what} printed unparseable JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new DropSetCheckError(`${what} unexpected shape: ${parsed.error.message}`);
  return parsed.data;
}

/** Corpus reader backed by the `lore` CLI at `corpusCwd`. */
export function createLoreCorpusReader(corpusCwd: string, loreEntry: string): CorpusReader {
  const specCache = new Map<string, z.infer<typeof AcListSchema> | null>();
  const listSpec = (spec: string): z.infer<typeof AcListSchema> | null => {
    if (!specCache.has(spec)) {
      const r = runLore(corpusCwd, loreEntry, ["ac", "list", spec, "--json"]);
      // reason: a nonzero exit for a slug that does not exist is "not visible", reported as state absent - not a silent pass
      specCache.set(spec, r.status === 0 ? parseLoreJson(r, `lore ac list ${spec}`, AcListSchema) : null);
    }
    return specCache.get(spec) ?? null;
  };
  return {
    getAcState: (spec, ac) => {
      const listing = listSpec(spec);
      if (listing === null) return null;
      return listing.data.coverage?.find((c) => c.ac_id === ac)?.state ?? (listing.data.criteria.some((c) => c.id === ac) ? "none" : null);
    },
    getTaskStatus: (slug) => {
      const r = runLore(corpusCwd, loreEntry, ["get", slug, "--json"]);
      return r.status === 0 ? parseLoreJson(r, `lore get ${slug}`, GetSchema).data.doc.status : null;
    },
    countScriptAcs: () => {
      const specs = parseLoreJson(runLore(corpusCwd, loreEntry, ["list", "--type", "spec", "--json"]), "lore list --type spec", DocListSchema);
      let total = 0;
      for (const doc of specs.data.docs) {
        if (doc.status === "deprecated") continue;
        const listing = listSpec(doc.slug);
        total += listing?.data.criteria.filter((c) => c.verify?.mode === "script").length ?? 0;
      }
      return total;
    },
  };
}

/** Runs the check; returns the exit code, never calls `process.exit`. */
export function main(file: string = DEFAULT_FILE, corpusCwd: string = REPO_ROOT, loreEntry: string = DEFAULT_LORE_ENTRY): number {
  const rows = readDropSet(file);
  return runCheck(rows, createLoreCorpusReader(corpusCwd, loreEntry), (line) => console.log(line));
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined) throw new DropSetCheckError(`${flag} needs a value`);
  return v;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    process.exit(main(argValue(argv, "--file"), argValue(argv, "--corpus"), argValue(argv, "--lore-entry")));
  } catch (e) {
    console.error(`check-evidence-identity-drop-set: cannot measure - ${e instanceof Error ? e.message : String(e)}`);
    process.exit(3);
  }
}
