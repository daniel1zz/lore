#!/usr/bin/env bun
/**
 * AC oracle ownership checker (`spec-test-governance-guards-that-refuse-bad-tests-declared`,
 * AC-TG-5; cites AS-17 — a completeness oracle never reports complete over what it could not see).
 *
 * Purpose: every live script-mode acceptance criterion must have exactly one existing OWNING
 * test file, where the owner is the FIRST test file named in its `verify.command`.
 * Public surface: `evaluateOwnership` (pure), `extractAcReferences` (pure),
 * `collectScriptAcs` (IO, one `lore ac list` spawn per spec — the slow reference reader),
 * `collectScriptAcsBulk` (IO, ONE reader process; the default), `scriptAcsFromDump` (pure), `main` (IO, returns the exit code, never
 * calls `process.exit`).
 * Invariants: AC ids are unique ONLY within one spec (`packages/core/src/acceptance.ts`
 * superRefine) — every resolution below is per spec, never by global id.
 * Side-effect class: IO (reads the corpus through `lore ac list --json`, reads test files).
 *
 * Live criteria only: a criterion with `superseded_by` is retired behaviour (its test was deleted on
 * purpose, #313) — it is not checked for an owner file and is not an owner for the reference rules.
 *
 * Rules (printed as `rule=<name>`):
 *   - `missing-owner-file`: the AC's first test file does not exist on disk.
 *   - `ambiguous-ac-id`: a test file is the owner of the same AC id in two or more specs and
 *     references that id without a spec-qualified `<spec-slug>#AC-ID` reference.
 *   - `unowned-ac-reference`: a test file references (describe/it name or `@spec_ref`) an AC
 *     id that exists in the corpus but that this file does not own, with no spec-qualified
 *     reference and no `@layer <surface> AC-X AC-Y` tag naming that id (the tag declares a
 *     different entry point for exactly the ACs it lists; a bare tag or an unnamed id still fails).
 *   - `nothing-scanned`: zero script ACs were visible (AS-17: never complete over nothing).
 *
 * Scope (AC-TG-5 "live script AC"): only criteria of non-deprecated specs are scanned. Each
 * deprecated spec skipped is COUNTED and NAMED in the output (AS-17: nothing is silently skipped).
 *
 * Red-first declarations: an AC declared with `lore ac add|set --allow-missing-path "<reason>"` is
 * the corpus's own record that its oracle is not written yet (`lore ac list --json` carries it as
 * `allow_missing_declarations`). A `missing-owner-file` for such an AC is reported as ledgered
 * with that reason instead of failing; a declaration whose file exists needs nothing. A declaration
 * never hides `ambiguous-ac-id` / `unowned-ac-reference`. Without a declaration the file is missing: exit 1.
 *
 * Exit codes: 0 every script AC has one existing owner and no rule fired; 1 a rule fired, OR
 * the scan could not see the corpus (lore failure, zero script ACs).
 *
 * Residual (named, not hidden): a script AC whose command names no test file (e.g. a `tsc`
 * or `grep` oracle) has no owning file to check; it is counted in the report, never failed.
 *
 * Usage: bun scripts/check-ac-oracle-ownership.ts [--reader=per-spec-cli]  (the flag selects the slow reference reader)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { CorpusDump } from "./check-ac-oracle-ownership-corpus.js";
import { collectRepoTestFiles, extractTestFilePaths, type TestFileContent } from "./check-unclaimed-oracle.js";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

/** One live script-mode acceptance criterion, as read through `lore ac list`. */
export interface ScriptAc {
  readonly spec: string;
  readonly id: string;
  readonly command: string;
  /** The `--allow-missing-path` reason when the AC is declared red-first (its oracle is not written yet). */
  readonly allowMissingReason?: string;
  /** True when the criterion carries `superseded_by`: retired behaviour, not live (`lore verify` skips it too). */
  readonly superseded?: true;
}

export type OwnershipRule = "missing-owner-file" | "ambiguous-ac-id" | "unowned-ac-reference";

export interface OwnershipFinding {
  readonly rule: OwnershipRule;
  readonly spec: string;
  readonly acId: string;
  readonly path: string;
}

/** A script AC whose owner file is missing but which carries a live red-first declaration. */
export interface LedgeredAc {
  readonly spec: string;
  readonly acId: string;
  readonly path: string;
  readonly reason: string;
}

export interface OwnershipReport {
  readonly scannedScriptAcs: number;
  readonly scannedTestFiles: number;
  readonly acsWithoutTestFile: number;
  readonly findings: readonly OwnershipFinding[];
  /** Missing owner files excused by a live `--allow-missing-path` declaration. */
  readonly ledgered: readonly LedgeredAc[];
}

/** One AC reference found in a test file. `spec` is set only for a `<spec-slug>#AC-ID` reference. */
export interface AcReference {
  readonly acId: string;
  readonly spec: string | undefined;
}

const AC_ID = "AC-[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\\d+";
const AC_REF_RE = new RegExp(`(?:([a-z0-9][a-z0-9-]*)#)?\\b(${AC_ID})\\b`, "g");
const TEST_NAME_RE = /\b(?:describe|it|test)(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
const LAYER_TAG_RE = new RegExp(`@layer\\s+\\S+((?:[ \\t]+${AC_ID}(?![\\w-]))*)`, "g");

/**
 * Pure. AC ids a file declares as covered by an `@layer <surface> AC-X AC-Y` tag (one or more
 * tags per file, union). The ids must follow the surface token directly; free text after them
 * is ignored. A bare `@layer <surface>` covers nothing — reason: a file-level tag that silenced
 * every reference also silenced future ones (TG-11 follow-up).
 */
export function extractLayerCoveredAcIds(content: string): Set<string> {
  const covered = new Set<string>();
  for (const m of content.matchAll(LAYER_TAG_RE)) {
    for (const id of (m[1] ?? "").match(new RegExp(AC_ID, "g")) ?? []) covered.add(id);
  }
  return covered;
}

/** AC references from describe/it/test names and `@spec_ref` lines of one test file (deduplicated per spec+id). */
export function extractAcReferences(content: string): AcReference[] {
  const regions: string[] = [];
  for (const m of content.matchAll(TEST_NAME_RE)) regions.push(m[2] ?? "");
  for (const line of content.split("\n")) if (line.includes("@spec_ref")) regions.push(line);
  const seen = new Set<string>();
  const out: AcReference[] = [];
  for (const region of regions) {
    for (const m of region.matchAll(AC_REF_RE)) {
      const key = `${m[1] ?? ""}#${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ acId: m[2] as string, spec: m[1] });
    }
  }
  return out;
}

/**
 * Pure ownership evaluation. `fileExists` is injected so the missing-file rule needs no
 * disk; `testFiles` are the contents scanned for AC references.
 */
export function evaluateOwnership(
  acs: readonly ScriptAc[],
  testFiles: readonly TestFileContent[],
  fileExists: (path: string) => boolean,
): OwnershipReport {
  const findings: OwnershipFinding[] = [];
  const ledgered: LedgeredAc[] = [];
  const owners = new Map<string, Map<string, string[]>>(); // owner file -> acId -> owning specs
  const specsByAcId = new Map<string, string[]>();
  let acsWithoutTestFile = 0;
  // reason: a superseded criterion's test is deleted on purpose with the retired behaviour (#313);
  // it is neither an owner nor a referenceable AC, exactly as `lore verify` skips it.
  const liveAcs = acs.filter((ac) => ac.superseded !== true);

  for (const ac of liveAcs) {
    specsByAcId.set(ac.id, [...(specsByAcId.get(ac.id) ?? []), ac.spec]);
    const owner = extractTestFilePaths(ac.command)[0];
    if (owner === undefined) {
      acsWithoutTestFile += 1;
      continue;
    }
    if (!fileExists(owner)) {
      if (ac.allowMissingReason !== undefined) {
        ledgered.push({ spec: ac.spec, acId: ac.id, path: owner, reason: ac.allowMissingReason });
        continue;
      }
      findings.push({ rule: "missing-owner-file", spec: ac.spec, acId: ac.id, path: owner });
      continue;
    }
    const byId = owners.get(owner) ?? new Map<string, string[]>();
    byId.set(ac.id, [...(byId.get(ac.id) ?? []), ac.spec]);
    owners.set(owner, byId);
  }

  for (const tf of testFiles) {
    const ownedHere = owners.get(tf.path) ?? new Map<string, string[]>();
    const layerCovered = extractLayerCoveredAcIds(tf.content);
    for (const ref of extractAcReferences(tf.content)) {
      if (ref.spec !== undefined) continue; // spec-qualified: explicit, resolved per spec
      const ownerSpecs = ownedHere.get(ref.acId) ?? [];
      if (ownerSpecs.length >= 2) {
        for (const spec of ownerSpecs) findings.push({ rule: "ambiguous-ac-id", spec, acId: ref.acId, path: tf.path });
      } else if (ownerSpecs.length === 0 && !layerCovered.has(ref.acId)) {
        const candidates = specsByAcId.get(ref.acId);
        if (candidates === undefined) continue; // not an AC of any live spec
        for (const spec of candidates) findings.push({ rule: "unowned-ac-reference", spec, acId: ref.acId, path: tf.path });
      }
    }
  }

  return { scannedScriptAcs: liveAcs.length, scannedTestFiles: testFiles.length, acsWithoutTestFile, findings, ledgered };
}

// ─── IO ─────────────────────────────────────────────────────────────────────

/** Thrown when the corpus cannot be read — loud, never an empty "clean" result (AS-17). */
export class OwnershipScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnershipScanError";
  }
}

export const ListSchema = z.object({
  ok: z.literal(true),
  data: z.object({ docs: z.array(z.object({ slug: z.string(), status: z.string() })) }),
});
const AcListSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    criteria: z.array(
      z.object({
        id: z.string(),
        verify: z.object({ mode: z.string().optional(), command: z.string().optional() }).optional(),
        superseded_by: z.unknown().optional(),
      }),
    ),
    allow_missing_declarations: z.array(z.object({ ac_id: z.string(), reason: z.string() })).optional(),
  }),
});

export function runLoreJson<T extends z.ZodTypeAny>(corpusCwd: string, indexTs: string, args: readonly string[], schema: T): z.infer<T> {
  const r = spawnSync("bun", ["run", indexTs, ...args], { cwd: corpusCwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new OwnershipScanError(`lore ${args.join(" ")} failed (exit ${r.status ?? -1}): ${r.error?.message ?? r.stderr ?? r.stdout}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(r.stdout);
  } catch (e) {
    throw new OwnershipScanError(`lore ${args.join(" ")} printed unparseable JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new OwnershipScanError(`lore ${args.join(" ")} unexpected shape: ${parsed.error.message}`);
  return parsed.data;
}

/** Injected `lore ... --json` reader (the default spawns the CLI); lets tests feed specs of any status. */
export type LoreJsonRunner = <T extends z.ZodTypeAny>(args: readonly string[], schema: T) => z.infer<T>;

/** Script ACs of every LIVE spec, plus the slugs of the deprecated specs that were skipped (AS-17). */
export interface ScriptAcScan {
  readonly acs: ScriptAc[];
  readonly skippedDeprecatedSpecs: string[];
}

/** Every script-mode AC of every non-deprecated spec in the corpus rooted at `corpusCwd`, with its spec slug. */
export function collectScriptAcs(
  corpusCwd: string,
  indexTs: string,
  runJson: LoreJsonRunner = (args, schema) => runLoreJson(corpusCwd, indexTs, args, schema),
): ScriptAcScan {
  const specs = runJson(["list", "--type", "spec", "--json"], ListSchema);
  const out: ScriptAc[] = [];
  const skippedDeprecatedSpecs: string[] = [];
  for (const doc of specs.data.docs) {
    if (doc.status === "deprecated") {
      skippedDeprecatedSpecs.push(doc.slug);
      continue;
    }
    const acs = runJson(["ac", "list", doc.slug, "--json"], AcListSchema);
    const reasons = new Map((acs.data.allow_missing_declarations ?? []).map((d) => [d.ac_id, d.reason] as const));
    for (const c of acs.data.criteria) {
      if (c.verify?.mode === "script" && typeof c.verify.command === "string") {
        const reason = reasons.get(c.id);
        out.push({
          spec: doc.slug,
          id: c.id,
          command: c.verify.command,
          ...(reason !== undefined ? { allowMissingReason: reason } : {}),
          ...(c.superseded_by !== undefined ? { superseded: true as const } : {}),
        });
      }
    }
  }
  return { acs: out, skippedDeprecatedSpecs };
}

const CORPUS_READER = join(REPO_ROOT, "scripts", "check-ac-oracle-ownership-corpus.ts");

const CorpusDumpSchema = z.object({
  specs: z.array(
    z.object({
      slug: z.string(),
      status: z.string(),
      criteria: z.array(
        z.object({
          id: z.string(),
          verify: z.object({ mode: z.string().optional(), command: z.string().optional() }).optional(),
          superseded: z.literal(true).optional(),
        }),
      ),
      allow_missing_declarations: z.array(z.object({ ac_id: z.string(), reason: z.string() })),
    }),
  ),
});

/** Pure. The same {@link ScriptAcScan} `collectScriptAcs` builds, from one whole-corpus dump. */
export function scriptAcsFromDump(dump: CorpusDump): ScriptAcScan {
  const acs: ScriptAc[] = [];
  const skippedDeprecatedSpecs: string[] = [];
  for (const spec of dump.specs) {
    if (spec.status === "deprecated") {
      skippedDeprecatedSpecs.push(spec.slug);
      continue;
    }
    const reasons = new Map(spec.allow_missing_declarations.map((d) => [d.ac_id, d.reason] as const));
    for (const c of spec.criteria) {
      if (c.verify?.mode === "script" && typeof c.verify.command === "string") {
        const reason = reasons.get(c.id);
        acs.push({
          spec: spec.slug,
          id: c.id,
          command: c.verify.command,
          ...(reason !== undefined ? { allowMissingReason: reason } : {}),
          ...(c.superseded === true ? { superseded: true as const } : {}),
        });
      }
    }
  }
  return { acs, skippedDeprecatedSpecs };
}

/**
 * IO. Every script AC of every live spec through ONE reader process (`check-ac-oracle-ownership-corpus.ts`)
 * instead of one `lore ac list` spawn per spec — exact, full corpus, no cache. Throws
 * {@link OwnershipScanError} when the reader fails (never an empty "clean" scan, AS-17).
 */
export function collectScriptAcsBulk(corpusCwd: string): ScriptAcScan {
  const r = spawnSync("bun", [CORPUS_READER], { cwd: corpusCwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new OwnershipScanError(`corpus reader failed (exit ${r.status ?? -1}): ${r.error?.message ?? r.stderr ?? r.stdout}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(r.stdout);
  } catch (e) {
    throw new OwnershipScanError(`corpus reader printed unparseable JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = CorpusDumpSchema.safeParse(json);
  if (!parsed.success) throw new OwnershipScanError(`corpus reader unexpected shape: ${parsed.error.message}`);
  return scriptAcsFromDump(parsed.data);
}

/**
 * Runs the check for the corpus at `corpusCwd` (cwd of the reader spawn) against test files
 * under `treeRoot`. `indexTs` is used only by the `per-spec-cli` reference reader. Returns the process exit code; never calls `process.exit`.
 */
export function main(
  corpusCwd: string = REPO_ROOT,
  treeRoot: string = corpusCwd,
  indexTs: string = join(REPO_ROOT, "packages", "lore", "src", "index.ts"),
  reader: "bulk" | "per-spec-cli" = "bulk",
): number {
  // reason: `per-spec-cli` is the slow reference reader, kept so the equality of the two readers stays testable.
  const { acs, skippedDeprecatedSpecs } = reader === "bulk" ? collectScriptAcsBulk(corpusCwd) : collectScriptAcs(corpusCwd, indexTs);
  console.log(
    `check-ac-oracle-ownership: skipped ${skippedDeprecatedSpecs.length} deprecated spec(s)${skippedDeprecatedSpecs.length > 0 ? `: ${skippedDeprecatedSpecs.join(", ")}` : ""}`,
  );
  if (acs.length === 0) {
    console.log("check-ac-oracle-ownership: FAIL — rule=nothing-scanned: 0 script ACs were visible; refusing to report complete (AS-17).");
    return 1;
  }
  const fileExists = (p: string): boolean => existsSync(join(treeRoot, p));
  const report = evaluateOwnership(acs, collectRepoTestFiles(treeRoot), fileExists);
  console.log(`check-ac-oracle-ownership: ${report.ledgered.length} script AC(s) declared red-first (--allow-missing-path), oracle not written yet.`);
  // reason: print in (spec, ac) order so both readers (whose spec enumeration orders differ) emit identical output.
  const byKey = (a: { spec: string; acId: string }, b: { spec: string; acId: string }): number => a.spec.localeCompare(b.spec) || a.acId.localeCompare(b.acId, undefined, { numeric: true });
  for (const r of [...report.ledgered].sort(byKey)) console.log(`  ledgered spec=${r.spec} ac=${r.acId} path=${r.path} reason=${r.reason}`);
  console.log(
    `check-ac-oracle-ownership: scanned ${report.scannedScriptAcs} script AC(s), ${report.scannedTestFiles} test file(s); ${report.acsWithoutTestFile} script AC(s) name no test file (not checked).`,
  );
  if (report.findings.length === 0) {
    console.log("check-ac-oracle-ownership: OK — every script AC has one existing owning test file, except the red-first declarations named above.");
    return 0;
  }
  const byRule = new Map<OwnershipRule, number>();
  for (const f of [...report.findings].sort(byKey)) {
    byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
    console.log(`  rule=${f.rule} spec=${f.spec} ac=${f.acId} path=${f.path}`);
  }
  console.log(
    `check-ac-oracle-ownership: FAIL — ${report.findings.length} finding(s): ${[...byRule].map(([r, n]) => `${r}=${n}`).join(", ")}`,
  );
  return 1;
}

if (import.meta.main) {
  try {
    const reader = process.argv.includes("--reader=per-spec-cli") ? "per-spec-cli" : "bulk";
    process.exit(main(undefined, undefined, undefined, reader));
  } catch (e) {
    console.error(`check-ac-oracle-ownership: scan failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
