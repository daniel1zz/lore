#!/usr/bin/env bun
/**
 * Evidence-identity drop-set generator (AC-EI-3 of `spec-evidence-identity-an-attested-row-counts-only-for-the`).
 *
 * Purpose: snapshot every live spec's `lore ac list --json` (dump) and diff a before and an after dump into
 * the rows of `scripts/evidence-identity-drop-set.json` (diff): the ACs that were attested_pass before and are not now.
 * Public surface: `DumpSchema`, `diffDumps` (pure), `collectDump` (IO), `cli`.
 * Invariants: states are copied verbatim from the lore listing, never derived; deprecated specs are skipped;
 * an AC or spec missing from the after dump counts as a drop with after="absent".
 * Side-effect class: IO for `dump` and file writes, pure for `diffDumps`.
 *
 * Usage:
 *   bun scripts/generate-evidence-identity-drop-set.ts dump <out.json> [--corpus <dir>] [--lore-entry <index.ts>]
 *   bun scripts/generate-evidence-identity-drop-set.ts diff <before.json> <after.json> [--out <file>] [--owners <owners.json>]
 * owners.json maps "<spec-slug>/<AC-ID>" to the owning task slug, copied into the row's `task`.
 * Without --out the rows print to stdout. Exit 0 ok; 3 on any input or lore failure.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type DropSetRow, DropSetSchema } from "./check-evidence-identity-drop-set.js";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

export const DumpSchema = z.object({
  specs: z.record(
    z.string(),
    z
      .object({
        data: z
          .object({
            coverage: z.array(z.object({ ac_id: z.string(), mode: z.string(), state: z.string() }).passthrough()).nullable(),
          })
          .passthrough(),
      })
      .passthrough(),
  ),
});
export type Dump = z.infer<typeof DumpSchema>;

/** Typed failure for unreadable inputs or failed lore calls. */
export class DropSetGenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DropSetGenerateError";
  }
}

function scriptStates(dump: Dump): Map<string, string> {
  const states = new Map<string, string>();
  for (const [spec, listing] of Object.entries(dump.specs)) {
    for (const c of listing.data.coverage ?? []) if (c.mode === "script") states.set(`${spec}/${c.ac_id}`, c.state);
  }
  return states;
}

/** Rows for every script AC that was attested_pass in `before` and is not in `after`, sorted by spec then AC. */
export function diffDumps(before: Dump, after: Dump, owners: Readonly<Record<string, string>> = {}): DropSetRow[] {
  const afterStates = scriptStates(after);
  const rows: DropSetRow[] = [];
  for (const [key, beforeState] of scriptStates(before)) {
    if (beforeState !== "attested_pass") continue;
    const afterState = afterStates.get(key) ?? "absent";
    if (afterState === "attested_pass") continue;
    const slash = key.indexOf("/");
    const row: DropSetRow = { spec: key.slice(0, slash), ac: key.slice(slash + 1), before: beforeState, after: afterState };
    const task = owners[key];
    rows.push(task === undefined ? row : { ...row, task });
  }
  return rows.sort((a, b) => a.spec.localeCompare(b.spec) || a.ac.localeCompare(b.ac));
}

function runLoreJson(corpusCwd: string, loreEntry: string, args: readonly string[]): unknown {
  const r = spawnSync("bun", ["run", loreEntry, ...args], { cwd: corpusCwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new DropSetGenerateError(`lore ${args.join(" ")} failed (exit ${r.status ?? -1}): ${r.error?.message ?? r.stderr}`);
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    throw new DropSetGenerateError(`lore ${args.join(" ")} printed unparseable JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Snapshots `lore ac list --json` for every non-deprecated spec of the corpus at `corpusCwd`. */
export function collectDump(corpusCwd: string, loreEntry: string): Dump {
  const list = z
    .object({ data: z.object({ docs: z.array(z.object({ slug: z.string(), status: z.string() })) }) })
    .parse(runLoreJson(corpusCwd, loreEntry, ["list", "--type", "spec", "--json"]));
  const specs: Record<string, unknown> = {};
  for (const doc of list.data.docs) {
    if (doc.status === "deprecated") continue;
    specs[doc.slug] = runLoreJson(corpusCwd, loreEntry, ["ac", "list", doc.slug, "--json"]);
  }
  return DumpSchema.parse({ specs });
}

function readJson<T extends z.ZodTypeAny>(path: string, schema: T): z.infer<T> {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new DropSetGenerateError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new DropSetGenerateError(`${path} has an unexpected shape: ${parsed.error.message}`);
  return parsed.data;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined) throw new DropSetGenerateError(`${name} needs a value`);
  return v;
}

/** CLI entry; returns the exit code. */
export function cli(argv: readonly string[]): number {
  const [verb, a, b] = argv;
  if (verb === "dump" && a !== undefined) {
    const dump = collectDump(flag(argv, "--corpus") ?? REPO_ROOT, flag(argv, "--lore-entry") ?? join(REPO_ROOT, "packages", "lore", "src", "index.ts"));
    writeFileSync(a, `${JSON.stringify(dump)}\n`, "utf8");
    console.log(`generate-evidence-identity-drop-set: dumped ${Object.keys(dump.specs).length} spec(s) to ${a}`);
    return 0;
  }
  if (verb === "diff" && a !== undefined && b !== undefined) {
    const ownersPath = flag(argv, "--owners");
    const owners = ownersPath === undefined ? {} : readJson(ownersPath, z.record(z.string(), z.string()));
    const rows = DropSetSchema.parse(diffDumps(readJson(a, DumpSchema), readJson(b, DumpSchema), owners));
    const out = flag(argv, "--out");
    const text = `${JSON.stringify(rows, null, 2)}\n`;
    if (out === undefined) process.stdout.write(text);
    else writeFileSync(out, text, "utf8");
    console.log(`generate-evidence-identity-drop-set: ${rows.length} dropped AC(s)${out === undefined ? "" : ` written to ${out}`}`);
    return 0;
  }
  throw new DropSetGenerateError("usage: dump <out.json> | diff <before.json> <after.json> [--out f] [--owners f]");
}

if (import.meta.main) {
  try {
    process.exit(cli(process.argv.slice(2)));
  } catch (e) {
    console.error(`generate-evidence-identity-drop-set: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(3);
  }
}
