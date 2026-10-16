#!/usr/bin/env bun
/**
 * AC oracle ownership checker (`spec-test-governance-guards-that-refuse-bad-tests-declared`,
 * AC-TG-5; cites AS-17 — a completeness oracle never reports complete over what it could not see).
 *
 * Purpose: every live script-mode acceptance criterion must have exactly one existing OWNING
 * test file, where the owner is the FIRST test file named in its `verify.command`.
 * Public surface: `evaluateOwnership` (pure), `extractAcReferences` (pure),
 * `collectScriptAcs` (IO, spawns the `lore` CLI), `main` (IO, returns the exit code, never
 * calls `process.exit`).
 * Invariants: AC ids are unique ONLY within one spec (`packages/core/src/acceptance.ts`
 * superRefine) — every resolution below is per spec, never by global id.
 * Side-effect class: IO (reads the corpus through `lore ac list --json`, reads test files).
 *
 * Rules (printed as `rule=<name>`):
 *   - `missing-owner-file`: the AC's first test file does not exist on disk.
 *   - `ambiguous-ac-id`: a test file is the owner of the same AC id in two or more specs and
 *     references that id without a spec-qualified `<spec-slug>#AC-ID` reference.
 *   - `unowned-ac-reference`: a test file references (describe/it name or `@spec_ref`) an AC
 *     id that exists in the corpus but that this file does not own, with no spec-qualified
 *     reference and no `@layer <surface>` tag (the tag declares a different entry point).
 *   - `nothing-scanned`: zero script ACs were visible (AS-17: never complete over nothing).
 *
 * Exit codes: 0 every script AC has one existing owner and no rule fired; 1 a rule fired, OR
 * the scan could not see the corpus (lore failure, zero script ACs).
 *
 * Residual (named, not hidden): a script AC whose command names no test file (e.g. a `tsc`
 * or `grep` oracle) has no owning file to check; it is counted in the report, never failed.
 *
 * Usage: bun scripts/check-ac-oracle-ownership.ts
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { collectRepoTestFiles, extractTestFilePaths, type TestFileContent } from "./check-unclaimed-oracle.js";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

/** One live script-mode acceptance criterion, as read through `lore ac list`. */
export interface ScriptAc {
  readonly spec: string;
  readonly id: string;
  readonly command: string;
}

export type OwnershipRule = "missing-owner-file" | "ambiguous-ac-id" | "unowned-ac-reference";

export interface OwnershipFinding {
  readonly rule: OwnershipRule;
  readonly spec: string;
  readonly acId: string;
  readonly path: string;
}

export interface OwnershipReport {
  readonly scannedScriptAcs: number;
  readonly scannedTestFiles: number;
  readonly acsWithoutTestFile: number;
  readonly findings: readonly OwnershipFinding[];
}

/** One AC reference found in a test file. `spec` is set only for a `<spec-slug>#AC-ID` reference. */
export interface AcReference {
  readonly acId: string;
  readonly spec: string | undefined;
}

const AC_ID = "AC-[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\\d+";
const AC_REF_RE = new RegExp(`(?:([a-z0-9][a-z0-9-]*)#)?\\b(${AC_ID})\\b`, "g");
const TEST_NAME_RE = /\b(?:describe|it|test)(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
const LAYER_TAG_RE = /@layer\s+\S+/;

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
  const owners = new Map<string, Map<string, string[]>>(); // owner file -> acId -> owning specs
  const specsByAcId = new Map<string, string[]>();
  let acsWithoutTestFile = 0;

  for (const ac of acs) {
    specsByAcId.set(ac.id, [...(specsByAcId.get(ac.id) ?? []), ac.spec]);
    const owner = extractTestFilePaths(ac.command)[0];
    if (owner === undefined) {
      acsWithoutTestFile += 1;
      continue;
    }
    if (!fileExists(owner)) {
      findings.push({ rule: "missing-owner-file", spec: ac.spec, acId: ac.id, path: owner });
      continue;
    }
    const byId = owners.get(owner) ?? new Map<string, string[]>();
    byId.set(ac.id, [...(byId.get(ac.id) ?? []), ac.spec]);
    owners.set(owner, byId);
  }

  for (const tf of testFiles) {
    const ownedHere = owners.get(tf.path) ?? new Map<string, string[]>();
    const hasLayerTag = LAYER_TAG_RE.test(tf.content);
    for (const ref of extractAcReferences(tf.content)) {
      if (ref.spec !== undefined) continue; // spec-qualified: explicit, resolved per spec
      const ownerSpecs = ownedHere.get(ref.acId) ?? [];
      if (ownerSpecs.length >= 2) {
        for (const spec of ownerSpecs) findings.push({ rule: "ambiguous-ac-id", spec, acId: ref.acId, path: tf.path });
      } else if (ownerSpecs.length === 0 && !hasLayerTag) {
        const candidates = specsByAcId.get(ref.acId);
        if (candidates === undefined) continue; // not an AC of any live spec
        for (const spec of candidates) findings.push({ rule: "unowned-ac-reference", spec, acId: ref.acId, path: tf.path });
      }
    }
  }

  return { scannedScriptAcs: acs.length, scannedTestFiles: testFiles.length, acsWithoutTestFile, findings };
}

// ─── IO ─────────────────────────────────────────────────────────────────────

/** Thrown when the corpus cannot be read — loud, never an empty "clean" result (AS-17). */
export class OwnershipScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnershipScanError";
  }
}

const ListSchema = z.object({ ok: z.literal(true), data: z.object({ docs: z.array(z.object({ slug: z.string() })) }) });
const AcListSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    criteria: z.array(
      z.object({
        id: z.string(),
        verify: z.object({ mode: z.string().optional(), command: z.string().optional() }).optional(),
      }),
    ),
  }),
});

function runLoreJson<T extends z.ZodTypeAny>(corpusCwd: string, indexTs: string, args: readonly string[], schema: T): z.infer<T> {
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

/** Every script-mode AC of every spec in the corpus rooted at `corpusCwd`, with its spec slug. */
export function collectScriptAcs(corpusCwd: string, indexTs: string): ScriptAc[] {
  const specs = runLoreJson(corpusCwd, indexTs, ["list", "--type", "spec", "--json"], ListSchema);
  const out: ScriptAc[] = [];
  for (const doc of specs.data.docs) {
    const acs = runLoreJson(corpusCwd, indexTs, ["ac", "list", doc.slug, "--json"], AcListSchema);
    for (const c of acs.data.criteria) {
      if (c.verify?.mode === "script" && typeof c.verify.command === "string") {
        out.push({ spec: doc.slug, id: c.id, command: c.verify.command });
      }
    }
  }
  return out;
}

/**
 * Runs the check for the corpus at `corpusCwd` (cwd of the `lore` spawn) against test files
 * under `treeRoot`. Returns the process exit code; never calls `process.exit`.
 */
export function main(
  corpusCwd: string = REPO_ROOT,
  treeRoot: string = corpusCwd,
  indexTs: string = join(REPO_ROOT, "packages", "lore", "src", "index.ts"),
): number {
  const acs = collectScriptAcs(corpusCwd, indexTs);
  if (acs.length === 0) {
    console.log("check-ac-oracle-ownership: FAIL — rule=nothing-scanned: 0 script ACs were visible; refusing to report complete (AS-17).");
    return 1;
  }
  const report = evaluateOwnership(acs, collectRepoTestFiles(treeRoot), (p) => existsSync(join(treeRoot, p)));
  console.log(
    `check-ac-oracle-ownership: scanned ${report.scannedScriptAcs} script AC(s), ${report.scannedTestFiles} test file(s); ${report.acsWithoutTestFile} script AC(s) name no test file (not checked).`,
  );
  if (report.findings.length === 0) {
    console.log("check-ac-oracle-ownership: OK — every script AC has one existing owning test file.");
    return 0;
  }
  const byRule = new Map<OwnershipRule, number>();
  for (const f of report.findings) {
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
    process.exit(main());
  } catch (e) {
    console.error(`check-ac-oracle-ownership: scan failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
